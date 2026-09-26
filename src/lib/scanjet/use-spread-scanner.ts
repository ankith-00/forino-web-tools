import { useCallback, useEffect, useRef, useState } from "react";

import {
  accept,
  evaluate,
  finishOnLeft,
  initialSession,
  type SessionState,
  type Spread,
  type Verdict,
} from "./sequence.ts";
import { readSpread, sameSpread, type Detection } from "./spread.ts";

/**
 * Ported from the ScanJet app (reactnative/src/lib/use-spread-scanner.ts). It
 * already only used plain React hooks, so it runs in the browser as written.
 *
 * A spread must read the same for STABLE_MS before it is judged, so a page
 * caught mid-turn is never reported as a scanning error.
 */

/** A spread must read the same for this long before it is judged, so a page mid-turn is not an error. */
const STABLE_MS = 400;
/** How long the last expected page must sit alone before "this is the last page" is offered. */
const LAST_PAGE_OFFER_MS = 2500;
const TICK_MS = 150;

export type ScannerView = {
  session: SessionState;
  verdict: Verdict;
  /** What each half reads right now (before the stability wait). */
  seen: Spread;
  misaligned: boolean;
  live: Detection[];
  /** The expected left page has been alone long enough that it may be the final page. */
  offerFinish: boolean;
  /** Bumped each time a spread is accepted, to drive a flash and a page capture. */
  acceptedCount: number;
};

const NOTHING: Spread = { left: null, right: null };

/**
 * The state every session starts from. `initialSession` and `evaluate` are both
 * pure and the session is only ever replaced, never mutated, so one shared
 * frozen-by-convention value is safe — and keeping it out of the hook body means
 * no ref has to be read during render.
 */
const INITIAL_VIEW: ScannerView = (() => {
  const session = initialSession();
  return {
    session,
    verdict: evaluate(session, NOTHING),
    seen: NOTHING,
    misaligned: false,
    live: [],
    offerFinish: false,
    acceptedCount: 0,
  };
})();

export function useSpreadScanner() {
  const detections = useRef<Detection[]>([]);
  const candidate = useRef<{ spread: Spread; since: number }>({ spread: NOTHING, since: 0 });
  const sessionRef = useRef<SessionState>(INITIAL_VIEW.session);
  const verdictRef = useRef<Verdict>(INITIAL_VIEW.verdict);

  const [view, setView] = useState<ScannerView>(INITIAL_VIEW);

  const push = useCallback((d: Detection) => {
    const list = detections.current;
    list.push(d);
    if (list.length > 64) list.splice(0, list.length - 64);
  }, []);

  const setSession = useCallback((next: SessionState) => {
    sessionRef.current = next;
    verdictRef.current = evaluate(next, NOTHING);
    candidate.current = { spread: NOTHING, since: Date.now() };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const reading = readSpread(detections.current, now);
      const c = candidate.current;
      if (!sameSpread(c.spread, reading.spread)) candidate.current = { spread: reading.spread, since: now };
      const stableFor = now - candidate.current.since;
      const stable = stableFor >= STABLE_MS;

      let session = sessionRef.current;
      let verdict = evaluate(session, stable ? reading.spread : NOTHING);
      let accepted = false;
      if (verdict.kind === "match") {
        session = accept(session, verdict.pair);
        sessionRef.current = session;
        accepted = true;
      } else if (!stable && !reading.misaligned && !session.finished && verdictRef.current.kind !== "match") {
        // While the spread settles, keep the previous judgement instead of flicking to "waiting".
        verdict = verdictRef.current;
      }
      verdictRef.current = verdict;
      const offerFinish = verdict.kind === "partial" && verdict.side === "left" && stableFor >= LAST_PAGE_OFFER_MS;
      setView((prev) => ({
        session,
        verdict,
        seen: reading.spread,
        misaligned: reading.misaligned,
        live: reading.live,
        offerFinish,
        acceptedCount: prev.acceptedCount + (accepted ? 1 : 0),
      }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const finishOnLastPage = useCallback(() => setSession(finishOnLeft(sessionRef.current)), [setSession]);
  const reset = useCallback(() => {
    detections.current = [];
    setSession(initialSession());
  }, [setSession]);

  return { view, push, finishOnLastPage, reset };
}
