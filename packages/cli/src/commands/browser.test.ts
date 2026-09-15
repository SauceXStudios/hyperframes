import { join } from "node:path";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SYSTEM_CHROME = "/usr/bin/google-chrome";
// Both the puppeteer and the hyperframes-managed caches live under here.
const HOME_CACHE_ROOT = join(homedir(), ".cache");

describe("hyperframes browser path", () => {
  const origPlatform = process.platform;
  const origArch = process.arch;
  const origEnv = {
    HYPERFRAMES_BROWSER_PATH: process.env["HYPERFRAMES_BROWSER_PATH"],
    PRODUCER_HEADLESS_SHELL_PATH: process.env["PRODUCER_HEADLESS_SHELL_PATH"],
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env["HYPERFRAMES_BROWSER_PATH"];
    delete process.env["PRODUCER_HEADLESS_SHELL_PATH"];
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
    Object.defineProperty(process, "arch", { value: origArch, configurable: true });
    for (const [key, value] of Object.entries(origEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
  });

  it("prints the system Chromium path on Linux ARM64 without downloading", async () => {
    // `browser path` resolves with preferManagedChrome so it prints what
    // render uses. On Linux ARM64 there is no managed build, so that lookup
    // must still surface system Chromium directly — not fall into the
    // download path (ensureBrowser) to reach the same answer.
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
    vi.doMock("node:fs", async (importOriginal) => {
      const real = await importOriginal<typeof import("node:fs")>();
      return {
        ...real,
        existsSync: (p: string) => {
          if (p === SYSTEM_CHROME) return true;
          // Whatever the host has cached must not leak into this fixture.
          if (p.startsWith(HOME_CACHE_ROOT)) return false;
          return real.existsSync(p);
        },
      };
    });

    const manager = await import("../browser/manager.js");
    const ensureSpy = vi
      .spyOn(manager, "ensureBrowser")
      .mockResolvedValue({ executablePath: "/downloaded/chrome", source: "download" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const written: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    try {
      const { default: browserCommand } = await import("./browser.js");
      await browserCommand.run?.({
        args: { subcommand: "path", force: false, _: [] },
        cmd: browserCommand,
        rawArgs: ["path"],
      });
    } finally {
      stdoutSpy.mockRestore();
    }

    expect(written.join("")).toBe(`${SYSTEM_CHROME}\n`);
    expect(ensureSpy).not.toHaveBeenCalled();
  });
});
