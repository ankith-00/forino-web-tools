/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { pageNumber, readSpread } from "../spread.ts";

/** Ported from the ScanJet app (reactnative/src/lib/__tests__/spread.test.ts). */

const now = 10_000;

test("a QR left of the centre line is the left page, right of it the right page", () => {
  const r = readSpread(
    [
      { value: "6", cx: 0.9, at: now },
      { value: "5", cx: 0.45, at: now },
    ],
    now
  );
  assert.deepEqual(r.spread, { left: 5, right: 6 });
  assert.equal(r.misaligned, false);
});

test("codes older than the window are ignored", () => {
  const r = readSpread([{ value: "5", cx: 0.2, at: now - 5_000 }], now);
  assert.deepEqual(r.spread, { left: null, right: null });
});

test("two page QRs in one half means the spine is off the line", () => {
  const r = readSpread(
    [
      { value: "5", cx: 0.1, at: now },
      { value: "6", cx: 0.4, at: now },
    ],
    now
  );
  assert.equal(r.misaligned, true);
});

test("non-page codes (the cover barcode) are ignored", () => {
  assert.equal(pageNumber("AA6822562"), null);
  assert.equal(pageNumber(" 12 "), 12);
  const r = readSpread([{ value: "AA6822562", cx: 0.3, at: now }, { value: "2", cx: 0.7, at: now }], now);
  assert.deepEqual(r.spread, { left: null, right: 2 });
});

test("the same code reported twice keeps its latest position", () => {
  const r = readSpread(
    [
      { value: "5", cx: 0.7, at: now - 300 },
      { value: "5", cx: 0.3, at: now - 10 },
    ],
    now
  );
  assert.deepEqual(r.spread, { left: 5, right: null });
});

test("a just-turned page still in the window does not read as off-centre", () => {
  const r = readSpread(
    [
      { value: "3", cx: 0.45, at: now - 500 },
      { value: "4", cx: 0.9, at: now - 500 },
      { value: "5", cx: 0.44, at: now },
      { value: "6", cx: 0.91, at: now },
    ],
    now
  );
  assert.equal(r.misaligned, false);
  assert.deepEqual(r.spread, { left: 5, right: 6 });
  assert.deepEqual(
    r.live.map((d) => d.value).sort(),
    ["5", "6"]
  );
});
