"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import type { Detection } from "@/lib/scanjet/spread";
import { frameToView } from "@/lib/scanjet/capture";

/**
 * The decode loop, shared by every camera source.
 *
 * The loop only ever needs three things from its source: intrinsic pixel size,
 * on-screen size, and something `drawImage` accepts. A `<video>` holding a local
 * or UVC stream satisfies all three, and so does a `<canvas>` holding a frame
 * that arrived over HTTP from a tethered phone — which is why those two cases
 * share this code instead of diverging. Nothing downstream (the ordering
 * pipeline, `captureSpreadJpeg`) can tell the difference.
 *
 * The .wasm is served from our own origin (public/zxing_reader.wasm, copied from
 * node_modules on install) so nothing is loaded from a CDN.
 *
 * Webcam frames are decoded with ZXing compiled to WebAssembly, which reports
 * EVERY QR in a frame together with its bounds. That is the whole point: a
 * spread is two page codes at once, one either side of the centre line, so a
 * single-symbol reader (what `@zxing/browser`'s `decodeFromCanvas` returns, and
 * what `/scanner` uses for attendance roll-call) cannot drive this screen.
 *
 * The page QRs are small — about 12 mm, roughly 40 px in a 1080p view of an
 * open A4 spread — so `tryHarder` is on. jsQR and Chrome's BarcodeDetector both
 * miss codes at that size; ZXing reads them reliably.
 */

const WASM_URL = "/zxing_reader.wasm";
/** How often to decode a frame. Fast enough to feel live, slow enough to stay cool on a phone. */
export const DECODE_INTERVAL_MS = 120;
const MAX_SYMBOLS = 8;

/** Either a live `<video>` or a `<canvas>` that received a frame. */
export type FrameSurface = HTMLVideoElement | HTMLCanvasElement;

type Reader = {
  readBarcodes: typeof import("zxing-wasm/reader").readBarcodes;
};

/** ZXing is chatty on a page that decodes forever; these are its known log lines. */
const NOISE = [
  "MultiFormatReader: non-ReaderException",
  "Trying to play video that is already playing.",
  "Trying to play video that has ended.",
  "It was not possible to play the video.",
  "got interrupted by new loading request",
];

let readerPromise: Promise<Reader> | null = null;

/** Loaded on demand and memoised, so the decoder never runs during SSR. */
function loadReader(): Promise<Reader> {
  readerPromise ??= import("zxing-wasm/reader").then((m) => {
    m.prepareZXingModule({
      overrides: {
        locateFile: (file: string, prefix: string) => (file.endsWith(".wasm") ? WASM_URL : prefix + file),
      },
    });
    return { readBarcodes: m.readBarcodes };
  });
  return readerPromise;
}

function isNoise(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === "string" && NOISE.some((p) => first.startsWith(p));
}

/** A video reports its frame size as `videoWidth`; a canvas uses plain `width`. */
function intrinsic(el: FrameSurface) {
  return el instanceof HTMLVideoElement
    ? { w: el.videoWidth, h: el.videoHeight }
    : { w: el.width, h: el.height };
}

/**
 * The preview is `object-fit: contain`, so the frame is scaled *and* offset
 * inside the element. The mapping lives with its inverse in `@/lib/scanjet/capture`
 * rather than being re-derived here, because the boxes this produces are the
 * ones `captureSpreadJpeg` later has to map back, and two hand-written copies
 * of that geometry drift apart the moment the fit changes.
 *
 * Note this maps into the whole element box, not just the drawn area: the
 * letterbox bars are part of the element, so `cx` stays a plain fraction of the
 * element width and the overlay needs no knowledge of the fit at all.
 */
function toView(surface: FrameSurface, b: { x: number; y: number; width: number; height: number }) {
  const { w: iw, h: ih } = intrinsic(surface);
  return frameToView(iw, ih, surface.clientWidth, surface.clientHeight, b);
}

/**
 * Decodes whatever the surface is showing, forever, until the effect is torn down.
 *
 * Frames with no dimensions yet (the surface is mounted but nothing has arrived)
 * are skipped rather than treated as an error, which is the normal state for a
 * canvas fed over HTTP.
 */
export function useSpreadDecode({
  surfaceRef,
  onDetect,
  enabled,
  onError,
}: {
  surfaceRef: RefObject<FrameSurface | null>;
  onDetect: (d: Detection) => void;
  enabled: boolean;
  onError?: (message: string) => void;
}) {
  // Keep the newest callback without restarting the loop on every render.
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      onError?.("This browser cannot read pixels from a canvas.");
      return;
    }

    // Quiet the decoder's known log lines for as long as the loop runs.
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => {
      if (!isNoise(args)) originalWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      if (!isNoise(args)) originalError(...args);
    };

    const scan = async () => {
      if (stopped) return;
      try {
        const surface = surfaceRef.current;
        if (surface) {
          const { w: iw, h: ih } = intrinsic(surface);
          if (iw > 0 && ih > 0) {
            if (canvas.width !== iw || canvas.height !== ih) {
              canvas.width = iw;
              canvas.height = ih;
            }
            ctx.drawImage(surface, 0, 0, iw, ih);
            const { readBarcodes } = await loadReader();
            const results = await readBarcodes(ctx.getImageData(0, 0, iw, ih), {
              formats: ["QRCode"],
              tryHarder: true,
              maxNumberOfSymbols: MAX_SYMBOLS,
            });
            if (!stopped) {
              const at = Date.now();
              for (const r of results) {
                if (!r.isValid) continue;
                const p = r.position;
                const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
                const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
                const x = Math.min(...xs);
                const y = Math.min(...ys);
                const frameBox = { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
                const box = toView(surface, frameBox);
                onDetectRef.current({
                  value: r.text,
                  cx: (box.x + box.width / 2) / (surface.clientWidth || 1),
                  box,
                  at,
                });
              }
            }
          }
        }
      } catch (e) {
        // A failed decode means the wasm never loaded, which is not recoverable
        // by retrying — but a dropped frame is, so only report the first kind.
        if (e instanceof Error && /fetch|dynamically imported module|WebAssembly/i.test(e.message)) {
          onError?.("The QR decoder failed to load. Run `npm run copy-wasm` and reload.");
        }
      }
      timer = setTimeout(scan, DECODE_INTERVAL_MS);
    };
    scan();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [surfaceRef, enabled, onError]);
}
