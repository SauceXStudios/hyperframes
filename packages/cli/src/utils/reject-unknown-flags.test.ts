import { describe, expect, it } from "vitest";
import { runCommand } from "citty";
import type { ArgsDef, CommandDef } from "citty";
import { assertKnownFlags, guardSwallowedFlagValues } from "./reject-unknown-flags.js";
import { trackCommandFailures } from "./command-failure-tracking.js";

const cmd = {
  args: {
    output: { type: "string", alias: "o" },
    gifLoop: { type: "string" },
    docker: { type: "boolean" },
    workers: { type: "string", alias: ["w"] },
  },
} as unknown as CommandDef<ArgsDef>;

const ok = (raw: string[]) => () => assertKnownFlags(cmd, raw);

describe("assertKnownFlags", () => {
  it("accepts known long and short flags, positionals, and values", () => {
    expect(ok(["."])).not.toThrow();
    expect(ok([".", "--output", "out.mp4"])).not.toThrow();
    expect(ok([".", "-o", "out.mp4"])).not.toThrow();
    expect(ok(["--output=out.mp4"])).not.toThrow();
    expect(ok(["--workers", "6", "-w", "6"])).not.toThrow();
  });

  it("rejects an unknown long flag (the --out bug)", () => {
    expect(ok([".", "--out", "out.mp4"])).toThrow(/Unknown flag: --out/);
  });

  it("rejects an unknown short flag", () => {
    expect(ok(["-z"])).toThrow(/Unknown flag: -z/);
  });

  it("matches camelCase args by their kebab-case flag spelling", () => {
    expect(ok(["--gif-loop", "0"])).not.toThrow();
    expect(ok(["--gifLoop", "0"])).not.toThrow();
  });

  it("accepts --no-<boolean> negation", () => {
    expect(ok(["--no-docker"])).not.toThrow();
  });

  it("accepts global flags and stops at --", () => {
    expect(ok(["--help"])).not.toThrow();
    expect(ok(["--json"])).not.toThrow();
    expect(ok(["--", "--anything-goes-here"])).not.toThrow();
  });

  it("checks each char of a combined short group", () => {
    expect(ok(["-ow"])).not.toThrow(); // both known aliases
    expect(ok(["-ox"])).toThrow(/Unknown flag: -x/); // x unknown
  });
});

describe("guardSwallowedFlagValues", () => {
  const guard = (raw: string[]) => () => guardSwallowedFlagValues(cmd, raw);

  it("rejects a string flag's value that is itself a known flag spelling (default: throw)", () => {
    expect(guard(["--output", "--json"])).toThrow(/Missing value for --output/);
    expect(guard(["--output", "--help"])).toThrow(/Missing value for --output/);
  });

  it("accepts the equals form even when the inline value looks like a flag", () => {
    expect(guard(["--output=--json"])).not.toThrow();
    expect(guardSwallowedFlagValues(cmd, ["--output=--json"])).toEqual({
      rawArgs: ["--output=--json"],
      rewritten: false,
    });
  });

  it("does not reject an ordinary value, even one that starts with a dash but isn't a known flag", () => {
    expect(guard(["--output", "-out.mp4"])).not.toThrow();
  });

  it("does not reject a trailing bare string flag with nothing after it", () => {
    expect(guard(["--output"])).not.toThrow();
  });

  it("does not reject boolean-typed args, even if the next token looks flag-shaped", () => {
    expect(guard(["--docker", "--json"])).not.toThrow();
  });

  it("rejects with corrected wording when '--' ends option parsing right after the flag", () => {
    const message = () => {
      try {
        guardSwallowedFlagValues(cmd, ["--output", "--", "--json"]);
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(message()).toMatch(/Missing value for --output: "--" ends option parsing here/);
    expect(message()).not.toMatch(/which is itself a flag/);
  });

  it("rewrites an opted-in command+flag to the equals form instead of throwing", () => {
    const checkCmd: CommandDef<any> = {
      meta: { name: "check" },
      args: { "frame-check": { type: "string" }, json: { type: "boolean" } },
    };
    const result = guardSwallowedFlagValues(checkCmd, ["--frame-check", "--json"]);
    expect(result).toEqual({ rawArgs: ["--frame-check=", "--json"], rewritten: true });
  });

  it("leaves a non-opted-in command's identically-shaped flag rejected", () => {
    const otherCmd: CommandDef<any> = {
      meta: { name: "not-check" },
      args: { "frame-check": { type: "string" }, json: { type: "boolean" } },
    };
    expect(() => guardSwallowedFlagValues(otherCmd, ["--frame-check", "--json"])).toThrow(
      /Missing value for --frame-check/,
    );
  });

  it("ignores an opted-out command+flag entirely, leaving rawArgs untouched for its own recovery logic", async () => {
    const upgradeCommand = (await import("../commands/upgrade.js")).default as CommandDef<any>;
    const result = guardSwallowedFlagValues(upgradeCommand, ["--project", "--check"]);
    expect(result).toEqual({ rawArgs: ["--project", "--check"], rewritten: false });
  });
});

describe("guardSwallowedFlagValues end-to-end (via citty's real runCommand + the real wrapCommand gate)", () => {
  it("rejects the exact reported repro: `catalog --query --json`, before catalog's own run() executes", async () => {
    const catalogCommand = (await import("../commands/catalog.js")).default as CommandDef<any>;
    const wrapped = await trackCommandFailures(() => Promise.resolve(catalogCommand))();
    await expect(runCommand(wrapped, { rawArgs: ["--query", "--json"] })).rejects.toThrow(
      /Missing value for --query/,
    );
  });

  it("accepts the equals form and rejects the space-separated swallow, both through the real pipeline", async () => {
    let capturedArgs: Record<string, unknown> | undefined;
    const testCommand: CommandDef<any> = {
      meta: { name: "test-cmd" },
      args: { query: { type: "string" }, json: { type: "boolean" } },
      run: ({ args }) => {
        capturedArgs = args;
      },
    };
    const wrapped = await trackCommandFailures(() => Promise.resolve(testCommand))();

    await runCommand(wrapped, { rawArgs: ["--query=--json", "--json"] });
    expect(capturedArgs).toEqual(expect.objectContaining({ query: "--json", json: true }));

    capturedArgs = undefined;
    await expect(runCommand(wrapped, { rawArgs: ["--query", "--json"] })).rejects.toThrow(
      /Missing value for --query/,
    );
    expect(capturedArgs).toBeUndefined();
  });
});
