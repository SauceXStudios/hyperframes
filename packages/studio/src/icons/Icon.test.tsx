import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_SIZES, Icon } from "./Icon";

const SRC = join(__dirname, "..");

// Bespoke domain drawings (logos, keyframe diamonds, graphs, overlays): the count is per file.
const DOMAIN_SVG_COUNT: Record<string, number> = {
  "components/StudioHeader.tsx": 1,
  "components/TimelineToolbar.tsx": 4,
  "components/editor/BorderRadiusEditor.tsx": 1,
  "components/editor/CanvasContextMenu.tsx": 1,
  "components/editor/EaseCurveSection.tsx": 1,
  "components/editor/GestureRecordControl.tsx": 1,
  "components/editor/GestureTrailOverlay.tsx": 1,
  "components/editor/KeyframeDiamond.tsx": 1,
  "components/editor/MotionPathOverlay.tsx": 2,
  "components/editor/PropertyPanelFlatFooter.tsx": 1,
  "components/editor/Transform3DCube.tsx": 2,
  "components/editor/easeCurveSvg.tsx": 1,
  "components/editor/propertyPanelColorCurveGraph.tsx": 1,
  "components/sidebar/AudioRow.tsx": 2,
  "components/ui/HyperframesMark.tsx": 1,
  "player/components/PlayerControls.tsx": 2,
  "player/components/TimelineAutomationLane.tsx": 1,
  "player/components/TimelineClipDiamonds.tsx": 1,
  "player/components/TimelineRuler.tsx": 1,
};

// Toggle buttons that draw their on-state with the heavier `selected` weight.
const SELECTED_STATE_FILES = ["components/editor/SnapToolbar.tsx"];

function sourceFiles(dir = SRC): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    const path = relative(SRC, full).split(sep).join("/");
    const isCode = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    if (!isCode || path.startsWith("icons/")) return [];
    return [{ path, text: readFileSync(full, "utf8") }];
  });
}

describe("Icon", () => {
  it.each(ICON_SIZES)("renders at %ipx as a decorative currentColor glyph", (size) => {
    const html = renderToStaticMarkup(<Icon name="x" size={size} />);
    expect(html).toContain(`width="${size}"`);
    expect(html).toContain(`height="${size}"`);
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("exposes an accessible name instead of hiding when a title is given", () => {
    const html = renderToStaticMarkup(<Icon name="x" size={16} title="Close" />);
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain("aria-hidden");
  });

  it("draws the selected state with a different weight than the resting state", () => {
    const resting = renderToStaticMarkup(<Icon name="gridFour" size={16} />);
    const selected = renderToStaticMarkup(<Icon name="gridFour" size={16} selected />);
    expect(selected).not.toBe(resting);
  });
});

describe("icon seam", () => {
  const files = sourceFiles();

  it("keeps inline <svg> to the allowlisted domain drawings", () => {
    const found = Object.fromEntries(
      files
        .filter(({ path }) => path.endsWith(".tsx"))
        .map(({ path, text }) => [path, text.split("<svg").length - 1] as const)
        .filter(([, count]) => count > 0),
    );
    expect(found).toEqual(DOMAIN_SVG_COUNT);
  });

  it("imports Phosphor only inside icons/", () => {
    const offenders = files
      .filter(({ text }) => text.includes("@phosphor-icons"))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("never picks a glyph weight outside icons/", () => {
    const offenders = files.filter(({ text }) => /\bweight=/.test(text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("uses the selected weight only in the allowlisted toggle files", () => {
    const offenders = files
      .filter(({ text }) => /<Icon\b[^>]*\bselected\b/.test(text))
      .map((f) => f.path);
    expect(offenders).toEqual(SELECTED_STATE_FILES);
  });
});
