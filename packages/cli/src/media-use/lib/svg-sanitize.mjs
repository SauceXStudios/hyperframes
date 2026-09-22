// Port of packages/core/src/figma/sanitizeSvg.ts; parity enforced by scripts/check-svg-sanitize-parity.test.mjs.

function replaceStable(input, pattern, replacement) {
  let out = input;
  let prev;
  do {
    prev = out;
    out = out.replace(pattern, replacement);
  } while (out !== prev);
  return out;
}

const TAG_RE = /<([a-zA-Z][\w:-]*)((?:[^"'>]|"[^"]*"|'[^']*')*)>/g;
const ATTR_RE = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*))/g;

function localName(name) {
  const i = name.lastIndexOf(":");
  return (i === -1 ? name : name.slice(i + 1)).toLowerCase();
}

function isAllowedHref(value) {
  const v = value.trim().toLowerCase();
  return v.startsWith("#") || v.startsWith("data:image/");
}

function isDangerousStyle(value) {
  const v = value.toLowerCase();
  return (
    v.includes("url(") ||
    v.includes("@import") ||
    v.includes("expression(") ||
    v.includes("javascript:")
  );
}

function isDangerousAttr(name, value) {
  const local = localName(name);
  if (local.startsWith("on")) return true;
  if (local === "href") return !isAllowedHref(value);
  if (local === "style") return isDangerousStyle(value);
  return false;
}

function sanitizeAttributes(svg) {
  return svg.replace(TAG_RE, (tag, tagName, attrs) => {
    const kept = attrs.replace(ATTR_RE, (match, name, dq, sq, uq) => {
      const value = dq ?? sq ?? uq ?? "";
      return isDangerousAttr(name, value) ? "" : match;
    });
    return `<${tagName}${kept}>`;
  });
}

export function sanitizeSvg(svg) {
  let out = svg;
  out = replaceStable(out, /<script\b[\s\S]*?<\/script\b[^>]*>/gi, "");
  out = replaceStable(out, /<script\b[^>]*\/>/gi, "");
  out = replaceStable(out, /<style\b[\s\S]*?<\/style\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[\s\S]*?<\/foreignObject\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[^>]*\/>/gi, "");
  out = out.replace(/<\/(?:script|style|foreignObject)\b[^>]*>/gi, "");
  out = sanitizeAttributes(out);
  return out;
}
