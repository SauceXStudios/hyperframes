import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installFetchMirror } from "./catalog-fetch-mirror.ts";

function recordDir(): string {
  return mkdtempSync(join(tmpdir(), "catalog-mirror-record-"));
}

function stubFetch(contentType: string, bodyBytes: number): void {
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(bodyBytes), {
      status: 200,
      headers: { "content-type": contentType },
    })) as typeof fetch;
}

function mirrorDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-mirror-test-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.bin"), "font-bytes");
  const entry = { status: 200, contentType: "font/woff2", file: "a.bin" };
  writeFileSync(join(dir, "index.json"), JSON.stringify({ "https://fonts.example/a": entry }));
  return dir;
}

test("replay serves a mirrored url and restores fetch on finish", async () => {
  const realFetch = globalThis.fetch;
  const dir = mirrorDir();
  const mirror = installFetchMirror(dir, "replay");
  const response = await fetch("https://fonts.example/a");
  assert.equal(await response.text(), "font-bytes");
  mirror.assertNoMisses();
  mirror.finish();
  assert.equal(globalThis.fetch, realFetch);
  rmSync(dir, { recursive: true });
});

test("an unmirrored fetch fails and is still reported after the caller swallows the error", async () => {
  const dir = mirrorDir();
  const mirror = installFetchMirror(dir, "replay");
  await fetch("https://fonts.example/other").catch(() => undefined);
  assert.throws(() => mirror.assertNoMisses(), /https:\/\/fonts\.example\/other/);
  mirror.finish();
  rmSync(dir, { recursive: true });
});

test("record writes an allowed, small response to disk and indexes it", async () => {
  const realFetch = globalThis.fetch;
  const dir = recordDir();
  stubFetch("text/css; charset=utf-8", 12);
  const mirror = installFetchMirror(dir, "record");
  const response = await fetch("https://cdn.example/a.css");
  assert.equal(response.status, 200);
  mirror.assertNoMisses();
  mirror.finish();
  const files = readdirSync(dir).filter((f) => f.endsWith(".bin"));
  assert.equal(files.length, 1);
  const [file] = files;
  assert.ok(file);
  assert.equal(readFileSync(join(dir, file)).length, 12);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
  assert.equal(index["https://cdn.example/a.css"].file, file);
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true });
});

test("record refuses a content-type the generator does not expect", async () => {
  const realFetch = globalThis.fetch;
  const dir = recordDir();
  stubFetch("application/octet-stream", 12);
  const mirror = installFetchMirror(dir, "record");
  await fetch("https://cdn.example/a.bin");
  assert.throws(
    () => mirror.assertNoMisses(),
    /content-type application\/octet-stream is not mirrored/,
  );
  mirror.finish();
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.endsWith(".bin")),
    [],
  );
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true });
});

test("record refuses a body over the mirror's size cap", async () => {
  const realFetch = globalThis.fetch;
  const dir = recordDir();
  stubFetch("text/css", 8 * 1024 * 1024 + 1);
  const mirror = installFetchMirror(dir, "record");
  await fetch("https://cdn.example/huge.css");
  assert.throws(() => mirror.assertNoMisses(), /exceeds the 8388608-byte mirror cap/);
  mirror.finish();
  assert.deepEqual(
    readdirSync(dir).filter((f) => f.endsWith(".bin")),
    [],
  );
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true });
});
