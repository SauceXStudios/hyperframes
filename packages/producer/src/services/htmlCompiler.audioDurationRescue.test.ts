import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { defaultLogger } from "../logger.js";
import { compileForRender } from "./htmlCompiler.js";

/** Byte offset of the 32-bit duration field within each version-0 header box. */
const DURATION_FIELD_OFFSETS: Record<string, number> = {
  // version(1) flags(3) created(4) modified(4) timescale(4) → duration
  mvhd: 16,
  mdhd: 16,
  // version(1) flags(3) created(4) modified(4) track_ID(4) reserved(4) → duration
  tkhd: 20,
};
const BOXES_WITH_CHILDREN = new Set(["moov", "trak", "mdia"]);

// PRINFRA-380: some muxers write container-summary durations that undercount
// a track's real length — the reported case was audio silenced at roughly half
// its authored `data-duration`, fingerprinted as an HE-AAC/SBR encoder quirk
// but not specific to any one codec or profile. Halving all three summary
// fields on a real, otherwise-valid MP4 reproduces that class of bug directly:
// the packet stream is left completely untouched, only the header lies. All
// three are halved together so ffprobe cannot recover the true length from a
// sibling field. Confirmed against a real HE-AAC/SBR fixture (FFmpeg's own
// fate-suite al_sbr_ps_04_new.mp4): ffmpeg still decodes every packet and
// plays the full length, while ffprobe's format/stream duration fields — like
// this patch — report the short one. ffmpeg writes these boxes as version 0,
// where the duration is a plain 32-bit field.
function halveContainerDurations(filePath: string): void {
  const data = readFileSync(filePath);

  function halveIn(start: number, end: number): void {
    let pos = start;
    while (pos + 8 <= end) {
      const size = data.readUInt32BE(pos);
      if (size < 8) break;
      const type = data.toString("latin1", pos + 4, pos + 8);
      const boxStart = pos + 8;
      const durationOffset = DURATION_FIELD_OFFSETS[type];
      if (durationOffset !== undefined) {
        const at = boxStart + durationOffset;
        data.writeUInt32BE(Math.round(data.readUInt32BE(at) / 2), at);
      } else if (BOXES_WITH_CHILDREN.has(type)) {
        halveIn(boxStart, pos + size);
      }
      pos += size;
    }
  }

  halveIn(0, data.length);
  writeFileSync(filePath, data);
}

describe("compileForRender audio duration probe rescue (PRINFRA-380)", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "hf-audio-duration-rescue-"));
  const lyingPath = join(projectDir, "lying-duration.mp4");
  const shortPath = join(projectDir, "genuinely-short.mp4");
  let realDurationSeconds = 0;

  beforeAll(() => {
    const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || "ffmpeg";
    function generateSineMp4(dest: string, durationSeconds: number): void {
      const generated = spawnSync(
        ffmpeg,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`,
          "-c:a",
          "aac",
          "-y",
          dest,
        ],
        { encoding: "utf8" },
      );
      if (generated.status !== 0) throw new Error(generated.stderr || "failed to create fixture");
    }

    generateSineMp4(lyingPath, 4);
    generateSineMp4(shortPath, 2);

    const ffprobe = process.env.HYPERFRAMES_FFPROBE_PATH || "ffprobe";
    const probed = spawnSync(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "--", lyingPath],
      { encoding: "utf8" },
    );
    // Read the true duration before the header is falsified, so the authored
    // slot below matches what the packet scan is expected to recover.
    realDurationSeconds = Number(probed.stdout.trim());

    halveContainerDurations(lyingPath);
  });

  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  async function compile(media: string) {
    const htmlPath = join(projectDir, "index.html");
    const warnings: string[] = [];
    const log = { ...defaultLogger, warn: (message: string) => warnings.push(message) };
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body><main data-composition-id="root" data-start="0" data-duration="100" data-width="16" data-height="16">${media}</main></body></html>`,
    );
    const result = await compileForRender(projectDir, htmlPath, projectDir, {
      allowSystemFontCapture: false,
      log,
    });
    return { document: parseHTML(result.html).document, warnings };
  }

  it("recovers the real duration from packet timestamps instead of accepting a lying container header", async () => {
    expect(realDurationSeconds).toBeGreaterThan(3.9);

    const authoredDuration = realDurationSeconds;
    const { document, warnings } = await compile(
      `<audio id="rescued" src="lying-duration.mp4" data-start="0" data-duration="${authoredDuration}"></audio>`,
    );

    const element = document.getElementById("rescued")!;
    // Without the packet-scan rescue this would be clamped to ~half of
    // authoredDuration (the patched container's lie); the rescue should
    // recover the true, authored-matching duration instead.
    expect(Number(element.getAttribute("data-duration"))).toBeCloseTo(authoredDuration, 1);
    expect(warnings.join("\n")).not.toContain("rescued");
  });

  it("still clamps a genuinely short source after the rescue attempt finds nothing better", async () => {
    const { document, warnings } = await compile(
      '<audio id="genuine" src="genuinely-short.mp4" data-start="0" data-duration="8"></audio>',
    );

    const element = document.getElementById("genuine")!;
    const duration = Number(element.getAttribute("data-duration"));
    expect(duration).toBeLessThan(3);
    expect(duration).toBeGreaterThan(1.5);
    expect(warnings.join("\n")).toContain("genuine");
    expect(warnings.join("\n")).toContain("shortened to the");
  });

  it("projects the rescued duration through data-media-start before comparing it", async () => {
    // The packet scan reads a raw SOURCE duration (~realDurationSeconds, from
    // offset 0), but the authored slot is measured from data-media-start. A
    // rescue that compared the raw source duration directly against the
    // timeline-domain maxDuration would under-clamp here: it would see ~4s
    // available and wave the full 3.5s slot through, when only
    // (realDurationSeconds - 1)s of source actually remains after the 1s
    // offset — leaving the last stretch of the authored slot silent.
    const { document } = await compile(
      '<audio id="offset" src="lying-duration.mp4" data-start="0" data-media-start="1" data-duration="3.5"></audio>',
    );

    const element = document.getElementById("offset")!;
    const duration = Number(element.getAttribute("data-duration"));
    expect(duration).toBeCloseTo(realDurationSeconds - 1, 1);
  });
});
