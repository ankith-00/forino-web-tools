/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { accept, evaluate, finishOnLeft, initialSession, message, pagesScanned } from "../sequence.ts";

/** Ported from the ScanJet app (reactnative/src/lib/__tests__/sequence.test.ts). */

const at = (left: number) => ({ ...initialSession(), nextLeft: left });

test("the first spread expected is 1–2", () => {
  assert.deepEqual(evaluate(initialSession(), { left: 1, right: 2 }), { kind: "match", pair: { left: 1, right: 2 } });
});

test("after 3–4 the next spread must be 5–6", () => {
  const s = accept(at(3), { left: 3, right: 4 });
  assert.equal(evaluate(s, { left: 5, right: 6 }).kind, "match");
  const wrong = evaluate(s, { left: 9, right: 10 });
  assert.equal(wrong.kind, "wrong");
  assert.equal(wrong.kind === "wrong" && wrong.reason, "ahead");
  assert.match(message(wrong).title, /turn to pages 5–6, not 9–10/);
});

test("going back to an earlier spread is wrong (behind)", () => {
  const s = accept(accept(initialSession(), { left: 1, right: 2 }), { left: 3, right: 4 });
  const v = evaluate(s, { left: 1, right: 2 });
  assert.equal(v.kind === "wrong" && v.reason, "behind");
});

test("still looking at the spread just accepted is not an error", () => {
  const s = accept(at(3), { left: 3, right: 4 });
  assert.equal(evaluate(s, { left: 3, right: 4 }).kind, "holding");
  assert.equal(evaluate(s, { left: 3, right: null }).kind, "holding");
  assert.equal(evaluate(s, { left: null, right: 4 }).kind, "holding");
});

test("two pages that do not face each other are wrong", () => {
  const v = evaluate(at(5), { left: 5, right: 9 });
  assert.equal(v.kind === "wrong" && v.reason, "not_facing");
});

test("one expected page alone is partial, one unexpected page alone is wrong", () => {
  assert.equal(evaluate(at(5), { left: 5, right: null }).kind, "partial");
  assert.equal(evaluate(at(5), { left: null, right: 6 }).kind, "partial");
  const v = evaluate(at(5), { left: null, right: 8 });
  assert.equal(v.kind === "wrong" && v.reason, "ahead");
});

test("nothing in view is waiting", () => {
  assert.equal(evaluate(initialSession(), { left: null, right: null }).kind, "waiting");
});

test("a whole 37-page document in order, ending on a single page", () => {
  let s = initialSession();
  for (let left = 1; left < 37; left += 2) {
    const v = evaluate(s, { left, right: left + 1 });
    assert.equal(v.kind, "match", `spread ${left}`);
    s = accept(s, { left, right: left + 1 });
  }
  assert.equal(evaluate(s, { left: 37, right: null }).kind, "partial");
  s = finishOnLeft(s);
  assert.equal(pagesScanned(s), 37);
  assert.equal(evaluate(s, { left: 1, right: 2 }).kind, "finished");
});
