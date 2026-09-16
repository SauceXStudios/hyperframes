import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Regression: a narration WAV that lands in assets/voice/<id>.wav without ever
// going through this engine's own TTS loop (hand-placed, copied from another
// run, or left over from an interrupted one) used to be invisible to every
// consumer that trusts audio_meta.json's voices[] — assemble-index.mjs never
// emits an <audio> element for it, with no warning at all. The fix
// reconciles assets/voice/ against voices[] on every engine invocation.

const engineScript = new URL("./audio.mjs", import.meta.url).pathname;
const HAS_FFMPEG =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function setupProject({ lines, existingVoices, voiceFiles }) {
  const dir = mkdtempSync(join(tmpdir(), "mu-audio-reconcile-"));
  writeFileSync(join(dir, "audio_request.json"), JSON.stringify({ lines }));
  if (existingVoices) {
    writeFileSync(
      join(dir, "audio_meta.json"),
      JSON.stringify({ bgm: null, voices: existingVoices, sfx: [] }),
    );
  }
  if (voiceFiles?.length) {
    const voiceDir = join(dir, "assets", "voice");
    mkdirSync(voiceDir, { recursive: true });
    for (const file of voiceFiles) {
      // 1s silent tone — small, deterministic, real enough for ffprobe to read a duration.
      const gen = spawnSync(
        "ffmpeg",
        ["-y", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "1", join(voiceDir, file)],
        { encoding: "utf8" },
      );
      assert.equal(gen.status, 0, gen.stderr);
    }
  }
  return dir;
}

function runEngine(dir, extraArgs = []) {
  const outPath = join(dir, "audio_meta.json");
  const r = spawnSync(
    process.execPath,
    [
      engineScript,
      "--request",
      join(dir, "audio_request.json"),
      "--hyperframes",
      dir,
      "--out",
      outPath,
      "--only",
      "",
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(readFileSync(outPath, "utf8"));
}

test(
  "a narration WAV present on disk but missing from the ledger is backfilled",
  { skip: !HAS_FFMPEG },
  () => {
    const dir = setupProject({
      lines: [{ id: "01", text: "Hello" }],
      existingVoices: [],
      voiceFiles: ["01.wav"],
    });

    const meta = runEngine(dir);

    assert.equal(meta.voices.length, 1, JSON.stringify(meta));
    assert.equal(meta.voices[0].id, "01");
    assert.equal(meta.voices[0].path, "assets/voice/01.wav");
    assert.ok(meta.voices[0].duration_s > 0, "expected a real, positive duration");
    assert.deepEqual(meta.voices[0].words, []);
  },
);

test("a voice already present in the ledger is not duplicated", { skip: !HAS_FFMPEG }, () => {
  const dir = setupProject({
    lines: [{ id: "01", text: "Hello" }],
    existingVoices: [{ id: "01", path: "assets/voice/01.wav", duration_s: 2.5, words: [] }],
    voiceFiles: ["01.wav"],
  });

  const meta = runEngine(dir);

  assert.equal(meta.voices.length, 1);
  // The pre-existing ledger entry wins verbatim — reconciliation only fills gaps.
  assert.equal(meta.voices[0].duration_s, 2.5);
});

test(
  "a stale WAV for a line the current script no longer asks for is left alone",
  { skip: !HAS_FFMPEG },
  () => {
    const dir = setupProject({
      lines: [{ id: "01", text: "Hello" }],
      existingVoices: [],
      voiceFiles: ["01.wav", "99.wav"],
    });

    const meta = runEngine(dir);

    assert.equal(meta.voices.length, 1);
    assert.equal(meta.voices[0].id, "01");
    assert.ok(
      !meta.voices.some((v) => v.id === "99"),
      "a file with no matching request line must not be resurrected",
    );
  },
);

test(
  "a WAV for a line whose text was since cleared is left alone, not resurrected",
  { skip: !HAS_FFMPEG },
  () => {
    const dir = setupProject({
      lines: [{ id: "01", text: "   " }],
      existingVoices: [],
      voiceFiles: ["01.wav"],
    });

    const meta = runEngine(dir);

    assert.deepEqual(meta.voices, [], "empty-text line must not resurrect a leftover WAV");
  },
);

test("no assets/voice directory at all is a no-op, not a crash", { skip: !HAS_FFMPEG }, () => {
  const dir = setupProject({ lines: [{ id: "01", text: "Hello" }], existingVoices: [] });
  assert.equal(existsSync(join(dir, "assets", "voice")), false);

  const meta = runEngine(dir);

  assert.deepEqual(meta.voices, []);
});
