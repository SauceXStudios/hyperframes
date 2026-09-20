#!/usr/bin/env node
import { spawnSync } from "node:child_process"; import { join } from "node:path"; import { fileURLToPath } from "node:url";
const root = join(fileURLToPath(new URL("../../../", import.meta.url))); const cli = join(root, "packages/cli/dist/cli.js"); const result = spawnSync(process.execPath, [cli, "media-use", "resolve", ...process.argv.slice(2)], { stdio: "inherit" }); process.exit(result.status ?? 1);
