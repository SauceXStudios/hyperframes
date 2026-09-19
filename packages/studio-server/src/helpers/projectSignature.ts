import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ResolvedProject, StudioApiAdapter } from "../types.js";

const SIGNATURE_TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
]);
const SIGNATURE_EXCLUDED_DIRS = new Set([
  ".cache",
  ".git",
  ".hyperframes",
  ".next",
  ".thumbnails",
  ".transcode-cache",
  ".vite",
  ".waveform-cache",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "outputs",
  "renders",
]);
const MAX_SIGNATURE_TEXT_BYTES = 2_000_000;
const STUDIO_SIGNATURE_MANIFEST_PATHS = [
  ".hyperframes/studio-manual-edits.json",
  ".hyperframes/studio-motion.json",
] as const;

/**
 * Whether a write at `changedPath` can change `createProjectSignature(projectDir)`.
 *
 * Owned here because it is the exact complement of what the walk below collects,
 * and a second copy of that reasoning drifts the moment either set changes. A
 * watcher that invalidates on everything is not merely wasteful: `.thumbnails/`
 * is written by the thumbnail route on every capture, and each capture reads the
 * preview, so an unfiltered watcher discards the memo on roughly every request of
 * the one workload the memo exists for.
 *
 * Note this is not `WATCHER_EXCLUDED_DIRS`, which is character-identical but
 * excludes all of `.hyperframes/` — the signature deliberately reads two manifest
 * files from inside it, so filtering with that set would stop motion-state saves
 * from ever invalidating.
 *
 * Every segment is tested, not just the parents, so a directory event on an
 * excluded dir itself (`unlinkDir .thumbnails`) is filtered too. The cost is that
 * a *file* literally named `dist` at the project root reads as excluded; the walk
 * would collect it, so it is a false negative, and no real project has one.
 */
export function affectsProjectSignature(projectDir: string, changedPath: string): boolean {
  const relativePath = relative(resolve(projectDir), resolve(changedPath));
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }
  const segments = relativePath.split(sep);
  if (STUDIO_SIGNATURE_MANIFEST_PATHS.includes(segments.join("/") as never)) return true;
  return !segments.some((segment) => SIGNATURE_EXCLUDED_DIRS.has(segment));
}

interface ProjectSignatureFile {
  file: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  textContentEligible: boolean;
}

const projectSignatureCache = new Map<string, ProjectSignatureCacheEntry>();

function isPathWithin(parentDir: string, childPath: string): boolean {
  const childRelativePath = relative(parentDir, childPath);
  return (
    childRelativePath === "" ||
    (!childRelativePath.startsWith("..") && !isAbsolute(childRelativePath))
  );
}

function isTextContentEligible(file: string, size: number): boolean {
  return (
    SIGNATURE_TEXT_EXTENSIONS.has(extname(file).toLowerCase()) && size <= MAX_SIGNATURE_TEXT_BYTES
  );
}

function collectProjectSignatureFiles(
  projectDir: string,
  dir: string,
  files: ProjectSignatureFile[],
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SIGNATURE_EXCLUDED_DIRS.has(entry)) continue;
    const file = resolve(dir, entry);
    if (!isPathWithin(projectDir, file)) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      collectProjectSignatureFiles(projectDir, file, files);
    } else if (stat.isFile()) {
      files.push({
        file,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        size: stat.size,
        textContentEligible: isTextContentEligible(file, stat.size),
      });
    }
  }
}

function collectProjectSignatureManifestFiles(
  projectDir: string,
  files: ProjectSignatureFile[],
): void {
  const seen = new Set(files.map((entry) => entry.file));
  for (const manifestPath of STUDIO_SIGNATURE_MANIFEST_PATHS) {
    const file = resolve(projectDir, manifestPath);
    if (seen.has(file) || !isPathWithin(projectDir, file)) continue;
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(file);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    files.push({
      file,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      textContentEligible: isTextContentEligible(file, stat.size),
    });
    seen.add(file);
  }
}

function createProjectFingerprint(projectDir: string, files: ProjectSignatureFile[]): string {
  const hash = createHash("sha256");
  for (const entry of files) {
    hash.update(relative(projectDir, entry.file));
    hash.update("\0");
    hash.update(String(entry.size));
    hash.update("\0");
    hash.update(String(entry.mtimeMs));
    hash.update("\0");
    hash.update(String(entry.ctimeMs));
    hash.update("\0");
    hash.update(entry.textContentEligible ? "text" : "binary");
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 24);
}

/**
 * Resolve the project signature through the adapter's cached path when the host
 * provides one (the CLI invalidates its cache from the file watcher), falling
 * back to a direct computation.
 */
export function resolveProjectSignature(adapter: StudioApiAdapter, projectDir: string): string {
  return adapter.getProjectSignature?.(projectDir) ?? createProjectSignature(projectDir);
}

/** The shared route opening: resolve the project (null → caller 404s) with its signature. */
export async function resolveProjectAndSignature(
  adapter: StudioApiAdapter,
  projectId: string,
): Promise<{ project: ResolvedProject; signature: string } | null> {
  const project = await adapter.resolveProject(projectId);
  if (!project) return null;
  return { project, signature: resolveProjectSignature(adapter, project.dir) };
}

interface ProjectSignatures {
  signature: string;
  fileHashes: Record<string, string>;
}

interface ProjectSignatureCacheEntry {
  fingerprint: string;
  signatures: ProjectSignatures;
}

function hashFile(entry: ProjectSignatureFile): string {
  const hash = createHash("sha256");
  hash.update(String(entry.size));
  hash.update("\0");
  if (entry.textContentEligible) {
    try {
      hash.update(readFileSync(entry.file));
    } catch {
      hash.update(String(entry.mtimeMs));
    }
  } else {
    hash.update(String(entry.mtimeMs));
  }
  return hash.digest("hex").slice(0, 16);
}

function computeProjectSignatures(projectDir: string): ProjectSignatures {
  const normalizedProjectDir = resolve(projectDir);
  const files: ProjectSignatureFile[] = [];
  collectProjectSignatureFiles(normalizedProjectDir, normalizedProjectDir, files);
  collectProjectSignatureManifestFiles(normalizedProjectDir, files);
  files.sort((a, b) => a.file.localeCompare(b.file));

  const fingerprint = createProjectFingerprint(normalizedProjectDir, files);
  const cached = projectSignatureCache.get(normalizedProjectDir);
  if (cached?.fingerprint === fingerprint) return cached.signatures;

  const hash = createHash("sha256");
  const fileHashes: Record<string, string> = {};
  for (const entry of files) {
    const relativePath = relative(normalizedProjectDir, entry.file);
    const fileHash = hashFile(entry);
    fileHashes[relativePath.split(sep).join("/")] = fileHash;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fileHash);
    hash.update("\0");
  }
  const signatures = { signature: hash.digest("hex").slice(0, 24), fileHashes };
  projectSignatureCache.set(normalizedProjectDir, { fingerprint, signatures });
  return signatures;
}

/**
 * Creates a stable preview cache-busting signature for project source plus Studio manifests.
 */
export function createProjectSignature(projectDir: string): string {
  return computeProjectSignatures(projectDir).signature;
}

/** Above this many files the per-file map is dropped for the whole-project signature. */
export const MAX_FILE_SIGNATURE_FILES = 3000;

export type ProjectFileSignatures = { files: Record<string, string> } | { all: string };

/**
 * Per-file content hashes (posix paths relative to the project) that share the
 * project signature's memoized walk. Large projects fall back to `{ all }`.
 */
export function createProjectFileSignatures(projectDir: string): ProjectFileSignatures {
  const { signature, fileHashes } = computeProjectSignatures(projectDir);
  if (Object.keys(fileHashes).length > MAX_FILE_SIGNATURE_FILES) return { all: signature };
  return { files: fileHashes };
}
