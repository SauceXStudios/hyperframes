// fallow-ignore-file code-duplication
// Real-Chromium pins for motion-signature.browser.js. The happy-dom suite
// (motion-signature.browser.test.ts) mocks getComputedStyle, so it asserts the
// classifier's control flow against a fake; this suite asserts the same
// branches against the platform — Blink's attr() substitution in computed
// pseudo content, unsubstituted counter(), display:none and
// content-visibility:hidden subtrees, opt-outs on a measured scope, clip-path,
// and form control state — using the exact scripts `hyperframes check` injects.
// Skipped when no Chrome/Chromium binary is available without downloading. On
// Windows the suite is opt-in (HYPERFRAMES_BROWSER_TESTS=1): in the shared
// Windows package test lane the launch of the runner's Chrome did not complete
// within the package hookTimeout (cause not established; no other suite in this
// package launches a browser), and the suite already runs on Linux CI, where
// the runner's Chrome is found as a system browser.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSystemBrowser } from "../browser/manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const signatureScript = readFileSync(join(__dirname, "motion-signature.browser.js"), "utf-8");
const motionSampleScript = readFileSync(join(__dirname, "motion-sample.browser.js"), "utf-8");

function resolveExecutable(): string | undefined {
  for (const name of ["HYPERFRAMES_BROWSER_PATH", "PUPPETEER_EXECUTABLE_PATH"]) {
    const candidate = process.env[name];
    if (candidate && existsSync(candidate)) return candidate;
  }
  return findSystemBrowser()?.executablePath;
}

const executablePath = resolveExecutable();
const RUNS_CHROMIUM =
  !!executablePath &&
  (process.platform !== "win32" || process.env.HYPERFRAMES_BROWSER_TESTS === "1");
// The package hookTimeout is sized for cold module imports, not for launching
// a browser; give the launch its own ceiling.
const BROWSER_LAUNCH_TIMEOUT_MS = 120_000;

interface Samples {
  sweep: string;
  liveness: string;
}

declare global {
  interface Window {
    __hyperframesLayoutGeometry: () => string;
    __hyperframesMotionSample: (options: { livenessScopes: string[] }) => {
      liveness: Record<string, string>;
    };
  }
}

function composition(css: string, body: string): string {
  return `<!doctype html><html><head><style>
    html, body { margin: 0; }
    #root { position: relative; width: 640px; height: 360px; }
    .fixed { display: inline-block; width: 80px; height: 48px; font: 32px/48px monospace; text-align: center; }
    ${css}
  </style></head><body>
    <div id="root" data-composition-id="main" data-width="640" data-height="360">${body}</div>
  </body></html>`;
}

describe.skipIf(!RUNS_CHROMIUM)("motion-signature.browser in Chromium", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });
  }, BROWSER_LAUNCH_TIMEOUT_MS);

  afterAll(async () => {
    await browser?.close();
  });

  async function load(html: string): Promise<void> {
    await page.setContent(html);
    await page.addScriptTag({ content: signatureScript });
    await page.addScriptTag({ content: motionSampleScript });
  }

  async function sample(scope = "*"): Promise<Samples> {
    return page.evaluate(
      (livenessScope) => ({
        sweep: window.__hyperframesLayoutGeometry(),
        liveness:
          window.__hyperframesMotionSample({ livenessScopes: [livenessScope] }).liveness[
            livenessScope
          ] ?? "",
      }),
      scope,
    );
  }

  async function mutate(script: string): Promise<void> {
    await page.evaluate(script);
  }

  it("treats an attr()-backed fixed-width countdown as motion in both samplers", async () => {
    await load(
      composition(
        "#countdown::after { content: attr(data-txt); }",
        '<span id="countdown" class="fixed" data-txt="10"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("countdown").setAttribute("data-txt", "09")');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
    expect(after.liveness).not.toBe(before.liveness);
  });

  it("keeps both signatures identical when a countdown with every textual channel is frozen", async () => {
    await load(
      composition(
        "body { counter-reset: countdown 10; } #countdown::after { content: attr(data-txt) counter(countdown); }",
        '<span id="countdown" class="fixed" data-txt="10">10</span><textarea id="note">10</textarea>',
      ),
    );
    const first = await sample();
    const second = await sample();

    expect(second).toEqual(first);
  });

  it("ignores a display:none decoy counter owner in a frozen composition", async () => {
    await load(
      composition(
        "#decoy { display: none; counter-reset: countdown 10; } #countdown::after { content: counter(countdown); }",
        '<div id="decoy"></div><span id="countdown" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("decoy").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a decoy counter owner nested inside a display:none subtree", async () => {
    await load(
      composition(
        "#hidden-parent { display: none; } #decoy { display: block; counter-reset: countdown 10; } #countdown::after { content: counter(countdown); }",
        '<div id="hidden-parent"><div id="decoy"></div></div><span id="countdown" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("decoy").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores counter state when nothing paints a counter", async () => {
    await load(
      composition(
        "#owner { height: 0; counter-reset: countdown 10; }",
        '<div id="owner"></div><span id="countdown" class="fixed">10</span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("owner").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a zero-box decoy whose counter name nothing paints even when a list marker exists", async () => {
    await load(
      composition(
        "li { width: 80px; height: 48px; } #decoy { height: 0; counter-reset: decoy 10; }",
        '<ul><li>item</li></ul><div id="decoy"></div>',
      ),
    );
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("li")!).display)).toBe(
      "list-item",
    );
    const before = await sample();
    await mutate('document.getElementById("decoy").style.counterReset = "decoy 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a counter consumed only by a pseudo-element under a data-layout-ignore layer", async () => {
    await load(
      composition(
        "#owner { height: 0; counter-reset: countdown 10; } #a::after { content: counter(countdown); }",
        '<div id="owner"></div><div data-layout-ignore><span id="a" class="fixed"></span></div>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("owner").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a counter consumed only by a pseudo-element that inherits visibility:hidden", async () => {
    await load(
      composition(
        "#owner { height: 0; counter-reset: countdown 10; } #a { visibility: hidden; } #a::after { content: counter(countdown); }",
        '<div id="owner"></div><span id="a" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("owner").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("sees a counter painted by a visible pseudo-element on a visibility:hidden host", async () => {
    await load(
      composition(
        "body { counter-reset: countdown 10; } #a { visibility: hidden; } #a::after { visibility: visible; content: counter(countdown); }",
        '<span id="a" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.body.style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("sees a counter painted only through a ::marker", async () => {
    await load(
      composition(
        "#owner { height: 0; counter-reset: countdown 10; } li { width: 80px; height: 48px; } li::marker { content: counter(countdown); }",
        '<div id="owner"></div><ul><li>item</li></ul>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("owner").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("sees counters(), styled counter(), and counter-set owners", async () => {
    await load(
      composition(
        "#owner { height: 0; counter-reset: outer 1 inner 5; counter-set: styled 10; } #a::after { content: counters(outer, '.') ' ' counter(styled, upper-roman); }",
        '<div id="owner"></div><span id="a" class="fixed"></span>',
      ),
    );
    const start = await sample();
    await mutate('document.getElementById("owner").style.counterReset = "outer 2 inner 5"');
    const afterCounters = await sample();
    await mutate('document.getElementById("owner").style.counterSet = "styled 9"');
    const afterSet = await sample();

    expect(afterCounters.sweep).not.toBe(start.sweep);
    expect(afterSet.sweep).not.toBe(afterCounters.sweep);
  });

  it("sees a zero-box owner's counter change when a visible pseudo-element paints it", async () => {
    await load(
      composition(
        "#owner { counter-reset: countdown 10; } #countdown::after { content: counter(countdown); }",
        '<div id="owner"><span id="countdown" class="fixed"></span></div>',
      ),
    );
    // Blink leaves counter() unsubstituted in computed content, so the only
    // signal is the owner's counter state.
    expect(
      await page.evaluate(
        () => getComputedStyle(document.getElementById("countdown")!, "::after").content,
      ),
    ).toBe("counter(countdown)");
    const before = await sample();
    await mutate('document.getElementById("owner").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
    expect(after.liveness).not.toBe(before.liveness);
  });

  it("sees a counter painted by a zero-box host's absolutely positioned pseudo-element", async () => {
    await load(
      composition(
        "body { counter-reset: countdown 10; } #host { width: 0; height: 0; } #host::after { position: absolute; left: 100px; top: 100px; content: counter(countdown); }",
        '<div id="host"></div>',
      ),
    );
    const before = await sample();
    await mutate('document.body.style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("sees a counter owned above the composition root change", async () => {
    await load(
      composition(
        "body { counter-reset: countdown 10; } #countdown::after { content: counter(countdown); }",
        '<span id="countdown" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.body.style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("sees a pseudo-element's own counter-increment change", async () => {
    await load(
      composition(
        "#countdown::after { counter-increment: countdown 10; content: counter(countdown); } #countdown.next::after { counter-increment: countdown 9; }",
        '<span id="countdown" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("countdown").classList.add("next")');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("sees a clip-path wipe over a box that never moves", async () => {
    await load(
      composition(
        "#panel { width: 200px; height: 100px; background: #f00; clip-path: inset(0 100% 0 0); }",
        '<div id="panel"></div>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("panel").style.clipPath = "inset(0 50% 0 0)"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
    expect(after.liveness).not.toBe(before.liveness);
  });

  it("sees textarea value and checkbox indeterminate changes", async () => {
    await load(
      composition(
        "",
        '<textarea id="note" class="fixed">10</textarea><input id="toggle" type="checkbox" />',
      ),
    );
    const start = await sample();
    await mutate('document.getElementById("note").value = "09"');
    const afterText = await sample();
    await mutate('document.getElementById("toggle").indeterminate = true');
    const afterIndeterminate = await sample();

    expect(afterText.sweep).not.toBe(start.sweep);
    expect(afterIndeterminate.sweep).not.toBe(afterText.sweep);
  });

  it("sees the composition root's own text change", async () => {
    await load(composition("", "10"));
    const before = await sample();
    await mutate('document.getElementById("root").firstChild.textContent = "09"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
    expect(after.liveness).not.toBe(before.liveness);
  });

  it("ignores text mutations inside a display:none descendant", async () => {
    await load(
      composition(
        "#hidden { display: none; }",
        '<span id="countdown" class="fixed">10<span id="hidden">10</span></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("hidden").textContent = "09"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores motion on a data-layout-ignore layer", async () => {
    await load(
      composition(
        "#glow { position: absolute; width: 100px; height: 100px; background: #0f0; }",
        '<div id="glow" data-layout-ignore></div><span id="countdown" class="fixed">10</span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("glow").style.left = "200px"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  // A keepsMoving scope names the element explicitly, so the layout-audit
  // opt-out on the scope itself does not empty its signature (which the Node
  // side would otherwise report as motion_selector_missing for an element that
  // exists). Opt-outs INSIDE the scope still apply.
  it("measures a keepsMoving scope that is itself data-layout-ignore, but not opted-out layers inside it", async () => {
    await load(
      composition(
        "#scene { position: absolute; width: 300px; height: 200px; } #logo, #glow { position: absolute; width: 50px; height: 50px; background: #00f; }",
        '<div id="scene" data-layout-ignore><div id="logo"></div><div id="glow" data-layout-ignore></div></div>',
      ),
    );
    const before = await sample("#scene");
    expect(before.liveness).not.toBe("");
    await mutate('document.getElementById("glow").style.left = "100px"');
    const afterIgnoredMove = await sample("#scene");
    await mutate('document.getElementById("logo").style.left = "100px"');
    const afterMove = await sample("#scene");

    expect(afterIgnoredMove.liveness).toBe(before.liveness);
    expect(afterMove.liveness).not.toBe(before.liveness);
  });

  it("ignores text mutations inside content-visibility:hidden contents", async () => {
    await load(
      composition(
        "#wrap { content-visibility: hidden; }",
        '<div id="wrap"><span id="skipped" class="fixed">10</span></div><span class="fixed">10</span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("skipped").textContent = "09"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a decoy counter owner inside content-visibility:hidden contents", async () => {
    await load(
      composition(
        "#wrap { content-visibility: hidden; } #decoy { counter-reset: countdown 10; } #countdown::after { content: counter(countdown); }",
        '<div id="wrap"><div id="decoy"></div></div><span id="countdown" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("decoy").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a decoy counter owner inside off-screen content-visibility:auto contents", async () => {
    await load(
      composition(
        "#far { content-visibility: auto; position: absolute; top: 5000px; width: 10px; height: 10px; } #decoy { counter-reset: countdown 10; } #countdown::after { content: counter(countdown); }",
        '<div id="far"><div id="decoy"></div></div><span id="countdown" class="fixed"></span>',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("decoy").style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("ignores a repaint of a canvas whose contents are skipped by content-visibility:hidden", async () => {
    await load(
      composition(
        "#c { content-visibility: hidden; width: 100px; height: 100px; }",
        '<canvas id="c" width="100" height="100"></canvas>',
      ),
    );
    const before = await sample();
    await mutate(
      'const ctx = document.getElementById("c").getContext("2d"); ctx.fillStyle = "#f00"; ctx.fillRect(0, 0, 100, 100);',
    );
    const after = await sample();

    expect(after).toEqual(before);
  });

  // content-visibility only skips contents where size containment applies; on
  // a non-atomic inline host it is a no-op and everything inside still paints.
  it("keeps signing text and pseudo content inside an inline content-visibility:hidden host", async () => {
    await load(
      composition(
        "#host { content-visibility: hidden; } #host::after { content: attr(data-txt); }",
        '<span id="host" data-txt="10"><span id="kid" class="fixed">10</span></span>',
      ),
    );
    const start = await sample();
    await mutate('document.getElementById("kid").textContent = "09"');
    const afterText = await sample();
    await mutate('document.getElementById("host").setAttribute("data-txt", "09")');
    const afterPseudo = await sample();

    expect(afterText.sweep).not.toBe(start.sweep);
    expect(afterText.liveness).not.toBe(start.liveness);
    expect(afterPseudo.sweep).not.toBe(afterText.sweep);
  });

  it("sees a checkbox toggle on a content-visibility:hidden control", async () => {
    await load(
      composition(
        "#toggle { content-visibility: hidden; width: 24px; height: 24px; }",
        '<input id="toggle" type="checkbox" />',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("toggle").checked = true');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("ignores a value change on a text input whose contents are skipped by content-visibility:hidden", async () => {
    await load(
      composition(
        "#note { content-visibility: hidden; width: 120px; height: 40px; font: 24px monospace; }",
        '<input id="note" value="10" />',
      ),
    );
    const before = await sample();
    await mutate('document.getElementById("note").value = "09"');
    const after = await sample();

    expect(after).toEqual(before);
  });

  it("sees a counter painted only by a display:contents host's pseudo-element", async () => {
    await load(
      composition(
        "body { counter-reset: countdown 10; } #host { display: contents; } #host::after { content: counter(countdown); font: 32px/48px monospace; }",
        '<div id="host"></div>',
      ),
    );
    const before = await sample();
    await mutate('document.body.style.counterReset = "countdown 9"');
    const after = await sample();

    expect(after.sweep).not.toBe(before.sweep);
  });

  it("ignores a content-visibility:hidden host's own text and pseudo content but still sees its box move", async () => {
    await load(
      composition(
        "#host { content-visibility: hidden; position: absolute; width: 80px; height: 48px; background: #f00; } #host::after { content: attr(data-txt); }",
        '<div id="host" data-txt="10">10</div>',
      ),
    );
    const start = await sample();
    await mutate('document.getElementById("host").firstChild.textContent = "09"');
    await mutate('document.getElementById("host").setAttribute("data-txt", "09")');
    const afterContents = await sample();
    await mutate('document.getElementById("host").style.left = "100px"');
    const afterMove = await sample();

    expect(afterContents).toEqual(start);
    expect(afterMove.sweep).not.toBe(start.sweep);
  });
});
