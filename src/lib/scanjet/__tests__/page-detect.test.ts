/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { detectPages, scaleQuadsToFrame } from "../page-detect.ts";
import { warpPage, PAGE_MAX_DIM } from "../page-warp.ts";
import { quadAspect, type Quad } from "../geometry.ts";
import type { Pt } from "../vision.ts";

/** Paints an RGBA buffer: `shade(x, y)` returns 0..255 grey, or null = background. */
function paint(width: number, height: number, shade: (x: number, y: number) => number | null) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = shade(x, y);
      const p = (y * width + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = v ?? 30;
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

function fillPoly(width: number, height: number, poly: Pt[], value: number | null = 240) {
  return paint(width, height, (x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside ? value : null;
  });
}

/**
 * A polygon of `value` brightness, with a soft dark shadow down the middle.
 *
 * Soft, not a hard stripe, on purpose. A book gutter is a shadow, and a soft one
 * leaves the page's outer outline as a single closed loop — which is the only
 * situation where the luminance-valley split is needed. A hard-edged stripe
 * creates its own strong interior Canny edges, which split the outline into two
 * components and get the pages found geometrically instead (see the test below).
 */
function withGutter(width: number, height: number, poly: Pt[], centreX: number, depth = 150) {
  return paint(width, height, (x, y) => {
    if (!pointIn({ x, y }, poly)) return null;
    const d = (x - centreX) / 30;
    return 240 - depth * Math.exp(-d * d);
  });
}

function quadNear(actual: Quad, expected: Pt[], tol: number, label: string) {
  for (const want of expected) {
    let best = Infinity;
    for (const got of actual) best = Math.min(best, Math.hypot(got.x - want.x, got.y - want.y));
    assert.ok(
      best <= tol,
      `${label}: no corner within ${tol}px of (${want.x}, ${want.y}); closest was ${best.toFixed(1)}px away`
    );
  }
}

test("a single page on a desk is found as one quad", () => {
  const w = 360;
  const h = 280;
  const page: Pt[] = [
    { x: 60, y: 40 },
    { x: 300, y: 62 },
    { x: 292, y: 236 },
    { x: 74, y: 214 },
  ];
  const res = detectPages(fillPoly(w, h, page), w, h);
  assert.equal(res.mode, "single");
  assert.equal(res.pages.length, 1);
  // `res.pages` is normalized 0..1, so compare against normalized expectations.
  quadNear(res.pages[0], page.map((p) => ({ x: p.x / w, y: p.y / h })), 0.03, "single page");
  assert.equal(res.sourceWidth, w);
  assert.equal(res.sourceHeight, h);
});

test("an empty frame falls back to the whole frame rather than inventing a page", () => {
  const res = detectPages(paint(320, 240, () => 90), 320, 240);
  assert.equal(res.mode, "frame");
  assert.deepEqual(res.pages[0], [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]);
});

test("an open book with a dark gutter is split into two pages at the seam", () => {
  const w = 400;
  const h = 220;
  const spread: Pt[] = [
    { x: 40, y: 40 },
    { x: 360, y: 46 },
    { x: 352, y: 180 },
    { x: 48, y: 176 },
  ];
  // The gutter sits at the middle of the spread, where a bound spine shadows.
  const centreX = 200;
  const res = detectPages(withGutter(w, h, spread, centreX), w, h);

  assert.equal(res.mode, "spread-split", "the soft shadow should split the spread along the seam");
  assert.equal(res.pages.length, 2);

  // Both halves must be portrait-ish, i.e. real pages rather than the spread cut
  // the wrong way round.
  for (const page of res.pages) {
    const aspect = quadAspect(page);
    assert.ok(aspect > 0.4 && aspect < 1.2, `half-page aspect ${aspect.toFixed(2)} is not page-shaped`);
  }

  // And the cut must land on the gutter, in normalized units.
  const seam = (res.pages[0][1].x + res.pages[1][0].x) / 2;
  assert.ok(
    Math.abs(seam - centreX / w) < 0.04,
    `seam at ${seam.toFixed(3)} of frame width, expected near ${(centreX / w).toFixed(3)}`
  );
});

test("a hard-edged stripe is found as two pages, without needing the gutter split", () => {
  // The other real-world case: a page with a sharply printed fold or a dark
  // strip. Its own edges break the outline, so the pages separate geometrically
  // and the luminance split is never reached. Both routes must agree on the
  // result, so this asserts the outcome rather than the route.
  const w = 400;
  const h = 220;
  const spread: Pt[] = [
    { x: 40, y: 40 },
    { x: 360, y: 46 },
    { x: 352, y: 180 },
    { x: 48, y: 176 },
  ];
  const rgba = paint(w, h, (x, y) =>
    !pointIn({ x, y }, spread) ? null : Math.abs(x - 200) <= 7 ? 40 : 240
  );
  const res = detectPages(rgba, w, h);
  assert.equal(res.pages.length, 2);
  const seam = (res.pages[0][1].x + res.pages[1][0].x) / 2;
  assert.ok(
    Math.abs(seam - 0.5) < 0.05,
    `seam at ${seam.toFixed(3)}, expected near the stripe at 0.5`
  );
});

test("a spread with no gutter is left as one quad, not cut in half", () => {
  const w = 400;
  const h = 220;
  // Uniform brightness: there is no seam, so splitting would be a guess.
  const res = detectPages(fillPoly(w, h, [
    { x: 40, y: 40 },
    { x: 360, y: 46 },
    { x: 352, y: 180 },
    { x: 48, y: 176 },
  ]), w, h);
  assert.equal(res.mode, "single");
  assert.equal(res.pages.length, 1);
});

test("two separate sheets are reported as two pages, left to right", () => {
  const w = 400;
  const h = 240;
  const left: Pt[] = [
    { x: 30, y: 50 },
    { x: 185, y: 50 },
    { x: 185, y: 190 },
    { x: 30, y: 190 },
  ];
  const right: Pt[] = [
    { x: 215, y: 50 },
    { x: 370, y: 50 },
    { x: 370, y: 190 },
    { x: 215, y: 190 },
  ];
  const rgba = paint(w, h, (x, y) => {
    const inL = pointIn({ x, y }, left);
    const inR = pointIn({ x, y }, right);
    return inL || inR ? 245 : null;
  });
  const res = detectPages(rgba, w, h);
  assert.equal(res.mode, "two");
  assert.equal(res.pages.length, 2);
  // sortPages must put the left sheet first.
  const leftCx = res.pages[0].reduce((s, p) => s + p.x, 0) / 4;
  const rightCx = res.pages[1].reduce((s, p) => s + p.x, 0) / 4;
  assert.ok(leftCx < rightCx, "pages must be ordered left to right");
});

test("detection is resolution independent: quads are normalized to the source frame", () => {
  // Same scene, half the pixels. Normalized quads must match, because the
  // browser's capture is full resolution while detection runs downscaled.
  const w = 360;
  const h = 280;
  const page: Pt[] = [
    { x: 60, y: 40 },
    { x: 300, y: 62 },
    { x: 292, y: 236 },
    { x: 74, y: 214 },
  ];
  const full = detectPages(fillPoly(w, h, page), w, h);
  const half = detectPages(fillPoly(w / 2, h / 2, page.map((p) => ({ x: p.x / 2, y: p.y / 2 }))), w / 2, h / 2);
  assert.equal(full.mode, half.mode);
  quadNear(half.pages[0], full.pages[0], 0.06, "normalized quad");
});

test("scaleQuadsToFrame maps normalized quads onto full-res pixels", () => {
  const quads = detectPages(fillPoly(360, 280, [
    { x: 60, y: 40 },
    { x: 300, y: 62 },
    { x: 292, y: 236 },
    { x: 74, y: 214 },
  ]), 360, 280).pages;
  const scaled = scaleQuadsToFrame(quads, 1920, 1080);
  for (const p of scaled[0]) {
    assert.ok(p.x >= 0 && p.x <= 1920, `x ${p.x} out of frame`);
    assert.ok(p.y >= 0 && p.y <= 1080, `y ${p.y} out of frame`);
  }
});

test("warp straightens a skewed page to a filled rectangle", () => {
  const w = 360;
  const h = 280;
  const page: Pt[] = [
    { x: 60, y: 40 },
    { x: 300, y: 78 },
    { x: 282, y: 242 },
    { x: 82, y: 205 },
  ];
  const rgba = fillPoly(w, h, page);
  const res = detectPages(rgba, w, h);
  assert.equal(res.mode, "single");

  const out = warpPage(rgba, w, h, {
    quad: scaleQuadsToFrame(res.pages, w, h)[0],
    srcWidth: w,
    srcHeight: h,
  });
  assert.ok(out, "warp should produce an image");

  // The page is uniform, so the whole output must be uniform too. Any dark
  // pixels mean the mapping sampled outside the page: the classic sign of a
  // wrong homography or holes from forward mapping.
  let dark = 0;
  for (let i = 0; i < out.data.length; i += 4) {
    if (out.data[i] < 200) dark++;
  }
  const total = out.width * out.height;
  assert.ok(
    dark / total < 0.02,
    `${((dark / total) * 100).toFixed(1)}% of the warped page came out dark; expected a clean fill`
  );
});

test("warp preserves orientation: a marker on the page stays in its corner", () => {
  const w = 300;
  const h = 300;
  // A red dot in the top-left of the page, on an otherwise white sheet.
  const page: Pt[] = [
    { x: 50, y: 50 },
    { x: 250, y: 50 },
    { x: 250, y: 250 },
    { x: 50, y: 250 },
  ];
  const rgba = paint(w, h, (x, y) => {
    if (!pointIn({ x, y }, page)) return null;
    return x < 90 && y < 90 ? 255 : 245;
  });
  // Make the marker red so it is unambiguous.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= 50 && x < 90 && y >= 50 && y < 90) {
        const p = (y * w + x) * 4;
        rgba[p] = 255;
        rgba[p + 1] = 0;
        rgba[p + 2] = 0;
      }
    }
  }

  const out = warpPage(rgba, w, h, {
    quad: [
      { x: 50, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 250 },
      { x: 50, y: 250 },
    ],
    srcWidth: w,
    srcHeight: h,
  });
  assert.ok(out);

  // Where does the reddest pixel land?
  let bestX = 0;
  let bestY = 0;
  let best = -1;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const p = (y * out.width + x) * 4;
      const redness = out.data[p] - out.data[p + 1];
      if (redness > best) {
        best = redness;
        bestX = x;
        bestY = y;
      }
    }
  }
  assert.ok(best > 100, `expected a clearly red marker, got redness ${best}`);
  assert.ok(bestX < out.width * 0.25, `marker landed at x=${bestX}, expected the left quarter`);
  assert.ok(bestY < out.height * 0.25, `marker landed at y=${bestY}, expected the top quarter`);
});

test("warp respects maxDim and keeps the page's aspect", () => {
  const w = 400;
  const h = 400;
  const rgba = fillPoly(w, h, [
    { x: 20, y: 20 },
    { x: 380, y: 20 },
    { x: 380, y: 380 },
    { x: 20, y: 380 },
  ]);
  const out = warpPage(rgba, w, h, {
    quad: [
      { x: 20, y: 20 },
      { x: 380, y: 20 },
      { x: 380, y: 380 },
      { x: 20, y: 380 },
    ],
    srcWidth: w,
    srcHeight: h,
    maxDim: 200,
  });
  assert.ok(out);
  assert.ok(Math.max(out.width, out.height) <= 200, `largest edge ${Math.max(out.width, out.height)} exceeds the cap`);
  // A square page must stay square, or the page is silently stretched.
  assert.ok(Math.abs(out.width - out.height) <= 2, `${out.width}x${out.height} is not square`);
});

test("warp returns null for a degenerate quad instead of emitting a broken page", () => {
  const rgba = fillPoly(100, 100, [
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
    { x: 10, y: 90 },
  ]);
  const collapsed = warpPage(rgba, 100, 100, {
    quad: [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ],
    srcWidth: 100,
    srcHeight: 100,
  });
  assert.equal(collapsed, null);
});

test("PAGE_MAX_DIM matches the native scanner's cap", () => {
  assert.equal(PAGE_MAX_DIM, 3200);
});

function pointIn(pt: Pt, poly: Pt[]): boolean {
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
