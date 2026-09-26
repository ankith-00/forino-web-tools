"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { blobToBase64, captureSpreadJpeg } from "@/lib/scanjet/capture";
import { readSpread, sameSpread, SEEN_WINDOW_MS, type Detection, type Reading } from "@/lib/scanjet/spread";
import {
  accept,
  evaluate,
  expectedPair,
  finish as endSession,
  finishOnLeft,
  initialSession,
  message,
  pagesScanned,
  type Pair,
  type SessionState,
  type Spread,
  type Verdict,
} from "@/lib/scanjet/sequence";

/**
 * Running a bound document through the scanner, from the browser's own camera.
 *
 * This is the glue that `/booklet-scanner` deliberately does not have. That
 * route is a bring-up screen: it proves the decode chain end to end and stops
 * there. This one carries the work the rest of `@/lib/scanjet` was written for
 * but never wired to — the page-ordering rules in `sequence.ts`, the centre-line
 * split in `spread.ts`, and the JPEG capture + upload in `capture.ts`.
 *
 * It is a fallback input path, not a second scanner: the camera is the browser's
 * own, so nothing here depends on a phone, a cable, or `adb reverse`. The rules
 * and the wire format are identical either way, because both come from the same
 * modules and the same `POST /api/scan-spread`.
 *
 * ## Why there is a dwell timer
 *
 * The decode loop runs every `DECODE_INTERVAL_MS` (120ms), so a spread that is
 * sitting open in front of the lens reports `match` eight times a second. Left
 * alone that would mean eight captures and eight uploads for one page, and a
 * verdict that flickers. So a match has to *hold* before it is acted on:
 * `DWELL_MS` of the same expected spread, uninterrupted. Any disagreement resets
 * it, which is what makes turning a page feel responsive rather than twitchy.
 *
 * The upload is guarded separately, because the dwell and the save overlap: the
 * dwell is satisfied long before a 300 KB JPEG has finished crossing the wire,
 * and without the guard the next tick would start a second capture.
 */

/** How long the expected spread must hold before it is captured. */
const DWELL_MS = 700;
/** How often the session is re-evaluated against what the camera can currently see. */
const TICK_MS = 100;
/** Where the page images go. Same endpoint and same access gate as the phone route. */
const UPLOAD_URL = "/api/scan-spread";

export type UploadState = {
  /** A capture is in flight. */
  saving: boolean;
  /** The last transport or server failure, already phrased for the operator. */
  error: string | null;
  /** Page images accepted by the server so far, across every save. */
  saved: number;
  /** True once the manifest has been written and the document is closed. */
  completed: boolean;
};

export type BookletSession = {
  sessionId: string;
  state: SessionState;
  reading: Reading | null;
  verdict: Verdict;
  /** The operator-facing one-liner for the current verdict. */
  note: ReturnType<typeof message>;
  expected: Pair;
  pages: number;
  upload: UploadState;
  /** Feed a decoded code in. Called by the decode loop, so it must stay cheap. */
  report: (d: Detection) => void;
  /** The last page has no facing page: record it alone and close the document. */
  closeOnLastPage: () => Promise<void>;
  /** Close the document where it stands, without a trailing single page. */
  close: () => Promise<void>;
  /** Throw the session away and start again from page 1. */
  restart: () => void;
};

function newSessionId(): string {
  // The API accepts 6–64 chars of [A-Za-z0-9_-], which a UUID already satisfies.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** The boxes a crop needs, from whatever the decoder last reported. */
function boxesOf(live: readonly Detection[] | undefined) {
  return (live ?? []).map((d) => d.box).filter((b): b is NonNullable<typeof b> => !!b);
}

async function postJson(body: unknown): Promise<void> {
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // The API answers with a JSON error, but a proxy or a dropped connection will
    // not, so both shapes are handled rather than assuming the happy one.
    let detail = "";
    try {
      const j = (await res.json()) as { error?: string };
      detail = j.error ?? "";
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `The server refused the upload (HTTP ${res.status}).`);
  }
}

export function useBookletSession(
  videoRef: RefObject<HTMLVideoElement | null>,
): BookletSession {
  const [sessionId, setSessionId] = useState(newSessionId);
  const [state, setState] = useState<SessionState>(initialSession);
  const [reading, setReading] = useState<Reading | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(() => evaluate(initialSession(), { left: null, right: null }));
  const [upload, setUpload] = useState<UploadState>({ saving: false, error: null, saved: 0, completed: false });

  // Detections and dwell bookkeeping live in refs: they change many times a
  // second and only the verdict is worth re-rendering for.
  const seen = useRef<Detection[]>([]);
  const held = useRef<Spread | null>(null);
  const heldSince = useRef(0);
  const saving = useRef(false);

  const report = useCallback((d: Detection) => {
    // The list is pruned on read, so it only needs to outrun the seen window.
    if (seen.current.length > 64) seen.current = seen.current.slice(-32);
    seen.current.push(d);
  }, []);

  /** Save one page image for an accepted pair, and count it. */
  const savePage = useCallback(
    async (pair: Pair, boxes: readonly { x: number; y: number; width: number; height: number }[]) => {
      const shot = await captureSpreadJpeg(videoRef.current, boxes);
      if (!shot) {
        throw new Error("The camera has no frame to capture yet. Wait for the preview and try again.");
      }
      await postJson({
        sessionId,
        pair: { left: pair.left, right: pair.right },
        imageBase64: await blobToBase64(shot.blob),
      });
    },
    [videoRef, sessionId],
  );

  const writeManifest = useCallback(
    async (final: SessionState) => {
      await postJson({ sessionId, complete: true, spreads: final.accepted });
    },
    [sessionId],
  );

  /**
   * Accept a spread that has held long enough, then save it.
   *
   * State advances first and the image follows, because the ordering rules are
   * the operator's feedback and must not wait on the network. A failed upload is
   * therefore reported against a page that has already been counted as accepted
   * — the retry is manual, and the manifest is not written until a close, so a
   * failure here cannot silently produce a manifest missing a page.
   */
  const commit = useCallback(
    async (pair: Pair, boxes: readonly { x: number; y: number; width: number; height: number }[]) => {
      if (saving.current) return;
      saving.current = true;
      setUpload((u) => ({ ...u, saving: true, error: null }));
      try {
        await savePage(pair, boxes);
        setState((prev) => accept(prev, pair));
        setUpload((u) => ({ ...u, saved: u.saved + (pair.right ? 2 : 1) }));
        held.current = null;
      } catch (e) {
        setUpload((u) => ({ ...u, error: e instanceof Error ? e.message : "The page could not be saved." }));
      } finally {
        saving.current = false;
        setUpload((u) => ({ ...u, saving: false }));
      }
    },
    [savePage],
  );

  const restart = useCallback(() => {
    seen.current = [];
    held.current = null;
    heldSince.current = 0;
    // A new session id, not just a new sequence: pages are stored under
    // `<sessionId>/<left>-<right>.jpg` and the manifest under the same prefix, so
    // reusing the id after an abandoned run would leave that run's surplus pages
    // sitting in the folder next to the new ones. A fresh id starts clean.
    setSessionId(newSessionId());
    setState(initialSession());
    setReading(null);
    setVerdict(evaluate(initialSession(), { left: null, right: null }));
    setUpload({ saving: false, error: null, saved: 0, completed: false });
  }, []);

  const closeOnLastPage = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setUpload((u) => ({ ...u, saving: true, error: null }));
    try {
      const single = expectedPair(state);
      await savePage({ left: single.left, right: 0 }, boxesOf(reading?.live));
      const final = finishOnLeft(state);
      setState(final);
      await writeManifest(final);
      setUpload((u) => ({ ...u, saved: u.saved + 1, completed: true }));
    } catch (e) {
      setUpload((u) => ({ ...u, error: e instanceof Error ? e.message : "The document could not be closed." }));
    } finally {
      saving.current = false;
      setUpload((u) => ({ ...u, saving: false }));
    }
  }, [state, reading, savePage, writeManifest]);

  const close = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setUpload((u) => ({ ...u, saving: true, error: null }));
    try {
      const final = endSession(state);
      setState(final);
      await writeManifest(final);
      setUpload((u) => ({ ...u, completed: true }));
    } catch (e) {
      setUpload((u) => ({ ...u, error: e instanceof Error ? e.message : "The document could not be closed." }));
    } finally {
      saving.current = false;
      setUpload((u) => ({ ...u, saving: false }));
    }
  }, [state, writeManifest]);

  // The one loop: re-read the camera, re-evaluate, and act on a settled match.
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      seen.current = seen.current.filter((d) => now - d.at <= SEEN_WINDOW_MS);
      const r = readSpread(seen.current, now);
      setReading(r);

      const v = evaluate(state, r.spread);
      setVerdict(v);

      if (v.kind !== "match") {
        // Any interruption clears the dwell, so a page held half-turned never
        // gets captured on the strength of a moment before the turn.
        held.current = null;
        return;
      }

      if (!held.current || !sameSpread(held.current, r.spread)) {
        held.current = r.spread;
        heldSince.current = now;
        return;
      }
      if (now - heldSince.current >= DWELL_MS && !saving.current) {
        void commit(v.pair, boxesOf(r.live));
      }
    };

    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [state, commit]);

  return {
    sessionId,
    state,
    reading,
    verdict,
    note: message(verdict),
    expected: expectedPair(state),
    pages: pagesScanned(state),
    upload,
    report,
    closeOnLastPage,
    close,
    restart,
  };
}
