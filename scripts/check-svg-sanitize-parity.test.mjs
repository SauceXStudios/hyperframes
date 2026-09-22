import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitizeSvg as coreSanitizeSvg } from "../packages/core/src/figma/sanitizeSvg.ts";
import { sanitizeSvg as mediaUseSanitizeSvg } from "../packages/cli/src/media-use/lib/svg-sanitize.mjs";

// media-use/lib/svg-sanitize.mjs is a hand-kept port of
// packages/core/src/figma/sanitizeSvg.ts (media-use's test lane forbids
// workspace imports). This corpus is the trip wire: if either changes
// without the other, one of these cases stops matching.
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
  ['<svg><a href="data:image/png;base64,AA=="><rect/></a></svg>', "allowed data:image/ href"],
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
  // Reported against b7ace99b4 — see hyperframes-4291-b7ace99b.md BLOCKER 1-3.
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
];

describe("svg-sanitize parity: core vs media-use port", () => {
  for (const [input, label] of HOSTILE_CORPUS) {
    it(`matches core output for: ${label}`, () => {
      assert.equal(mediaUseSanitizeSvg(input), coreSanitizeSvg(input));
    });
  }

  it("both strip every hostile marker from the full corpus", () => {
    for (const [input] of HOSTILE_CORPUS) {
      const out = mediaUseSanitizeSvg(input);
      assert.ok(!/<script\b/i.test(out), `<script survived: ${input}`);
      assert.ok(!/<foreignObject\b/i.test(out), `<foreignObject survived: ${input}`);
      assert.ok(!/\son\w+\s*=/i.test(out), `on* handler survived: ${input}`);
      assert.ok(!/javascript:/i.test(out), `javascript: href survived: ${input}`);
    }
  });
});
