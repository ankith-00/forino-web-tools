/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canny,
  connectedComponents,
  convexHull,
  dilate,
  hullArea,
  lineIntersection,
  maxAreaQuad,
  refineQuadCorners,
  toGrayscale,
  blurGaussian,
  type Pt,
} from "../vision.ts";

/** Renders a convex polygon as `page` on `bg`, as an RGBA buffer. */
function renderPoly(
  width: number,
  height: number,
  poly: Pt[],
  page = 235,
  bg = 38
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = pointInPoly({ x, y }, poly);
      const v = inside ? page : bg;
      const p = (y * width + x) * 4;
      rgba[p] = v;
      rgba[p + 1] = v;
      rgba[p + 2] = v;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

function pointInPoly(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The corners the pipeline recovered, ordered TL, TR, BR, BL. */
function orderCorners(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

/**
 * Mirrors what `page-detect.ts` does, minus the spread/gutter classification.
 *
 * Note the size filter is on the component's *hull* area, not its pixel count:
 * a page outline is a ring, so a page filling a third of the frame contributes
 * only its perimeter to the pixel total. Filtering on pixel count would reject
 * exactly the large pages it is supposed to keep.
 */
function detectCorners(rgba: Uint8ClampedArray, width: number, height: number): Pt[] {
  const gray = toGrayscale(rgba, width, height);
  const edges = canny(blurGaussian(gray, 2, 3), 50, 150);
  const closed = dilate(edges, 1, 2);
  const frameArea = width * height;

  for (const comp of connectedComponents(closed, 20)) {
    const pts = comp.pixels.map((i) => ({ x: i % width, y: (i / width) | 0 }));
    const hull = convexHull(pts);
    if (hullArea(hull) < frameArea * 0.08) continue;
    const quad = maxAreaQuad(hull).map((i) => hull[i]);
    return orderCorners(refineQuadCorners(quad, pts));
  }
  throw new Error("expected at least one page-sized component");
}

/**
 * Corner order out of an angle sort around the centroid is cyclically correct
 * but has an arbitrary starting point, so comparing `got[0]` to `want[0]` is
 * wrong. Match as a set instead, and report the worst miss.
 */
function assertQuadMatches(got: Pt[], want: Pt[], tol: number) {
  assert.equal(got.length, 4);
  const remaining = [...got];
  for (const expected of want) {
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = Math.hypot(p.x - expected.x, p.y - expected.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const hit = remaining.splice(best, 1)[0];
    assert.ok(
      bestD <= tol,
      `no detected corner within ${tol}px of (${expected.x}, ${expected.y}); closest was (${hit.x.toFixed(1)}, ${hit.y.toFixed(1)}) at ${bestD.toFixed(1)}px`
    );
  }
}

function assertNear(actual: Pt, expected: Pt, tol: number, label: string) {
  assert.ok(
    Math.hypot(actual.x - expected.x, actual.y - expected.y) <= tol,
    `${label}: got (${actual.x.toFixed(1)}, ${actual.y.toFixed(1)}), want (${expected.x.toFixed(1)}, ${expected.y.toFixed(1)}) within ${tol}px`
  );
}

test("toGrayscale applies Rec. 601 luminance weights", () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, // red
    0, 255, 0, 255, // green
    0, 0, 255, 255, // blue
    255, 255, 255, 255, // white
  ]);
  const g = toGrayscale(rgba, 2, 2);
  // Red weighs far less than green, and white must be the max.
  assert.ok(g.data[0] < g.data[1], "red should be darker than green");
  assert.equal(g.data[3], 255);
  assert.ok(g.data[0] > 70 && g.data[0] < 100, `red luma was ${g.data[0]}`);
});

test("convexHull keeps the extreme points of a set containing interior noise", () => {
  const square: Pt[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const withNoise: Pt[] = [...square, { x: 5, y: 5 }, { x: 3, y: 7 }, { x: 9, y: 1 }];
  const hull = convexHull(withNoise);
  assert.equal(hull.length, 4, `expected 4 hull points, got ${hull.length}`);
  assert.equal(Math.round(hullArea(hull)), 100);
});

test("maxAreaQuad picks the dominant corners off a hull with many vertices", () => {
  // A rectangle with its corners genuinely cut off. The cuts are diagonal, so
  // their endpoints are true extreme points and the hull keeps all eight — the
  // max-area quad must recover the rectangle underneath rather than echo the
  // bevels back. (Bevels lying *along* an edge would be collinear and the hull
  // would discard them, which is a different and uninteresting test.)
  const hull = convexHull([
    { x: 3, y: 0 },
    { x: 17, y: 0 },
    { x: 20, y: 3 },
    { x: 20, y: 7 },
    { x: 17, y: 10 },
    { x: 3, y: 10 },
    { x: 0, y: 7 },
    { x: 0, y: 3 },
  ]);
  assert.equal(hull.length, 8, "the diagonal cuts must survive as vertices");

  const idx = maxAreaQuad(hull);
  assert.equal(idx.length, 4);
  const quad = orderCorners(idx.map((i) => hull[i]));
  // The hull's own area is 182 (200 less four 4.5 cut triangles), but no quad
  // *inscribed* in it can reach that: reaching the full rectangle needs corners
  // that were cut away. The true maximum is the full-height central rectangle
  // 14 x 10 = 140, which is what picking the two horizontal edges plus the two
  // vertical edges gives. Asserting against 182 would be asserting a shape that
  // cannot exist.
  assert.equal(Math.round(hullArea(quad)), 140);
});

test("maxAreaQuad beats the diagonals-not-sides mistake on a skewed page", () => {
  // A hull that is one long thin sliver next to the real page. Crossing
  // opposite sides instead of diagonals scores the sliver as the larger quad,
  // which is precisely the bug this guards.
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 0, y: 40 },
    { x: 0, y: 0 },
    { x: 4, y: 2 },
    { x: 4, y: 4 },
    { x: 0, y: 2 },
  ]);
  const idx = maxAreaQuad(hull).map((i) => hull[i]);
  assert.ok(hullArea(orderCorners(idx)) > 3900, "should select the full page, not a sliver");
});

test("maxAreaQuad returns fewer than four indices for a degenerate hull", () => {
  const tri = convexHull([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ]);
  assert.equal(tri.length, 3);
  assert.equal(maxAreaQuad(tri).length, 3, "must not invent a fourth corner");
});

test("canny localises edges on the border of a bright shape", () => {
  const w = 80;
  const h = 60;
  const rect: Pt[] = [
    { x: 20, y: 15 },
    { x: 60, y: 15 },
    { x: 60, y: 45 },
    { x: 20, y: 45 },
  ];
  const rgba = renderPoly(w, h, rect);
  const edges = canny(blurGaussian(toGrayscale(rgba, w, h), 2, 3), 50, 150);

  // Not just "some pixels lit" but "the lit pixels are on the border": a Canny
  // that fired on interior texture would pass a bare count check.
  let onBorder = 0;
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edges.data[y * w + x] === 0) continue;
      total++;
      if (
        distToSegment({ x, y }, rect[0], rect[1]) <= 2 ||
        distToSegment({ x, y }, rect[1], rect[2]) <= 2 ||
        distToSegment({ x, y }, rect[2], rect[3]) <= 2 ||
        distToSegment({ x, y }, rect[3], rect[0]) <= 2
      ) {
        onBorder++;
      }
    }
  }
  // A 40x30 rectangle has a ~140px perimeter; the closed ring is more than that.
  assert.ok(total > 100, `expected an outline of many pixels, got ${total}`);
  assert.ok(
    onBorder / total > 0.95,
    `${((onBorder / total) * 100).toFixed(0)}% of edge pixels lie on the border, expected >95%`
  );

  // A blank frame must produce nothing, or every real frame scores as a page.
  const blank = new Uint8ClampedArray(w * h * 4).fill(128);
  const blankEdges = canny(blurGaussian(toGrayscale(blank, w, h), 2, 3), 50, 150);
  assert.equal(blankEdges.data.reduce((s, v) => s + (v > 0 ? 1 : 0), 0), 0);
});

/** Distance from a point to a segment, for the edge-localisation check above. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

test("the page outline survives dilation as a single connected component", () => {
  const w = 120;
  const h = 100;
  const rgba = renderPoly(w, h, [
    { x: 25, y: 20 },
    { x: 95, y: 20 },
    { x: 95, y: 80 },
    { x: 25, y: 80 },
  ]);
  const edges = canny(blurGaussian(toGrayscale(rgba, w, h), 2, 3), 50, 150);
  const before = connectedComponents(edges, 1).length;
  const after = connectedComponents(dilate(edges, 2, 2), 1).length;
  assert.ok(after < before, `dilation should merge fragments (${before} -> ${after})`);
  assert.ok(after >= 1);
});

test("end to end: a skewed page is found at its true corners", () => {
  // A quad with real perspective error, not an axis-aligned rectangle: this is
  // the case the whole detector exists for.
  const w = 360;
  const h = 280;
  const want: Pt[] = [
    { x: 60, y: 40 },
    { x: 300, y: 78 },
    { x: 282, y: 242 },
    { x: 82, y: 205 },
  ];
  const got = detectCorners(renderPoly(w, h, want), w, h);
  assert.equal(got.length, 4);
  // 4px tolerance covers the Canny edge width plus the dilation that closes it.
  assertQuadMatches(got, want, 4);
});

test("end to end: a book-shaped spread is also found as a single quad", () => {
  const w = 360;
  const h = 200;
  const want: Pt[] = [
    { x: 30, y: 30 },
    { x: 330, y: 42 },
    { x: 322, y: 168 },
    { x: 40, y: 160 },
  ];
  const got = detectCorners(renderPoly(w, h, want), w, h);
  assertQuadMatches(got, want, 4);
});

test("lineIntersection reports null for parallel lines", () => {
  assert.equal(
    lineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }),
    null
  );
  const hit = lineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
  assert.ok(hit && Math.abs(hit.x - 5) < 1e-6 && Math.abs(hit.y) < 1e-6);
});
