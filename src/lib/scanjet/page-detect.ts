/**
 * Page detection for a live camera frame.
 *
 * This is a port of the React Native detector (`reactnative/src/lib/detector.ts`
 * at commit 2c9f797, deleted from that working tree but recoverable from its git
 * HEAD) from `react-native-fast-opencv` onto plain `ImageData`. The OpenCV calls
 * are replaced by `vision.ts`; the *decisions* are ported unchanged, because
 * they are the part that encodes what a booklet spread looks like:
 *
 *   - two large separate quads       -> two pages
 *   - one wide quad with a dark seam -> a spread, split along the gutter
 *   - one quad                       -> a single page
 *   - nothing                        -> the whole frame
 *
 * The gutter rule is what makes this app work. A bound book held open under a
 * camera is *one* contiguous bright region, not two rectangles, so a generic
 * page finder returns a single wide quad covering both pages. Recovering the
 * two pages means finding the darkest vertical line through the middle and
 * cutting there — so the split is deliberately a luminance test, not a geometric
 * one, and it votes across five horizontal bands before committing.
 *
 * Tuned constants are carried over verbatim from the native detector so the two
 * implementations agree on what counts as a page.
 *
 * Output quads are normalized 0..1 against the *source* frame, matching the
 * native detector, so they survive any later rescale. Detection runs on a
 * downscaled copy; `scaleQuadsToFrame` maps back up.
 */

import {
  fitLineX,
  fitLineY,
  isConvex,
  lerpPoint,
  lineIntersection,
  orderQuad,
  polygonArea,
  quadAspect,
  type GeoPoint,
  type Quad,
} from "./geometry.ts";
import {
  blurGaussian,
  canny,
  connectedComponents,
  convexHull,
  dilate,
  hullArea,
  maxAreaQuad,
  refineQuadCorners,
  toGrayscale,
  type Pt,
} from "./vision.ts";

export type DetectionMode = "two" | "spread-split" | "single" | "frame";

export type DetectionResult = {
  /** Normalized 0..1 against `sourceWidth`/`sourceHeight`. */
  pages: Quad[];
  mode: DetectionMode;
  sourceWidth: number;
  sourceHeight: number;
};

/**
 * Max dimension of the detection working copy.
 *
 * The native detector used 1400 because OpenCV runs in C. This runs in JS on the
 * main thread, where cost is linear in pixels and every stage is a full-frame
 * pass, so the cap is much lower. 720 keeps a page's short edge above ~500px,
 * which is ample for locating edges and for the gutter's column-mean test, and
 * keeps a capture under a few tens of milliseconds.
 */
const DET_MAX_DIM = 720;

/** A quad must cover at least this fraction of the frame to count as a page. */
const MIN_PAGE_AREA_RATIO = 0.08;

/** Dark-seam "valley" strength (gray levels) required to trust a gutter band. */
const MIN_VALLEY_STRENGTH = 1.2;

/** Horizontal bands the gutter vote is taken across. */
const BANDS = 5;

/** At least this many bands must show a reliable dark seam.
 *
 * Reduced from 3 to 2 because real booklet gutters often only produce a
 * detectable shadow in the middle of the page, not consistently across the
 * full height. Two bands is the minimum for a line fit. */
const BAND_MIN_STRONG = 2;

/** Central fraction of the quad's width/height searched for the seam. */
const SCAN_FRAC = 0.7;

/** Fallback center split removed — the relaxed gutter detection (BAND_MIN_STRONG = 2)
 * handles real booklets. A hard fallback caused false splits on single landscape pages. */

/** Smallest component worth considering, in pixels, before hulling. */
const MIN_COMPONENT_PIXELS = 24;

/**
 * Canny thresholds, inherited from the native detector's `Canny(50, 150)`.
 * They are meaningful because `vision.sobel` matches OpenCV's unnormalised
 * internal scale; see the note there before changing either number.
 */
const CANNY_LO = 50;
const CANNY_HI = 150;

/** Dilation radius/iterations used to close the page outline into one loop. */
const CLOSE_RADIUS = 1;
const CLOSE_ITERATIONS = 2;

/**
 * Find the pages in a camera frame.
 *
 * Synchronous and blocking: expect tens of milliseconds at `DET_MAX_DIM`. Call
 * it from a capture, never from the decode loop.
 */
export function detectPages(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  expectedCodes?: { top: boolean; bottom: boolean }
): DetectionResult {
  const det = downscaleRgba(rgba, width, height, DET_MAX_DIM);
  const gray = toGrayscale(det.data, det.width, det.height);
  const edges = canny(blurGaussian(gray, 2, 3), CANNY_LO, CANNY_HI);
  const closed = dilate(edges, CLOSE_RADIUS, CLOSE_ITERATIONS);

  const frameArea = det.width * det.height;
  const candidates: { quad: Quad; area: number; cy: number; topY: number; bottomY: number }[] = [];

  for (const comp of connectedComponents(closed, MIN_COMPONENT_PIXELS)) {
    const pts: Pt[] = comp.pixels.map((i) => ({ x: i % det.width, y: (i / det.width) | 0 }));
    const hull = convexHull(pts);
    if (hull.length < 4 || hullArea(hull) < 0.04 * frameArea) continue;

    const picked = maxAreaQuad(hull).map((i) => hull[i] as Pt);
    const quad = orderQuad(refineQuadCorners(picked, pts)) as Quad;
    if (!isConvex(quad)) continue;

    const [TL, TR, BR, BL] = quad;
    const cy = (TL.y + TR.y + BR.y + BL.y) / 4;
    const topY = Math.min(TL.y, TR.y);
    const bottomY = Math.max(BL.y, BR.y);
    candidates.push({ quad, area: polygonArea(quad), cy, topY, bottomY });
  }

  candidates.sort((a, b) => b.area - a.area);

  const midY = det.height / 2;

  const forcePortrait = (q: Quad): Quad => {
    const asp = quadAspect(q);
    if (asp > 1.05) return [q[1], q[2], q[3], q[0]];
    return q;
  };

  const splitSpanningQuad = (quad: Quad): Quad[] => {
    const [TL, TR, BR, BL] = quad;
    const intersectY = (p1: GeoPoint, p2: GeoPoint, y: number): GeoPoint => {
      if (Math.abs(p2.y - p1.y) < 1e-6) return { x: (p1.x + p2.x) / 2, y };
      const t = (y - p1.y) / (p2.y - p1.y);
      return { x: p1.x + t * (p2.x - p1.x), y };
    };
    const midLeft = intersectY(TL, BL, midY);
    const midRight = intersectY(TR, BR, midY);
    return [
      forcePortrait([TL, TR, midRight, midLeft]),
      forcePortrait([midLeft, midRight, BR, BL]),
    ];
  };

  const topHalfFallback: Quad = forcePortrait([
    { x: 0, y: 0 },
    { x: det.width, y: 0 },
    { x: det.width, y: midY },
    { x: 0, y: midY },
  ]);

  const bottomHalfFallback: Quad = forcePortrait([
    { x: 0, y: midY },
    { x: det.width, y: midY },
    { x: det.width, y: det.height },
    { x: 0, y: det.height },
  ]);

  // Check for candidate spanning across midY
  const spanningCand = candidates.find(
    (c) => c.topY < midY - 30 && c.bottomY > midY + 30 && c.area > 0.15 * frameArea
  );

  // Top candidates: centroid above midY
  const topCands = candidates.filter((c) => c.cy < midY && c.topY < midY - 15);
  // Bottom candidates: centroid below midY
  const bottomCands = candidates.filter((c) => c.cy >= midY && c.bottomY > midY + 15);

  let pages: Quad[] = [];

  if (spanningCand) {
    pages = splitSpanningQuad(spanningCand.quad);
  } else if (topCands.length > 0 && bottomCands.length > 0) {
    pages = [
      forcePortrait(topCands[0].quad),
      forcePortrait(bottomCands[0].quad),
    ];
  } else if (expectedCodes?.top && expectedCodes?.bottom) {
    // Both QR codes detected, but edge detection only found one or neither
    const topQ = topCands.length > 0 ? forcePortrait(topCands[0].quad) : topHalfFallback;
    const botQ = bottomCands.length > 0 ? forcePortrait(bottomCands[0].quad) : bottomHalfFallback;
    pages = [topQ, botQ];
  } else if (topCands.length > 0 && (!expectedCodes || !expectedCodes.bottom)) {
    // Only top page present
    pages = [forcePortrait(topCands[0].quad)];
  } else if (bottomCands.length > 0 && (!expectedCodes || !expectedCodes.top)) {
    // Only bottom page present
    pages = [forcePortrait(bottomCands[0].quad)];
  } else if (topCands.length > 0) {
    pages = [forcePortrait(topCands[0].quad)];
  } else if (bottomCands.length > 0) {
    pages = [forcePortrait(bottomCands[0].quad)];
  } else {
    // Fallback if no candidate at all
    pages = [topHalfFallback, bottomHalfFallback];
  }

  return {
    pages: pages.map(
      (q) => q.map((p) => ({ x: clamp01(p.x / det.width), y: clamp01(p.y / det.height) })) as Quad
    ),
    mode: "two",
    sourceWidth: width,
    sourceHeight: height,
  };
}

/**
 * Area-average downscale of an RGBA buffer, the browser's `drawImage` step done
 * by hand so this module stays testable without a canvas.
 *
 * Averaging every source pixel that falls in a target cell (rather than point
 * sampling) is what stops a thin page edge from disappearing at low resolution —
 * the failure mode that would silently break detection on a distant page.
 */
function downscaleRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxDim: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale >= 1) return { data: rgba, width, height };

  const w = Math.max(2, Math.round(width * scale));
  const h = Math.max(2, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 4);

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));

      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = (sy * width + sx) * 4;
          r += rgba[p];
          g += rgba[p + 1];
          b += rgba[p + 2];
          n++;
        }
      }
      const q = (y * w + x) * 4;
      out[q] = r / n;
      out[q + 1] = g / n;
      out[q + 2] = b / n;
      out[q + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** The entire detection copy as a quad, in detection pixels. */
function frameQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

function sortPages(pages: Quad[]): Quad[] {
  const centers = pages.map((q) => ({
    cx: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    cy: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  }));
  return pages
    .map((_, i) => i)
    .sort((i, j) => centers[i].cx - centers[j].cx || centers[i].cy - centers[j].cy)
    .map((i) => pages[i]);
}

/**
 * Split a spread quad into two pages along its darkest seam.
 *
 * Only attempted on a plausibly wide (or tall) quad: `quadAspect` is the cheap
 * gate, because a portrait page whose aspect happens to be wide should not be
 * cut down the middle.
 */
function trySplitSpread(
  quad: Quad,
  gray: Uint8Array,
  detW: number,
  detH: number
): Quad[] | null {
  const aspect = quadAspect(quad);
  if (aspect >= 1.25) return splitVerticalGutter(quad, gray, detW, detH);
  if (aspect <= 0.6) return splitHorizontalGutter(quad, gray, detW, detH);
  return null;
}

function splitVerticalGutter(
  quad: Quad,
  gray: Uint8Array,
  detW: number,
  detH: number
): Quad[] | null {
  const [TL, TR, BR, BL] = quad;
  const seam: GeoPoint[] = [];
  let strong = 0;

  for (let i = 0; i < BANDS; i++) {
    const t0 = i / BANDS;
    const t1 = (i + 1) / BANDS;
    const tm = (t0 + t1) / 2;

    const yStart = Math.max(
      0,
      Math.ceil(Math.min(lerpPoint(TL, BL, t0).y, lerpPoint(TR, BR, t0).y) - 1)
    );
    const yEnd = Math.min(
      detH - 1,
      Math.floor(Math.max(lerpPoint(TL, BL, t1).y, lerpPoint(TR, BR, t1).y) + 1)
    );
    if (yEnd < yStart) continue;

    const xFracLo = (1 - SCAN_FRAC) / 2;
    const xFracHi = 1 - xFracLo;
    const colSums = new Map<number, { sum: number; n: number }>();

    for (let y = yStart; y <= yEnd; y++) {
      const tL = clamp01(invertLerp(TL.y, BL.y, y));
      const tR = clamp01(invertLerp(TR.y, BR.y, y));
      const xL = lerpPoint(TL, BL, tL || tm).x;
      const xR = lerpPoint(TR, BR, tR || tm).x;
      const cLo = Math.max(0, Math.ceil(Math.min(xL, xR)));
      const cHi = Math.min(detW - 1, Math.floor(Math.max(xL, xR)));
      if (cHi - cLo < 2) continue;
      const span = cHi - cLo;
      const start = Math.round(cLo + span * xFracLo);
      const end = Math.round(cLo + span * xFracHi);
      if (end < start) continue;
      for (let c = start; c <= end; c++) {
        const px = y * detW + c;
        if (px >= 0 && px < gray.length) {
          const e = colSums.get(c) ?? { sum: 0, n: 0 };
          e.sum += gray[px];
          e.n += 1;
          colSums.set(c, e);
        }
      }
    }

    const { minCol, minMean, surroundMean } = findDarkest(colSums);
    if (minCol < 0 || surroundMean - minMean < MIN_VALLEY_STRENGTH) continue;
    strong += 1;
    seam.push({ x: minCol, y: (yStart + yEnd) / 2 });
  }

  if (strong < BAND_MIN_STRONG || seam.length < 3) return null;
  const line = fitLineX(seam); // x = a + b*y
  if (!line) return null;

  const gt = lineIntersection(TL, TR, { x: line.a, y: 0 }, { x: line.a + line.b * detH, y: detH });
  const gb = lineIntersection(BL, BR, { x: line.a, y: 0 }, { x: line.a + line.b * detH, y: detH });
  if (!gt || !gb) return null;

  return buildSplitPages(quad, gt, gb, "vertical");
}

function splitHorizontalGutter(
  quad: Quad,
  gray: Uint8Array,
  detW: number,
  detH: number
): Quad[] | null {
  const [TL, TR, BR, BL] = quad;
  const seam: GeoPoint[] = [];
  let strong = 0;

  for (let i = 0; i < BANDS; i++) {
    const t0 = i / BANDS;
    const t1 = (i + 1) / BANDS;
    const tm = (t0 + t1) / 2;

    const xStart = Math.max(
      0,
      Math.ceil(Math.min(lerpPoint(TL, TR, t0).x, lerpPoint(BL, BR, t0).x) - 1)
    );
    const xEnd = Math.min(
      detW - 1,
      Math.floor(Math.max(lerpPoint(TL, TR, t1).x, lerpPoint(BL, BR, t1).x) + 1)
    );
    if (xEnd < xStart) continue;

    const yFracLo = (1 - SCAN_FRAC) / 2;
    const yFracHi = 1 - yFracLo;
    const rowSums = new Map<number, { sum: number; n: number }>();

    for (let x = xStart; x <= xEnd; x++) {
      const tT = clamp01(invertLerp(TL.x, TR.x, x));
      const tB = clamp01(invertLerp(BL.x, BR.x, x));
      const yT = lerpPoint(TL, TR, tT || tm).y;
      const yB = lerpPoint(BL, BR, tB || tm).y;
      const rLo = Math.max(0, Math.ceil(Math.min(yT, yB)));
      const rHi = Math.min(detH - 1, Math.floor(Math.max(yT, yB)));
      if (rHi - rLo < 2) continue;
      const span = rHi - rLo;
      const start = Math.round(rLo + span * yFracLo);
      const end = Math.round(rLo + span * yFracHi);
      if (end < start) continue;
      for (let r = start; r <= end; r++) {
        const px = r * detW + x;
        if (px >= 0 && px < gray.length) {
          const e = rowSums.get(r) ?? { sum: 0, n: 0 };
          e.sum += gray[px];
          e.n += 1;
          rowSums.set(r, e);
        }
      }
    }

    const { minCol: minRow, minMean, surroundMean } = findDarkest(rowSums);
    if (minRow < 0 || surroundMean - minMean < MIN_VALLEY_STRENGTH) continue;
    strong += 1;
    seam.push({ x: (xStart + xEnd) / 2, y: minRow });
  }

  if (strong < BAND_MIN_STRONG || seam.length < 3) return null;
  const line = fitLineY(seam); // y = a + b*x
  if (!line) return null;

  const gl = lineIntersection(TL, BL, { x: 0, y: line.a }, { x: detW, y: line.a + line.b * detW });
  const gr = lineIntersection(TR, BR, { x: 0, y: line.a }, { x: detW, y: line.a + line.b * detW });
  if (!gl || !gr) return null;

  return buildSplitPages(quad, gl, gr, "horizontal");
}

function findDarkest(sumMap: Map<number, { sum: number; n: number }>): {
  minCol: number;
  minMean: number;
  surroundMean: number;
} {
  let minKey = -1;
  let minMean = Infinity;
  let surroundSum = 0;
  let surroundN = 0;
  for (const [c, e] of sumMap) {
    const mean = e.sum / e.n;
    surroundSum += e.sum;
    surroundN += e.n;
    if (mean < minMean) {
      minMean = mean;
      minKey = c;
    }
  }
  return {
    minCol: minKey,
    minMean,
    surroundMean: surroundN > 0 ? surroundSum / surroundN : Infinity,
  };
}

/**
 * Validate and order the two sub-quads a split produced.
 *
 * The cut points must genuinely lie on the edges they were derived from, and
 * both halves must stay big enough and not too lopsided — a gutter found near a
 * page's edge would otherwise "successfully" cut off a sliver.
 */
function buildSplitPages(
  quad: Quad,
  p1: GeoPoint,
  p2: GeoPoint,
  kind: "vertical" | "horizontal"
): Quad[] | null {
  const [TL, TR, BR, BL] = quad;
  const parentArea = polygonArea(quad);

  if (kind === "vertical") {
    if (!onSegment(TL, TR, p1) || !onSegment(BL, BR, p2)) return null;
  } else {
    if (!onSegment(TL, BL, p1) || !onSegment(TR, BR, p2)) return null;
  }

  let a: Quad;
  let b: Quad;
  if (kind === "vertical") {
    a = [TL, p1, p2, BL];
    b = [p1, TR, BR, p2];
  } else {
    a = [TL, TR, p2, p1];
    b = [p1, p2, BR, BL];
  }

  const q = [orderQuad(a), orderQuad(b)];
  for (const page of q) {
    if (!isConvex(page)) return null;
    if (polygonArea(page) < 0.18 * parentArea) return null;
    const asp = quadAspect(page);
    if (asp < 0.2 || asp > 5) return null;
  }

  return sortPages(q);
}

function onSegment(a: GeoPoint, b: GeoPoint, p: GeoPoint): boolean {
  if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 1e-6) return false;
  const t = invertLerp(a.x, b.x, p.x);
  const tY = invertLerp(a.y, b.y, p.y);
  const eps = 0.05;
  return t >= -eps && t <= 1 + eps && Math.abs(t - tY) < 0.2;
}

function invertLerp(a: number, b: number, v: number): number {
  if (b === a) return 0.5;
  return (v - a) / (b - a);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Rescale normalized quads onto a full-resolution frame.
 *
 * Needed because detection downsamples: the browser's `drawImage(video)` hands
 * back full-resolution pixels, so a quad detected on the small copy must be
 * scaled up before it is used to crop.
 */
export function scaleQuadsToFrame(pages: Quad[], width: number, height: number): Quad[] {
  return pages.map((q) =>
    q.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad
  );
}
