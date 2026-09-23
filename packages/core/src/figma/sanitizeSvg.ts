/** Sanitize a figma-exported SVG before it touches disk (design spec §5). DOM-walk allowlist
 * (linkedom): unknown elements and attributes are dropped by default rather than pattern-matched
 * as dangerous, so a new SVG feature can't reopen a class of bug the way regex denylisting did.
 */
import { DOMParser } from "linkedom";

const SAFE_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "image",
  "a",
  "switch",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "textPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "mask",
  "clipPath",
  "marker",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "title",
  "desc",
  "metadata",
  "style",
]);

// Local names only — a namespace prefix (xlink:href, x:href, ...) is stripped before this
// lookup, so it doesn't matter which prefix an attacker aliases onto a real or fake namespace.
const SAFE_ATTRIBUTES = new Set([
  "id",
  "class",
  "style",
  "transform",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "points",
  "d",
  "offset",
  "enable-background",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "maskUnits",
  "maskContentUnits",
  "clipPathUnits",
  "clip-rule",
  "filterUnits",
  "primitiveUnits",
  "preserveAspectRatio",
  "space",
  "lang",
  "role",
  "focusable",
  "tabindex",
  "version",
  "baseProfile",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "color",
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "letter-spacing",
  "word-spacing",
  "text-decoration",
  "clip-path",
  "mask",
  "filter",
  "marker-start",
  "marker-mid",
  "marker-end",
  "marker",
  "cursor",
  "pointer-events",
  "visibility",
  "display",
  "overflow",
  "vector-effect",
  "paint-order",
  "color-interpolation",
  "color-interpolation-filters",
  "isolation",
  "mix-blend-mode",
  "startOffset",
  "method",
  "spacing",
  "side",
  "textLength",
  "lengthAdjust",
  "in",
  "in2",
  "result",
  "mode",
  "type",
  "values",
  "dx",
  "dy",
  "stdDeviation",
  "edgeMode",
  "k1",
  "k2",
  "k3",
  "k4",
  "operator",
  "radius",
  "scale",
  "xChannelSelector",
  "yChannelSelector",
  "baseFrequency",
  "numOctaves",
  "seed",
  "stitchTiles",
  "tableValues",
  "slope",
  "intercept",
  "amplitude",
  "exponent",
  "order",
  "divisor",
  "bias",
  "targetX",
  "targetY",
  "kernelMatrix",
  "preserveAlpha",
  "kernelUnitLength",
  "surfaceScale",
  "diffuseConstant",
  "specularConstant",
  "specularExponent",
  "lighting-color",
  "flood-color",
  "flood-opacity",
  "azimuth",
  "elevation",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "limitingConeAngle",
]);

function localName(name: string): string {
  const i = name.lastIndexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

/** href/xlink:href (any prefix): a same-document fragment always, `data:image/` only off `<a>`
 * (an `<a>` navigates the top-level document on click; `<use>`/`<image>`/`<feImage>` only fetch
 * it as an inert image resource). */
function isAllowedHref(value: string, tagLocalName: string): boolean {
  const v = value.trim();
  if (v.startsWith("#")) return true;
  return /^data:image\//i.test(v) && tagLocalName.toLowerCase() !== "a";
}

/** Every `url(...)` in the value must resolve to a same-document fragment — kept for
 * presentation attributes (fill, filter, mask, clip-path, marker-*, ...) and `style=` alike, so
 * a new url()-bearing attribute doesn't need its own carve-out to be covered. */
function everyUrlIsLocalFragment(value: string): boolean {
  const rawCount = (value.match(/url\(/gi) || []).length;
  if (rawCount === 0) return true;
  const URL_RE = /url\(\s*(['"]?)([^)]*)\1\s*\)/gi;
  let matched = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(value))) {
    matched++;
    if (!(m[2] ?? "").trim().startsWith("#")) return false;
  }
  return matched === rawCount;
}

function hasDangerousStyleToken(value: string): boolean {
  const v = value.toLowerCase();
  return v.includes("@import") || v.includes("expression(") || v.includes("javascript:");
}

function isXmlnsAttribute(name: string): boolean {
  return name === "xmlns" || name.startsWith("xmlns:");
}

// aria-*/data-* are inert key/value pairs everywhere else; still url()-checked below,
// defensively, rather than trusted just because no browser resolves url() from them today.
function isKnownAttribute(local: string): boolean {
  return SAFE_ATTRIBUTES.has(local) || local.startsWith("aria-") || local.startsWith("data-");
}

function isSafeAttribute(tagLocalName: string, name: string, value: string): boolean {
  if (isXmlnsAttribute(name)) return true;
  const local = localName(name);
  if (local === "href") return isAllowedHref(value, tagLocalName);
  if (!isKnownAttribute(local)) return false;
  if (!everyUrlIsLocalFragment(value)) return false;
  if (local === "style" && hasDangerousStyleToken(value)) return false;
  return true;
}

function isSafeStyleText(text: string): boolean {
  return everyUrlIsLocalFragment(text) && !hasDangerousStyleToken(text);
}

export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root) return "";

  for (const el of [...doc.querySelectorAll("*")]) {
    if (!el.isConnected) continue;
    if (!SAFE_ELEMENTS.has(el.tagName)) {
      el.remove();
      continue;
    }
    if (el.tagName === "style" && !isSafeStyleText(el.textContent)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      if (!isSafeAttribute(el.tagName, attr.name, attr.value)) el.removeAttribute(attr.name);
    }
  }
  return root.isConnected ? root.outerHTML : "";
}
