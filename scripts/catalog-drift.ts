// Fails when the committed docs/public/catalog, which the docs build serves as-is, differs from generator output.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runAsCommand } from "./entrypoint.ts";
import { discoverItems, primarySource } from "./generate-catalog-pages.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LISTED = 40;

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

/** One line per file that is missing, extra or different between the generated and committed trees. */
export function treeDifferences(generatedRoot: string, committedRoot: string): string[] {
  const generated = new Set(filesUnder(generatedRoot));
  const committed = new Set(filesUnder(committedRoot));
  const missing = [...generated].filter((file) => !committed.has(file));
  const extra = [...committed].filter((file) => !generated.has(file));
  const changed = [...generated].filter(
    (file) =>
      committed.has(file) &&
      !readFileSync(join(generatedRoot, file)).equals(readFileSync(join(committedRoot, file))),
  );
  return [
    ...missing.map((file) => `not committed: ${file}`),
    ...extra.map((file) => `no longer generated: ${file}`),
    ...changed.map((file) => `stale: ${file}`),
  ];
}

/**
 * `meta.codeLines` on a committed catalog page is copied from the registry source at generation
 * time, not read live, so an edit to the source after the last regen leaves it silently wrong
 * (motion-blur shipped 406 against a 722-line source). Checked against the source directly,
 * skipping generate-catalog-pages.ts entirely, so this stays cheap enough to run every time.
 */
export function codeLinesDrift(committedCatalogDir: string): string[] {
  const mismatches: string[] = [];
  for (const { kind, manifest } of discoverItems()) {
    const file = primarySource(kind, manifest);
    if (!file) continue;
    const dir = kind === "block" ? "blocks" : "components";
    const pagePath = join(committedCatalogDir, dir, `${manifest.name}.mdx`);
    if (!existsSync(pagePath)) continue; // an absent page is treeDifferences' job, not this one's
    const match = readFileSync(pagePath, "utf-8").match(/"codeLines":(\d+)/);
    if (!match || !match[1]) continue; // page has no code fence, nothing to compare
    const committed = Number(match[1]);
    const real = file.source.split("\n").length;
    if (committed !== real) {
      mismatches.push(
        `stale codeLines: catalog/${dir}/${manifest.name}.mdx says ${committed}, source is ${real} lines`,
      );
    }
  }
  return mismatches;
}

function generateInto(outRoot: string): number {
  const run = spawnSync("npx", ["tsx", "scripts/generate-catalog-payloads.ts"], {
    cwd: repoRoot,
    env: { ...process.env, CATALOG_PAYLOAD_ROOT: outRoot },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return run.status ?? 1;
}

/** A tree as `git` holds it, so a file the working tree has but a .gitignore rule keeps out cannot hide drift. */
function extractCommitted(gitPath: string, into: string): string {
  const archive = spawnSync("git", ["archive", "HEAD", gitPath], {
    cwd: repoRoot,
    maxBuffer: 2 ** 31 - 1,
  });
  if (archive.status !== 0) throw new Error(`git archive of ${gitPath} failed.`);
  mkdirSync(into, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", into], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`could not unpack the committed ${gitPath}.`);
  return join(into, gitPath);
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "catalog-drift-"));
  const outRoot = join(base, "generated");
  try {
    if (generateInto(outRoot) !== 0) throw new Error("The catalog payload generator failed.");
    const committedPayloadRoot = extractCommitted(
      "docs/public/catalog",
      join(base, "committed-payload"),
    );
    const differences = treeDifferences(outRoot, committedPayloadRoot);
    const committedCatalogDir = extractCommitted("docs/catalog", join(base, "committed-catalog"));
    const staleCodeLines = codeLinesDrift(committedCatalogDir);
    if (differences.length === 0 && staleCodeLines.length === 0) {
      return console.log("docs/public/catalog and every page's codeLines match the generator.");
    }
    const lines: string[] = [];
    if (differences.length > 0) {
      lines.push(
        `docs/public/catalog differs from the generator in ${differences.length} file(s):`,
        ...differences.slice(0, MAX_LISTED).map((line) => `  ${line}`),
        "Regenerate with `tsx scripts/generate-catalog-payloads.ts` and commit the result.",
      );
    }
    if (staleCodeLines.length > 0) {
      lines.push(
        `${staleCodeLines.length} page(s) have a stale codeLines:`,
        ...staleCodeLines.slice(0, MAX_LISTED).map((line) => `  ${line}`),
        "Regenerate with `tsx scripts/generate-catalog-pages.ts` and commit the result.",
      );
    }
    throw new Error(lines.join("\n"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

runAsCommand(import.meta.url, main);
