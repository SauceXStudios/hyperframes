import type { ArgDef, ArgsDef, CommandDef } from "citty";

// citty is permissive: an unrecognized flag (e.g. `render --out x` when the flag
// is `--output`/`-o`) is silently ignored instead of rejected, so the value is
// dropped and the command falls back to its default — a silent wrong result. We
// reject unknown flags up front with a clear message.

// Global flags citty / the CLI understand on every command.
const ALWAYS_KNOWN = new Set(["help", "h", "version", "v", "json"]);

// A camelCase arg name (`gifLoop`) is passed as `--gif-loop`; a kebab name is
// passed as-is. Accept both spellings so the validator matches citty's parsing.
function nameVariants(name: string): string[] {
  const kebab = name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return [name, kebab, camel];
}

// Add every spelling of one declared arg — its name variants plus any aliases.
// `def` is tolerated as undefined: this guard runs on every CLI invocation, so a
// malformed args entry must not turn a valid command into a crash.
function addSpellings(into: Set<string>, name: string, def: ArgDef | undefined): void {
  for (const v of nameVariants(name)) into.add(v);
  const alias = def && "alias" in def ? def.alias : undefined;
  if (typeof alias === "string") into.add(alias);
  else if (Array.isArray(alias)) for (const a of alias) into.add(a);
}

function knownFlags(args: ArgsDef | undefined): Set<string> {
  const known = new Set(ALWAYS_KNOWN);
  for (const [name, def] of Object.entries(args ?? {})) addSpellings(known, name, def);
  return known;
}

// The unknown flag a single token introduces, or null when it's fine
// (positional, flag value, `--`, or all-known). `--no-foo` -> `foo`,
// `--flag=value` -> `flag`; a combined short group (`-ab`) checks each char.
// `--flag`, `--flag=value`, `--no-flag` -> the bare flag name.
function longFlagName(tok: string): string {
  const name = tok.slice(2).split("=")[0] ?? "";
  return name.startsWith("no-") ? name.slice(3) : name;
}

function unknownFlagIn(tok: string, known: Set<string>): string | null {
  if (tok === "-" || !tok.startsWith("-")) return null; // positional or flag value
  if (tok.startsWith("--")) {
    const name = longFlagName(tok);
    return name && !known.has(name) ? `--${name}` : null;
  }
  for (const ch of tok.slice(1).split("=")[0] ?? "") {
    if (!known.has(ch)) return `-${ch}`; // combined shorts: check each char
  }
  return null;
}

/**
 * Throw on the first flag in `rawArgs` not declared by `cmd` (its args + aliases
 * + the global set). Only dash-prefixed tokens are inspected, so positionals and
 * flag values pass through untouched. Stops at `--`.
 */
export function assertKnownFlags(cmd: CommandDef<ArgsDef>, rawArgs: string[]): void {
  if (!Array.isArray(rawArgs)) return;
  // citty types `args` as Resolvable<ArgsDef> (it may be a fn/promise); every
  // hyperframes command uses a static object, so treat anything else as "no
  // declared args" and skip validation rather than risk a wrong rejection.
  const rawDef = cmd.args;
  const args = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const known = knownFlags(args);
  for (const tok of rawArgs) {
    if (tok === "--") break;
    const bad = unknownFlagIn(tok, known);
    if (bad) throw new Error(`Unknown flag: ${bad}`);
  }
}

/**
 * Throw when an already-parsed `type: "string"`/`"enum"` arg's value is
 * itself the exact spelling of a flag this command (or the global set)
 * declares. This is the shape citty's parser produces when the value is
 * missing: `node:util.parseArgs` (which citty delegates to, `strict: false`)
 * unconditionally consumes the next token as a string arg's value with no
 * guard against it being another flag, so `catalog --query --json` parses to
 * `args.query === "--json"`, `args.json` never set — the JSON-mode caller
 * silently gets human-readable stdout instead of erroring.
 *
 * A value that exactly matches a declared flag spelling being a *genuine*
 * value is vanishingly unlikely, so callers should reject rather than
 * silently mis-parse. Opt-in per command (not part of `assertKnownFlags`,
 * which every command goes through before its own `run()`): some commands
 * legitimately let a string flag stand bare with a following flag right
 * after it (e.g. `check --frame-check --json`, resolved by that command's
 * own raw-args preprocessing before citty ever parses it) — a blanket check
 * at that shared, pre-parse layer can't tell that case apart from this bug.
 */
export function rejectSwallowedFlagValues(
  // `CommandDef<any>`, not `<ArgsDef>`: citty's `CommandContext` is invariant
  // in its args type (via `setup`), so a caller's own concretely-typed `cmd`
  // (e.g. `CommandDef<typeof CATALOG_ARGS>`) doesn't structurally satisfy
  // `CommandDef<ArgsDef>` — this mirrors `AnyCommandDef` in
  // command-failure-tracking.ts, which hits the same variance issue.
  // Optional: a unit test that calls a command's `run()` directly (bypassing
  // citty's `runCommand`, which always supplies `cmd`) may omit it entirely.
  cmd: CommandDef<any> | undefined,
  args: Record<string, unknown>,
): void {
  const rawDef = cmd?.args;
  const argsDef = rawDef && typeof rawDef === "object" ? (rawDef as ArgsDef) : undefined;
  const known = knownFlags(argsDef);
  for (const [name, def] of Object.entries(argsDef ?? {})) {
    if (def?.type !== "string" && def?.type !== "enum") continue;
    const value = args[name];
    if (typeof value !== "string" || value === "-" || !value.startsWith("-")) continue;
    if (unknownFlagIn(value, known) === null) {
      throw new Error(`Missing value for --${name} (got "${value}", which is itself a flag)`);
    }
  }
}
