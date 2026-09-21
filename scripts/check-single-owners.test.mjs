// guards: **
import assert from "node:assert/strict";
import test from "node:test";
import { ownerViolations, ratchet } from "./check-single-owners.mjs";

const empty = { total: 0, files: {} };
const rule = { id: "gain", pattern: "20\\s*\\*\\s*Math\\.log10", owner: "owner.ts", allowlist: [] };
function scan(tree, rules = [rule]) {
  return ownerViolations(Object.keys(tree), (file) => tree[file], { rules });
}

test("a planted second owner fails and importing the owner passes", () => {
  const tree = { "owner.ts": "20 * Math.log10(gain)", "other.ts": "20 * Math.log10(value)" };
  assert.match(ratchet(scan(tree), empty).join("\n"), /other.ts/);
  tree["other.ts"] = "import { gainToDb } from './owner'; gainToDb(value)";
  assert.deepEqual(ratchet(scan(tree), empty), []);
});

test("whitespace variants and multiple matches are counted", () => {
  assert.deepEqual(
    scan({
      "owner.ts": "20 * Math.log10(gain)",
      "other.mjs": "20*Math.log10(x);20\n* Math.log10(y)",
    }),
    { "gain:other.mjs": 2 },
  );
});

test("allowlist entries exempt only an exact file and need a reason", () => {
  const tree = { "owner.ts": "20 * Math.log10(gain)", "oracle.test.ts": "20 * Math.log10(1)" };
  assert.deepEqual(
    scan(tree, [
      { ...rule, allowlist: [{ file: "oracle.test.ts", reason: "Independent expected value" }] },
    ]),
    {},
  );
  assert.throws(
    () => scan(tree, [{ ...rule, allowlist: [{ file: "oracle.test.ts", reason: "" }] }]),
    /reason/,
  );
});

test("missing owners and stale patterns fail closed", () => {
  assert.throws(() => scan({ "other.ts": "" }), /missing owner/);
  assert.throws(() => scan({ "owner.ts": "export {}" }), /does not match/);
});

test("existing debt passes but baseline increases and stale counts fail", () => {
  const baseline = { total: 1, files: { "gain:other.ts": 1 } };
  assert.deepEqual(ratchet(baseline.files, baseline), []);
  assert.match(
    ratchet({ "gain:other.ts": 2 }, { total: 2, files: { "gain:other.ts": 2 } }, baseline).join(
      "\n",
    ),
    /only shrink/,
  );
  assert.match(ratchet({}, baseline).join("\n"), /lower baseline/);
  assert.deepEqual(ratchet({}, empty, baseline), []);
});

test("an old file budget cannot pay for a different file", () => {
  assert.match(
    ratchet({ "gain:new.ts": 1 }, { total: 1, files: { "gain:old.ts": 1 } }).join("\n"),
    /new.ts/,
  );
});
