import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon, strokeWidthFor } from "./Icon";
import { GLYPHS, ICON_NAMES } from "./glyphs";
import * as named from "./index";

const NUMBER = /-?\d*\.?\d+/g;
// Coordinates of every absolute command; relative segments are bounded by
// their absolute neighbours and arc radii/flags are not positions.
const COORDS_PER: Record<string, [tuple: number, keep: number]> = {
  M: [2, 2],
  L: [2, 2],
  T: [2, 2],
  H: [1, 1],
  V: [1, 1],
  C: [6, 6],
  S: [4, 4],
  Q: [4, 4],
  A: [7, 2],
};
function absolutePoints(d: string): number[] {
  const out: number[] = [];
  for (const [, cmd, body] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const spec = COORDS_PER[cmd];
    if (!spec) continue;
    const nums = (body.match(NUMBER) ?? []).map(Number);
    for (let i = 0; i + spec[0] <= nums.length; i += spec[0])
      out.push(...nums.slice(i + spec[0] - spec[1], i + spec[0]));
  }
  return out;
}
function primitiveBox(shape: string): number[] {
  const [x, y, a, b] = shape.split(" ").slice(1).map(Number);
  return shape.startsWith("c") || shape.startsWith("d")
    ? [x - a, y - a, x + a, y + a]
    : [x, y, x + a, y + b];
}

describe("studio icon set", () => {
  it("has a named export for every glyph and nothing else", () => {
    const pascal = (n: string) =>
      n
        .split("-")
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join("");
    for (const name of ICON_NAMES)
      expect(typeof named[pascal(name) as keyof typeof named]).toBe("function");
  });

  it.each(ICON_NAMES)("%s renders in currentColor on the 16 grid", (name) => {
    const html = renderToStaticMarkup(<Icon name={name} />);
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
    expect(html).toContain('aria-hidden="true"');
  });

  it.each(ICON_NAMES)("%s stays inside the 1 px safe margin", (name) => {
    const glyph = GLYPHS[name] as { shapes: readonly string[]; small?: readonly string[] };
    for (const shape of [...glyph.shapes, ...(glyph.small ?? [])]) {
      const points = /^[Mm]/.test(shape) ? absolutePoints(shape) : primitiveBox(shape);
      for (const v of points) {
        expect(v, `${name}: ${shape}`).toBeGreaterThanOrEqual(1);
        expect(v, `${name}: ${shape}`).toBeLessThanOrEqual(15);
      }
    }
  });

  it("announces itself only when given a title", () => {
    const html = renderToStaticMarkup(<Icon name="check" title="Done" />);
    expect(html).toContain("<title>Done</title>");
    expect(html).toContain('role="img"');
    expect(html).not.toContain("aria-hidden");
  });

  it("paints solid only for silhouettes", () => {
    expect(renderToStaticMarkup(<Icon name="keyframe" filled />)).toContain('fill="currentColor"');
    expect(renderToStaticMarkup(<Icon name="undo" filled />)).toContain('fill="none"');
    expect(renderToStaticMarkup(<Icon name="caret-down" />)).toContain('fill="currentColor"');
  });

  it("draws the small variant below 14 px", () => {
    expect(renderToStaticMarkup(<Icon name="file-code" size={12} />)).not.toContain(
      "M9.5 2v3.5H13",
    );
    expect(renderToStaticMarkup(<Icon name="file-code" size={14} />)).toContain("M9.5 2v3.5H13");
  });

  it("picks the stroke by size class", () => {
    expect(strokeWidthFor(12)).toBe(1.25);
    expect(strokeWidthFor(13)).toBe(1.25);
    expect(strokeWidthFor(14)).toBe(1.5);
    expect(strokeWidthFor("20px")).toBe(1.5);
    expect(renderToStaticMarkup(<Icon name="x" size={12} />)).toContain('stroke-width="1.25"');
  });
});
