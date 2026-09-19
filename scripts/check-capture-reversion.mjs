#!/usr/bin/env node
// Flags a capture region that briefly returns to an older picture (A, B, A frames).
// node scripts/check-capture-reversion.mjs [--crop=W:H:X:Y] [--window=N] [--change=D] [--same=D] <video>...
// Frames are cropped, 96px wide, gray; D is mean abs pixel diff (0-255). Exit 1 if flagged.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const WIDTH = 96;
const args = { crop: undefined, window: 20, change: 1.0, same: 0.25 };

function readFrames(path, crop) {
  return new Promise((resolve, reject) => {
    const scale = `scale=${WIDTH}:-2:flags=area,format=gray`;
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

// The frame height depends on the crop aspect; probe it from the buffer size
// by asking ffprobe would add a dependency, so derive it from the crop or the
// video's own size.
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
    child.on("close", () => {
      const [w, h] = out.trim().split(",").map(Number);
      resolve({ w, h });
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

function parseArgs(argv) {
  const paths = [];
  for (const arg of argv) {
    const m = /^--(crop|window|change|same)=(.*)$/.exec(arg);
    if (m) args[m[1]] = m[1] === "crop" ? m[2] : Number(m[2]);
    else paths.push(arg);
  }
  return paths;
}

// fallow-ignore-next-line complexity
async function checkVideo(path) {
  const size = await probeSize(path);
  const [cw, ch] = args.crop ? args.crop.split(":").map(Number) : [size.w, size.h];
  const frameSize = WIDTH * 2 * Math.round((WIDTH * (ch / cw)) / 2);
  const buf = await readFrames(path, args.crop);
  const frames = Math.floor(buf.length / frameSize);
  const hits = findReversions(buf, frameSize, args);
  const crop = args.crop ? `  crop=${args.crop}` : "";
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

// fallow-ignore-next-line complexity
async function main(argv) {
  const paths = parseArgs(argv);
  if (paths.length === 0) {
    console.error(
      "usage: node scripts/check-capture-reversion.mjs [--crop=W:H:X:Y] [--window=N] [--change=D] [--same=D] <video> ...",
    );
    process.exit(2);
  }
  let flagged = false;
  for (const path of paths) flagged = (await checkVideo(path)) || flagged;
  process.exit(flagged ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
