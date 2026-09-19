import { afterEach, describe, expect, it } from "vitest";
import {
  closeSync,
  fstatSync,
  ftruncateSync,
  futimesSync,
  mkdtempSync,
  openSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  MAX_FILE_SIGNATURE_FILES,
  affectsProjectSignature,
  createProjectFileSignatures,
  createProjectSignature,
} from "./projectSignature.js";

const temporaryProjects: string[] = [];

afterEach(() => {
  for (const project of temporaryProjects.splice(0)) rmSync(project, { recursive: true });
});

const PROJECT = resolve("/projects/demo");
const affects = (relativePath: string) =>
  affectsProjectSignature(PROJECT, resolve(PROJECT, relativePath));

describe("affectsProjectSignature", () => {
  it("accepts a file the signature walk collects", () => {
    expect(affects("index.html")).toBe(true);
    expect(affects("assets/logo.png")).toBe(true);
  });

  it("rejects the caches the walk skips", () => {
    // .thumbnails is the one that matters: the thumbnail route writes a capture
    // there and reads the preview on the next one, so invalidating on it throws
    // the memo away on roughly every request of the workload it exists for.
    expect(affects(".thumbnails/frame-0.jpg")).toBe(false);
    expect(affects("node_modules/pkg/index.js")).toBe(false);
    expect(affects("renders/out.mp4")).toBe(false);
  });

  it("rejects a directory event on an excluded dir itself", () => {
    expect(affects(".thumbnails")).toBe(false);
  });

  it("accepts the two manifest files the signature reads back out of .hyperframes", () => {
    // The reload watcher's exclusion set is character-identical to the walk's but
    // drops all of .hyperframes/. Filtering with it would stop a motion-state save
    // from ever invalidating — the same stale-ETag bug in a new place.
    expect(affects(".hyperframes/studio-motion.json")).toBe(true);
    expect(affects(".hyperframes/studio-manual-edits.json")).toBe(true);
  });

  it("rejects everything else inside .hyperframes", () => {
    expect(affects(".hyperframes/cache/blob.bin")).toBe(false);
  });

  it("rejects a path outside the project", () => {
    expect(affectsProjectSignature(PROJECT, resolve("/projects/other/index.html"))).toBe(false);
    expect(affectsProjectSignature(PROJECT, PROJECT)).toBe(false);
  });
});

describe("createProjectSignature", () => {
  it("changes after same-size content is written with the original mtime restored", () => {
    const project = mkdtempSync(resolve(tmpdir(), "hf-signature-"));
    temporaryProjects.push(project);
    const file = resolve(project, "index.html");
    const descriptor = openSync(file, "w+");
    try {
      writeSync(descriptor, "first");
      const originalMtime = fstatSync(descriptor).mtime;
      const before = createProjectSignature(project);

      ftruncateSync(descriptor, 0);
      writeSync(descriptor, "other", 0, "utf8");
      futimesSync(descriptor, originalMtime, originalMtime);

      expect(createProjectSignature(project)).not.toBe(before);
    } finally {
      closeSync(descriptor);
    }
  });
});

describe("createProjectFileSignatures", () => {
  function makeProject(files: Record<string, string>): string {
    const project = mkdtempSync(resolve(tmpdir(), "hf-file-signatures-"));
    temporaryProjects.push(project);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(resolve(project, name, ".."), { recursive: true });
      writeFileSync(resolve(project, name), content);
    }
    return project;
  }

  function fileMap(project: string): Record<string, string> {
    const result = createProjectFileSignatures(project);
    if (!("files" in result)) throw new Error("expected a per-file map");
    return result.files;
  }

  it("changes only the edited file's hash, keyed by posix relative path", () => {
    const project = makeProject({ "index.html": "a", "assets/app.js": "one", "assets/b.js": "b" });
    const before = fileMap(project);
    writeFileSync(resolve(project, "assets/app.js"), "two!");
    const after = fileMap(project);

    expect(Object.keys(before).sort()).toEqual(["assets/app.js", "assets/b.js", "index.html"]);
    expect(after["assets/app.js"]).not.toBe(before["assets/app.js"]);
    expect(after["index.html"]).toBe(before["index.html"]);
    expect(after["assets/b.js"]).toBe(before["assets/b.js"]);
  });

  it("returns the memoized result while no file's stat fingerprint changed", () => {
    const project = makeProject({ "index.html": "a" });
    expect(fileMap(project)).toBe(fileMap(project));
  });

  it("drops a deleted file from the map", () => {
    const project = makeProject({ "index.html": "a", "gone.js": "x" });
    fileMap(project);
    rmSync(resolve(project, "gone.js"));
    expect(fileMap(project)).not.toHaveProperty("gone.js");
  });

  it("falls back to the whole-project signature above the file cap", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_FILE_SIGNATURE_FILES; i += 1) files[`f/${i}.txt`] = "x";
    const project = makeProject(files);
    const before = createProjectFileSignatures(project);
    writeFileSync(resolve(project, "f/0.txt"), "changed");
    const after = createProjectFileSignatures(project);

    expect(before).toEqual({ all: expect.any(String) });
    expect(after).not.toEqual(before);
  });
});
