#!/usr/bin/env node
// Flags a capture region that briefly returns to an older picture (A, B, A frames).
// node scripts/check-capture-reversion.mjs [--crop=W:H:X:Y] [--window=N] [--change=D] [--same=D] <video>...
// Frames are cropped, 96px wide, gray; D is mean abs pixel diff (0-255). Exit 0 clean, 1 flagged, 2 could not check.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WIDTH = 96;
const USAGE =
  "usage: node scripts/check-capture-reversion.mjs [--crop=W:H:X:Y] [--window=N] [--change=D] [--same=D] <video> ...";

/** Output frame height for a source of cw x ch scaled to WIDTH: even, at least 2. */
export function frameHeight(cw, ch) {
  return Math.max(2, 2 * Math.round((WIDTH * (ch / cw)) / 2));
}

function readFrames(path, crop, height) {
  return new Promise((resolve, reject) => {
    const scale = `scale=${WIDTH}:${height}:flags=area,format=gray`;
    const vf = crop ? `crop=${crop},${scale}` : scale;
    const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-vf", vf, "-f", "rawvideo", "-"]);
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code} for ${path}: ${stderr}`));
      resolve(Buffer.concat(chunks));
    });
  });
}

// Source video size, used to derive the output frame height when no crop is given.
function probeSize(path) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path,
    ]);
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", (code) => {
      const [w, h] = out.trim().split(",").map(Number);
      if (code !== 0 || !(w > 0) || !(h > 0))
        return reject(new Error(`ffprobe found no video size in ${path}`));
      resolve([w, h]);
    });
  });
}

function dist(buf, frameSize, a, b) {
  let sum = 0;
  const ao = a * frameSize;
  const bo = b * frameSize;
  for (let p = 0; p < frameSize; p++) sum += Math.abs(buf[ao + p] - buf[bo + p]);
  return sum / frameSize;
}

function peakBetween(buf, frameSize, i, k, change) {
  let peak = -1;
  let peakD = change;
  for (let j = i + 1; j < k; j++) {
    const d = Math.min(dist(buf, frameSize, i, j), dist(buf, frameSize, j, k));
    if (d > peakD) {
      peak = j;
      peakD = d;
    }
  }
  return { peak, delta: peakD };
}

// fallow-ignore-next-line complexity
export function findReversions(buf, frameSize, { window, change, same }) {
  const count = Math.floor(buf.length / frameSize);
  const byPeak = new Map();
  for (let i = 0; i < count; i++) {
    for (let k = i + 2; k <= Math.min(count - 1, i + window); k++) {
      if (dist(buf, frameSize, i, k) > same) continue;
      const { peak, delta } = peakBetween(buf, frameSize, i, k, change);
      const known = byPeak.get(peak);
      if (peak >= 0 && (!known || known.delta < delta)) {
        byPeak.set(peak, { from: i, changed: peak, back: k, delta });
      }
    }
  }
  return [...byPeak.values()].sort((x, y) => x.changed - y.changed);
}

/** Options and video paths from argv; throws on a malformed flag so a typo cannot read as "clean". */
export function parseArgs(argv) {
  const options = { crop: undefined, window: 20, change: 1.0, same: 0.25 };
  const paths = [];
  for (const arg of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(arg);
    if (!m) {
      if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
      paths.push(arg);
    } else if (m[1] === "crop") {
      if (!/^[1-9]\d*:[1-9]\d*:\d+:\d+$/.test(m[2]))
        throw new Error(`--crop needs W:H:X:Y, got ${m[2]}`);
      options.crop = m[2];
    } else if (m[1] in options) {
      const n = Number(m[2]);
      if (m[2] === "" || !Number.isFinite(n) || n < 0)
        throw new Error(`--${m[1]} needs a number, got ${m[2]}`);
      options[m[1]] = n;
    } else {
      throw new Error(`unknown option ${arg}`);
    }
  }
  return { options, paths };
}

// fallow-ignore-next-line complexity
async function checkVideo(path, options) {
  const [cw, ch] = options.crop ? options.crop.split(":").map(Number) : await probeSize(path);
  const height = frameHeight(cw, ch);
  const frameSize = WIDTH * height;
  const buf = await readFrames(path, options.crop, height);
  const frames = Math.floor(buf.length / frameSize);
  if (frames === 0) throw new Error(`no frames decoded from ${path}`);
  const hits = findReversions(buf, frameSize, options);
  const crop = options.crop ? `  crop=${options.crop}` : "";
  console.log(
    `${hits.length ? "FLAGGED" : "clean"}  ${path}${crop}  (${frames} frames checked, 0-${frames - 1})`,
  );
  for (const h of hits) {
    console.log(
      `  frame ${h.changed} differs (mean diff ${h.delta.toFixed(2)}) between frame ${h.from} and frame ${h.back}, which match`,
    );
  }
  return hits.length > 0;
}

/** Checks every video; 2 if any could not be checked, else 1 if any is flagged, else 0. */
// fallow-ignore-next-line complexity
async function main(argv) {
  let code = 0;
  try {
    const { options, paths } = parseArgs(argv);
    if (paths.length === 0) throw new Error(USAGE);
    for (const path of paths) {
      try {
        if (await checkVideo(path, options)) code = Math.max(code, 1);
      } catch (error) {
        console.error(`check-capture-reversion: ${error.message}`);
        code = 2;
      }
    }
  } catch (error) {
    console.error(`check-capture-reversion: ${error.message}`);
    code = 2;
  }
  process.exit(code);
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
