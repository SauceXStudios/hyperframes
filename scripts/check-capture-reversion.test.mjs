import { strict as assert } from "node:assert";
import { test } from "node:test";

import { findReversions, frameHeight, parseArgs } from "./check-capture-reversion.mjs";

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

test("the window boundary is inclusive", () => {
  const hits = findReversions(frames(10, 200, 10), SIZE, { ...OPTS, window: 2 });
  assert.equal(hits.length, 1);
});

test("a change below the threshold is not flagged, one above it is", () => {
  assert.deepEqual(findReversions(frames(10, 11, 10), SIZE, { ...OPTS, change: 1 }), []);
  assert.equal(findReversions(frames(10, 12, 10), SIZE, { ...OPTS, change: 1 }).length, 1);
});

test("a middle frame that matches only one side is not a reversion", () => {
  assert.deepEqual(findReversions(frames(10, 10, 10, 200), SIZE, OPTS), []);
});

test("hits come back ordered by the changed frame", () => {
  const hits = findReversions(frames(10, 200, 10, 10, 90, 10), SIZE, OPTS);
  assert.deepEqual(
    hits.map((h) => h.changed),
    [1, 4],
  );
});

test("the reported delta is the mean difference, not the sum", () => {
  const [hit] = findReversions(frames(10, 110, 10), SIZE, OPTS);
  assert.equal(hit.delta, 100);
});

test("frame height is even and never below 2", () => {
  assert.equal(frameHeight(1280, 200), 16);
  assert.equal(frameHeight(1280, 800), 60);
  assert.equal(frameHeight(1000, 2), 2);
});

test("a malformed option throws instead of reading as clean", () => {
  for (const bad of ["--crop=iw:200:0:0", "--window=abc", "--change=", "--same=-1", "--crp=1:1:0:0"]) {
    assert.throws(() => parseArgs([bad, "v.webm"]), bad);
  }
});

test("options and paths are separated", () => {
  const { options, paths } = parseArgs(["--crop=1280:200:0:600", "--window=5", "a.webm", "b.webm"]);
  assert.deepEqual(paths, ["a.webm", "b.webm"]);
  assert.equal(options.crop, "1280:200:0:600");
  assert.equal(options.window, 5);
});
