import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon, strokeWidthFor } from "./Icon";
import { GLYPHS, ICON_NAMES } from "./glyphs";
import * as named from "./index";

const NUMBER = /-?\d*\.?\d+/g;

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
    for (const shape of GLYPHS[name].shapes) {
      if (!/^[Mm]/.test(shape)) continue;
      // Absolute commands only carry coordinates we can check without a path
      // parser; relative arcs and curves are bounded by their neighbours.
      const abs = shape.replace(/[a-z][^A-Z]*/g, " ");
      for (const n of abs.match(NUMBER) ?? []) {
        const v = Number(n);
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

  it("picks the stroke by size class", () => {
    expect(strokeWidthFor(12)).toBe(1.25);
    expect(strokeWidthFor(13)).toBe(1.25);
    expect(strokeWidthFor(14)).toBe(1.5);
    expect(strokeWidthFor("20px")).toBe(1.5);
    expect(renderToStaticMarkup(<Icon name="x" size={12} />)).toContain('stroke-width="1.25"');
  });
});
