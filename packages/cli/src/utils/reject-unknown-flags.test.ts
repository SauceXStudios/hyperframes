import { describe, expect, it } from "vitest";
import type { ArgsDef, CommandDef } from "citty";
import { assertKnownFlags, rejectSwallowedFlagValues } from "./reject-unknown-flags.js";

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

describe("rejectSwallowedFlagValues", () => {
  const checkAgainst = (args: Record<string, unknown>) => () =>
    rejectSwallowedFlagValues(cmd, args);

  it("rejects a string flag's value that is itself a known flag spelling", () => {
    expect(checkAgainst({ output: "--json" })).toThrow(/Missing value for --output/);
    expect(checkAgainst({ output: "--help" })).toThrow(/Missing value for --output/);
  });

  it("does not reject an ordinary value, even one that starts with a dash but isn't a known flag", () => {
    expect(checkAgainst({ output: "-out.mp4" })).not.toThrow();
  });

  it("does not reject undefined, boolean, or bare-dash values", () => {
    expect(checkAgainst({ output: undefined })).not.toThrow();
    expect(checkAgainst({ docker: true })).not.toThrow();
    expect(checkAgainst({ output: "-" })).not.toThrow();
  });

  it("ignores boolean-typed args entirely, even if their value happens to look flag-shaped", () => {
    expect(checkAgainst({ docker: "--json" } as unknown as Record<string, unknown>)).not.toThrow();
  });

  it("rejects the exact reported repro: `catalog --query --json`", async () => {
    const catalogCommand = (await import("../commands/catalog.js"))
      .default as unknown as CommandDef<ArgsDef>;
    // Simulates what citty's parser actually produces for `catalog --query --json`.
    expect(() =>
      rejectSwallowedFlagValues(catalogCommand, { query: "--json", json: false }),
    ).toThrow(/Missing value for --query/);
    // The control case from the ticket must keep working.
    expect(() =>
      rejectSwallowedFlagValues(catalogCommand, { query: "kinetic type", json: true }),
    ).not.toThrow();
  });
});
