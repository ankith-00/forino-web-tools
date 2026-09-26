import type { Spread } from './sequence';

/**
 * Ported unchanged from the ScanJet app (reactnative/src/lib/spread.ts).
 * Turns the flat list of codes the camera reports into "which page is on the
 * left, which is on the right", splitting at the centre line.
 */

/** One code seen by the camera. `cx` is its centre across the preview, 0 (left edge) → 1 (right edge). */
export type Detection = {
  value: string;
  cx: number;
  /** Where to draw it, in preview pixels. Optional: the reader does not need it. */
  box?: { x: number; y: number; width: number; height: number };
  at: number;
};

export type Reading = {
  spread: Spread;
  /** Both QRs are on the same half: the spine is not on the centre line. */
  misaligned: boolean;
  /** Codes still in view, for drawing. */
  live: Detection[];
};

/** A QR counts as "in view" for this long after it was last reported. */
export const SEEN_WINDOW_MS = 700;

/** Only page QRs take part; anything else in view (the cover barcode, a stray QR) is ignored. */
export function pageNumber(value: string): number | null {
  const v = value.trim();
  return /^\d{1,5}$/.test(v) ? Number(v) : null;
}

/**
 * Split what is in view at the centre line: codes left of it belong to the left
 * page, codes right of it to the right page.
 */
export function readSpread(detections: readonly Detection[], now: number, windowMs = SEEN_WINDOW_MS): Reading {
  const latest = new Map<string, Detection>();
  for (const d of detections) {
    if (now - d.at > windowMs || pageNumber(d.value) === null) continue;
    const prev = latest.get(d.value);
    if (!prev || prev.at < d.at) latest.set(d.value, d);
  }
  const live = [...latest.values()];
  const left = pickHalf(live.filter(d => d.cx < 0.5));
  const right = pickHalf(live.filter(d => d.cx >= 0.5));

  // Two page numbers in one half at the same moment means the book is off-centre.
  const misaligned = left.crowded || right.crowded;
  if (misaligned) return { spread: { left: null, right: null }, misaligned, live };

  return {
    spread: {
      left: left.code ? pageNumber(left.code.value) : null,
      right: right.code ? pageNumber(right.code.value) : null,
    },
    misaligned: false,
    live: live.filter(d => d === left.code || d === right.code),
  };
}

/** Codes this close together in time were in the same frame. */
export const SAME_FRAME_MS = 250;

/**
 * The code a half shows now is the most recently seen one. An older code in the
 * same half is the page that was just turned away, still inside the window; it
 * only means "off-centre" when both were seen in the same frame.
 */
function pickHalf(codes: Detection[]): { code: Detection | null; crowded: boolean } {
  if (codes.length === 0) return { code: null, crowded: false };
  const sorted = [...codes].sort((a, b) => b.at - a.at);
  const newest = sorted[0];
  const crowded = sorted.slice(1).some(d => newest.at - d.at <= SAME_FRAME_MS);
  return { code: newest, crowded };
}

export function sameSpread(a: Spread, b: Spread): boolean {
  return a.left === b.left && a.right === b.right;
}
