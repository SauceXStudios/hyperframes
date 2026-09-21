#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrackedPaths } from "./check-tracked-artifacts.mjs";

const BASELINE = "scripts/single-owners-baseline.json";

function validateRule(rule, files) {
  if (
    ![rule.id, rule.pattern, rule.owner].every((value) => typeof value === "string" && value.length)
  )
    throw new Error("Owner rules require id, pattern and owner");
  if (!files.includes(rule.owner)) throw new Error(`${rule.id}: missing owner ${rule.owner}`);
  for (const entry of rule.allowlist) {
    if (
      ![
        files.includes(entry.file),
        typeof entry.reason === "string",
        Boolean(entry.reason?.trim()),
      ].every(Boolean)
    )
      throw new Error(`${rule.id}: allowlist needs an existing file and reason`);
  }
}

function scanRule(rule, files, read) {
  validateRule(rule, files);
  const pattern = new RegExp(rule.pattern, "g");
  if (!read(rule.owner).match(pattern))
    throw new Error(`${rule.id}: pattern does not match its owner`);
  const exempt = new Set([rule.owner, ...rule.allowlist.map((entry) => entry.file)]);
  return files
    .filter((file) => !exempt.has(file))
    .flatMap((file) => {
      const count = [...read(file).matchAll(pattern)].length;
      return count ? [[`${rule.id}:${file}`, count]] : [];
    });
}

export function ownerViolations(files, read, manifest) {
  const ids = manifest.rules.map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate owner rule id");
  const sourceFiles = files.filter((file) => /\.(?:[cm]?js|tsx?)$/.test(file));
  return Object.fromEntries(manifest.rules.flatMap((rule) => scanRule(rule, sourceFiles, read)));
}

function budgetIssue(key, count, current, previous) {
  if (![Number.isInteger(count), count > 0, count <= previous].every(Boolean))
    return `${key}: baseline may only shrink`;
  return current < count ? `${key}: lower baseline to ${current}` : undefined;
}

export function ratchet(violations, baseline, previous = baseline) {
  const issues = Object.entries(violations)
    .filter(([key, count]) => count > (baseline.files[key] ?? 0))
    .map(([key, count]) => `${key}: ${count} matches outside the owner`);
  for (const [key, count] of Object.entries(baseline.files)) {
    const issue = budgetIssue(key, count, violations[key] ?? 0, previous.files[key] ?? 0);
    if (issue) issues.push(issue);
  }
  const total = Object.values(baseline.files).reduce((sum, count) => sum + count, 0);
  if (baseline.total !== total) issues.push("Incorrect baseline total");
  return issues;
}

function previousBaseline(base, fallback) {
  const paths = execFileSync("git", ["ls-tree", "--name-only", base, "--", BASELINE], {
    encoding: "utf8",
  });
  if (!paths.trim()) return fallback;
  return JSON.parse(execFileSync("git", ["show", `${base}:${BASELINE}`], { encoding: "utf8" }));
}

function main() {
  const read = (file) => readFileSync(file, "utf8");
  const manifest = JSON.parse(read("scripts/single-owners.json"));
  const violations = ownerViolations(readTrackedPaths(process.cwd()), read, manifest);
  const baseline = JSON.parse(read(BASELINE));
  const errors = ratchet(
    violations,
    baseline,
    previousBaseline(process.argv[2] ?? "origin/main", baseline),
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log(
    `Single owners verified: ${baseline.total} baselined matches in ${Object.keys(baseline.files).length} rule/file pairs.`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
