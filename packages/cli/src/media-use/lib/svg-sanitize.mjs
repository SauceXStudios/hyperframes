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

function isAllowedHref(value) {
  const v = value.trim().toLowerCase();
  return v.startsWith("#") || v.startsWith("data:image/");
}

export function sanitizeSvg(svg) {
  let out = svg;
  out = replaceStable(out, /<script\b[\s\S]*?<\/script\b[^>]*>/gi, "");
  out = replaceStable(out, /<script\b[^>]*\/>/gi, "");
  out = replaceStable(out, /<style\b[\s\S]*?<\/style\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[\s\S]*?<\/foreignObject\b[^>]*>/gi, "");
  out = replaceStable(out, /<foreignObject\b[^>]*\/>/gi, "");
  out = out.replace(/<\/(?:script|style|foreignObject)\b[^>]*>/gi, "");
  out = replaceStable(out, /\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = replaceStable(out, /\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = replaceStable(out, /\son[a-z]+\s*=\s*[^\s>'"]+/gi, "");
  out = out.replace(/\s(href|xlink:href)\s*=\s*"([^"]*)"/gi, (m, _attr, value) =>
    isAllowedHref(value) ? m : "",
  );
  out = out.replace(/\s(href|xlink:href)\s*=\s*'([^']*)'/gi, (m, _attr, value) =>
    isAllowedHref(value) ? m : "",
  );
  return out;
}
