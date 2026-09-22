/** Sanitize a figma-exported SVG before it touches disk (design spec §5). Lexical
 * tokenizer: strips script/style/foreignObject, on* handlers, non-local href/
 * xlink:href (any namespace prefix), and style= with url()/@import/expression()/javascript:.
 */

/** Apply a replacement until the output stops changing (defeats nesting). */
function replaceStable(input: string, pattern: RegExp, replacement: string): string {
  let out = input;
  let prev;
  do {
    prev = out;
    out = out.replace(pattern, replacement);
  } while (out !== prev);
  return out;
}

// Matches one opening/self-closing tag at a time, correctly skipping over
// `>` inside quoted attribute values so a value like `data:text/html,<x>`
// doesn't end the tag early. Closing tags (`</...>`) never match (the tag
// name must start right after `<`, not a `/`).
const TAG_RE = /<([a-zA-Z][\w:-]*)((?:[^"'>]|"[^"]*"|'[^']*')*)>/g;

// One attribute within a tag's attribute blob, in any of the three HTML
// quoting forms. Exactly one of the three value groups is defined per match.
const ATTR_RE = /([a-zA-Z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]*))/g;

/** The attribute's local name, ignoring any XML namespace prefix (`ns:name` -> `name`). */
function localName(name: string): string {
  const i = name.lastIndexOf(":");
  return (i === -1 ? name : name.slice(i + 1)).toLowerCase();
}

function isAllowedHref(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("#") || v.startsWith("data:image/");
}

function isDangerousStyle(value: string): boolean {
  const v = value.toLowerCase();
  return (
    v.includes("url(") ||
    v.includes("@import") ||
    v.includes("expression(") ||
    v.includes("javascript:")
  );
}

/** True if this attribute (any namespace prefix) must be dropped. */
function isDangerousAttr(name: string, value: string): boolean {
  const local = localName(name);
  if (local.startsWith("on")) return true;
  if (local === "href") return !isAllowedHref(value);
  if (local === "style") return isDangerousStyle(value);
  return false;
}

/** Rewrite every tag, dropping dangerous attributes by local name, not literal spelling. */
function sanitizeAttributes(svg: string): string {
  return svg.replace(TAG_RE, (tag, tagName: string, attrs: string) => {
    const kept = attrs.replace(ATTR_RE, (match, name: string, dq, sq, uq) => {
      const value = dq ?? sq ?? uq ?? "";
      return isDangerousAttr(name, value) ? "" : match;
    });
    return `<${tagName}${kept}>`;
  });
}

export function sanitizeSvg(svg: string): string {
  let out = svg;
  out = replaceStable(out, /<script\b[\s\S]*?<\/script\b[^>]*>/gi, "");
  out = replaceStable(out, /<script\b[^>]*\/>/gi, "");
  out = replaceStable(out, /<style\b[\s\S]*?<\/style\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[\s\S]*?<\/foreignObject\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[^>]*\/>/gi, "");
  // Nesting leaves inert orphan close tags after the stable pass — drop them.
  out = out.replace(/<\/(?:script|style|foreignObject)\b[^>]*>/gi, "");
  out = sanitizeAttributes(out);
  return out;
}
