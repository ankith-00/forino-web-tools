/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { containedBox, frameToView, viewToFrame } from "../capture.ts";

/** A landscape panel, which is what the desktop preview actually is. */
const PANEL = { cw: 1600, ch: 900 };

test("a landscape frame fills a landscape panel, with no offset", () => {
  const box = containedBox(1920, 1080, PANEL.cw, PANEL.ch);
  assert.equal(box.scale, PANEL.cw / 1920);
  assert.equal(box.x, 0);
  assert.equal(box.y, 0);
});

test("a portrait frame is letterboxed, not cropped, and keeps its orientation", () => {
  // The phone holding the camera upright: 1080x1920 into a 1600x900 panel.
  const box = containedBox(1080, 1920, PANEL.cw, PANEL.ch);
  assert.equal(box.scale, PANEL.ch / 1920);
  assert.equal(box.width, PANEL.ch * (1080 / 1920));
  assert.ok(box.x > 0, "expected pillarboxing, so the frame is not cropped");
  // Bars are split evenly, which is what `contain` does and `cover` does not.
  assert.equal(box.x, (PANEL.cw - box.width) / 2);
  assert.equal(box.y, 0);
});

test("the whole frame always fits, and the scale is the smaller of the two ratios", () => {
  for (const [iw, ih] of [
    [1080, 1920],
    [1920, 1080],
    [1440, 1440],
  ] as const) {
    const box = containedBox(iw, ih, PANEL.cw, PANEL.ch);
    assert.equal(box.scale, Math.min(PANEL.cw / iw, PANEL.ch / ih));
    // Never cropped: the drawn area is inside the element on both axes.
    assert.ok(box.width <= PANEL.cw, `${iw}x${ih} overflowed the panel width`);
    assert.ok(box.height <= PANEL.ch, `${iw}x${ih} overflowed the panel height`);
  }
});

test("a frame smaller than the panel is letterboxed, and only then is it enlarged", () => {
  // A real desktop panel against a 1080p feed: downscale, so no detail is invented.
  assert.ok(containedBox(1920, 1080, PANEL.cw, PANEL.ch).scale < 1);
  assert.ok(containedBox(1080, 1920, PANEL.cw, PANEL.ch).scale < 1);
  // A panel larger than the frame does enlarge it, which is the one case where
  // `contain` is no softer than `cover` — both have to invent the extra pixels.
  assert.ok(containedBox(640, 480, 4000, 3000).scale > 1);
});

test("frameToView and viewToFrame are inverses, letterbox included", () => {
  const cases = [
    [1080, 1920],
    [1920, 1080],
    [1440, 1440],
  ] as const;
  for (const [iw, ih] of cases) {
    const inFrame = { x: 100, y: 250, width: 40, height: 40 };
    const inView = frameToView(iw, ih, PANEL.cw, PANEL.ch, inFrame);
    const back = viewToFrame(iw, ih, PANEL.cw, PANEL.ch, inView);
    for (const k of ["x", "y", "width", "height"] as const) {
      assert.ok(
        Math.abs(back[k] - inFrame[k]) < 1e-9,
        `${iw}x${ih}: ${k} round-tripped to ${back[k]}, expected ${inFrame[k]}`,
      );
    }
  }
});

test("the frame origin lands inside the drawn area, not at the element origin", () => {
  // A portrait frame starts well right of x=0 once it is pillarboxed; a mapping
  // that ignored the offset would place every box here too far left.
  const view = frameToView(1080, 1920, PANEL.cw, PANEL.ch, { x: 0, y: 0, width: 10, height: 10 });
  assert.ok(Math.abs(view.x - containedBox(1080, 1920, PANEL.cw, PANEL.ch).x) < 1e-9);
  assert.ok(view.x > 0);
});

test("an unsized surface yields a zero scale instead of NaN", () => {
  const box = containedBox(0, 0, PANEL.cw, PANEL.ch);
  assert.equal(box.scale, 0);
  // And the inverse must pass a box through untouched rather than divide by zero.
  const b = { x: 1, y: 2, width: 3, height: 4 };
  assert.deepEqual(viewToFrame(0, 0, PANEL.cw, PANEL.ch, b), b);
});
