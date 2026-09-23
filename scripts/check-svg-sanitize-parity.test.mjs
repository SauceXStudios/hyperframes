import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeSvg as coreSanitizeSvg } from "../packages/core/src/figma/sanitizeSvg.ts";
import { sanitizeSvg as mediaUseSanitizeSvg } from "../packages/cli/src/media-use/lib/svg-sanitize.mjs";

// svg-sanitize.mjs is generated from sanitizeSvg.ts (see check-media-use-svg-sanitize-generated
// for the drift check). This is the behavioral trip wire: both copies must independently
// neutralize and agree on every payload, so a bad regeneration can't silently reopen a bypass.
const HOSTILE_CORPUS = [
  ["<svg><script>alert(1)</script><rect/></svg>", "script element"],
  ['<svg><script src="//evil"/></svg>', "self-closing script"],
  ['<svg><style>@import "//evil";</style></svg>', "style block"],
  ['<svg><foreignObject><body onload="alert(1)"/></foreignObject></svg>', "foreignObject subtree"],
  ["<svg><foreignObject/></svg>", "self-closing foreignObject"],
  ['<svg><rect onload="alert(1)"/></svg>', "quoted on* handler"],
  [`<svg><rect onload='alert(1)'/></svg>`, "single-quoted on* handler"],
  ["<svg><rect onload=alert(1)/></svg>", "unquoted on* handler"],
  ['<svg><a href="javascript:alert(1)"><rect/></a></svg>', "javascript: href"],
  ['<svg><a xlink:href="javascript:alert(1)"><rect/></a></svg>', "javascript: xlink:href"],
  [
    '<svg><a href="data:image/png;base64,AA=="><rect/></a></svg>',
    "data:image/ href on <a> (still navigable, dropped)",
  ],
  ['<svg><use href="data:image/png;base64,AA=="/></svg>', "allowed data:image/ href on non-<a>"],
  ['<svg><a href="#clip"><rect/></a></svg>', "allowed local fragment href"],
  ['<svg><a href="data:text/html,<script>1</script>"><rect/></a></svg>', "data:text/html href"],
  [
    "<svg><script>a</script><script>/*<script>*/nested()</script></svg>",
    "nested/overlapping script tags",
  ],
  [
    "<svg><foreignObject><foreignObject><script>1</script></foreignObject></foreignObject></svg>",
    "nested foreignObject",
  ],
  [
    '<svg xmlns="http://www.w3.org/2000/svg"><svg><rect onclick="a"/></svg></svg>',
    "nested svg element",
  ],
  ["<svg><rect onMouseOver=\"alert('x')\" ONCLICK='y'/></svg>", "mixed-case on* handler names"],
  ['<svg><a HREF="javascript:alert(1)"><rect/></a></svg>', "mixed-case href attribute name"],
  ["<svg><a href=javascript:alert(1)><rect/></a></svg>", "unquoted javascript: href"],
  ["<svg><use href=https://evil.example/x.svg#p/></svg>", "unquoted external use href"],
  ['<svg><rect style="fill:url(https://evil.example/x)"/></svg>', "style url() exfil"],
  ['<svg><rect style="background:@import url(evil)"/></svg>', "style @import exfil"],
  ['<svg><rect style="width:expression(alert(1))"/></svg>', "style expression() exfil"],
  [`<svg><rect style="background:url('javascript:alert(1)')"/></svg>`, "style javascript: exfil"],
  ['<svg><rect style="fill:#123456"/></svg>', "benign style attribute survives"],
  [
    '<svg><path clip-path="url(#clip0)" fill="url(#grad)"/></svg>',
    "url(#id) on non-style attrs survives",
  ],
  [
    '<svg xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil.example/x.svg#p"/></svg>',
    "href via a renamed xlink namespace prefix",
  ],
  ['<svg><rect fill="url(https://evil.example/x.svg#p)"/></svg>', "fill url() exfil"],
  ['<svg><rect filter="url(https://evil.example/x.svg#f)"/></svg>', "filter url() exfil"],
  ['<svg><rect mask="url(https://evil.example/x.svg#m)"/></svg>', "mask url() exfil"],
  ['<svg><rect clip-path="url(https://evil.example/x.svg#c)"/></svg>', "clip-path url() exfil"],
  [
    '<svg><path marker-start="url(https://evil.example/x.svg#m)"/></svg>',
    "marker-start url() exfil",
  ],
  [
    "<svg><rect style=x=y;fill:url(https://evil.example/beacon)>r</rect></svg>",
    "unquoted attribute value containing '='",
  ],
  [
    '<svg><a href="#a"><animate attributeName="href" to="javascript:alert(1)"/></a></svg>',
    "SMIL <animate> rewrites href to javascript:",
  ],
  [
    '<svg><a href="#a"><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
    "SMIL <set> rewrites href to javascript:",
  ],
  [
    '<svg><a href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+">click</a></svg>',
    "data:image/svg+xml navigation on <a>",
  ],
];

describe("svg-sanitize parity: core vs media-use (generated) port", () => {
  for (const [input, label] of HOSTILE_CORPUS) {
    it(`matches core output for: ${label}`, () => {
      assert.equal(mediaUseSanitizeSvg(input), coreSanitizeSvg(input));
    });
  }

  it("both copies independently reject every unsafe marker in the corpus", () => {
    const failures = [];
    for (const [input, label] of HOSTILE_CORPUS) {
      for (const [name, sanitize] of [
        ["core", coreSanitizeSvg],
        ["media-use", mediaUseSanitizeSvg],
      ]) {
        const out = sanitize(input);
        if (/<script\b/i.test(out)) failures.push(`${name}/${label}: <script survived`);
        if (/<foreignobject\b/i.test(out))
          failures.push(`${name}/${label}: <foreignObject survived`);
        if (/\son\w+\s*=/i.test(out)) failures.push(`${name}/${label}: on* handler survived`);
        if (/javascript:/i.test(out)) failures.push(`${name}/${label}: javascript: survived`);
        if (/data:image/i.test(out) && /<a[\s>]/i.test(out)) {
          failures.push(`${name}/${label}: data:image href survived on <a>`);
        }
        const urlMatches = [...out.matchAll(/url\(\s*(['"]?)([^)]*)\1\s*\)/gi)];
        for (const m of urlMatches) {
          if (!m[2].trim().startsWith("#"))
            failures.push(`${name}/${label}: non-local url(${m[2]}) survived`);
        }
      }
    }
    assert.deepEqual(failures, []);
  });
});
