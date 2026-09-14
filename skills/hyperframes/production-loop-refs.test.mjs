import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const docPath = fileURLToPath(new URL("./references/production-loop.md", import.meta.url));
const doc = readFileSync(docPath, "utf8");

test("assembly stage resolves the core composition contracts from this file", () => {
  const row = doc.split("\n").find((line) => line.includes("**Assembly**"));
  assert.ok(row, "Assembly row missing from production-loop.md");
  const refs = [...row.matchAll(/`([^`]+\.md)`/g)].map((match) => match[1]);
  assert.deepEqual(
    refs.map((ref) => ref.split("/").at(-1)),
    ["sub-compositions.md", "tracks-and-clips.md"],
  );
  for (const ref of refs) {
    assert.match(ref, /hyperframes-core\/references\//);
    const resolved = resolve(dirname(docPath), ref);
    assert.ok(existsSync(resolved), `${ref} does not resolve from production-loop.md`);
  }
});
