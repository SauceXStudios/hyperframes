import { strict as assert } from "node:assert";
import { test } from "node:test";

import { findReversions } from "./check-capture-reversion.mjs";

const OPTS = { window: 20, change: 1, same: 0.25 };
const SIZE = 4;

function frames(...levels) {
  return Buffer.concat(levels.map((v) => Buffer.alloc(SIZE, v)));
}

test("a region that returns to an earlier picture is flagged at the changed frame", () => {
  const hits = findReversions(frames(10, 10, 200, 10, 10), SIZE, OPTS);
  assert.deepEqual(
    hits.map((h) => [h.from, h.changed, h.back]),
    [[0, 2, 3]],
  );
});

test("a change that stays is not a reversion", () => {
  assert.deepEqual(findReversions(frames(10, 10, 200, 200, 200), SIZE, OPTS), []);
});

test("continuous motion never returns to an earlier picture", () => {
  assert.deepEqual(findReversions(frames(10, 30, 50, 70, 90), SIZE, OPTS), []);
});

test("a return further away than the window is ignored", () => {
  const far = frames(10, 200, 10);
  assert.deepEqual(findReversions(far, SIZE, { ...OPTS, window: 1 }), []);
});
