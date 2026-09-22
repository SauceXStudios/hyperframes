import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  entityFrom,
  titleMatches,
  thesvgMatch,
  githubOrgFor,
  faviconDomainFor,
  thesvgSearch,
  resetThesvgManifest,
  githubAvatarSearch,
  faviconSearch,
} from "./logo-provider.mjs";
import { getProviders, runProviders } from "./registry.mjs";

test("entityFrom strips filler words from the intent; --entity wins", () => {
  assert.equal(entityFrom("LinkedIn logo"), "linkedin");
  assert.equal(entityFrom("official Slack brand mark"), "slack");
  assert.equal(entityFrom("anything", "Notion"), "notion");
});

test("titleMatches ignores case, spacing, punctuation — and rejects lookalikes", () => {
  assert.ok(titleMatches("Next.js", "nextjs"));
  assert.ok(titleMatches("Coca-Cola", "coca cola"));
  assert.ok(!titleMatches("Slackware", "slack"));
});

// A slice of the real theSVG manifest shape (src/data/icons.json).
const ICONS = [
  {
    slug: "nextdotjs",
    title: "Next.js",
    aliases: [],
    collection: "brands",
    license: "CC0-1.0",
    variants: { default: "/icons/nextdotjs/default.svg", mono: "/icons/nextdotjs/mono.svg" },
  },
  {
    slug: "slack-badge",
    title: "Slack",
    aliases: [],
    collection: "auth-badges",
    variants: { default: "/icons/slack-badge/default.svg" },
  },
  {
    slug: "slack",
    title: "Slack",
    aliases: [],
    collection: "brands",
    variants: { default: "/icons/slack/default.svg", wordmark: "/icons/slack/wordmark.svg" },
  },
  {
    slug: "aws",
    title: "AWS",
    aliases: ["Amazon Web Services"],
    collection: "brands",
    license: "MIT",
    variants: { default: "/icons/aws/color.svg", mono: "/icons/aws/mono.svg" },
  },
  {
    slug: "coca-cola",
    title: "Coca-Cola",
    aliases: [],
    collection: "brands",
    variants: { default: "/icons/coca-cola/default.svg" },
  },
  {
    slug: "slackware",
    title: "Slackware",
    aliases: [],
    collection: "brands",
    variants: { default: "/icons/slackware/default.svg" },
  },
];

test("thesvgMatch finds entries by normalized slug, title, or alias", () => {
  assert.equal(thesvgMatch(ICONS, "nextjs").slug, "nextdotjs", "title Next.js ≡ nextjs");
  assert.equal(thesvgMatch(ICONS, "coca cola").slug, "coca-cola");
  assert.equal(thesvgMatch(ICONS, "amazon web services").slug, "aws", "alias hit");
  assert.equal(thesvgMatch(ICONS, "zzzbrand"), null);
});

test("thesvgMatch prefers the brand mark over an auth badge with the same title", () => {
  assert.equal(thesvgMatch(ICONS, "slack").slug, "slack");
});

test("thesvgMatch never returns a lookalike", () => {
  assert.equal(thesvgMatch(ICONS, "slackwa"), null);
  assert.equal(thesvgMatch(ICONS, ""), null);
});

test("github avatar tier never guesses an org", () => {
  assert.equal(githubOrgFor("slack"), "slackhq");
  assert.equal(githubOrgFor("heygen"), "heygen-com");
  assert.equal(githubOrgFor("some-random-startup"), null);
});

test("favicon domain defaults to <entity>.com with explicit overrides", () => {
  assert.equal(faviconDomainFor("cocacola"), "coca-cola.com");
  assert.equal(faviconDomainFor("stripe"), "stripe.com");
});

// --- async tiers, network mocked -------------------------------------------
// The 54-brand stress test is a manual snapshot; these pin the same behavior
// as CI gates: descriptor shape, alias retry, error→null fallthrough, the
// placeholder filter, and the real cascade order under a mocked network.

const json = (data) => new Response(JSON.stringify(data), { status: 200 });
const status = (code) => new Response(null, { status: code });
const bin = (n) => new Response(new Uint8Array(n), { status: 200 });

test("thesvgSearch returns a pinned CDN url for the default variant", async (t) => {
  resetThesvgManifest();
  t.mock.method(globalThis, "fetch", async () => json(ICONS));
  const res = await thesvgSearch("AWS logo", {});
  assert.match(
    res.url,
    /^https:\/\/cdn\.jsdelivr\.net\/gh\/glincker\/thesvg@[0-9a-f]{40}\/public\/icons\/aws\/color\.svg$/,
  );
  assert.equal(res.ext, ".svg");
  assert.equal(res.metadata.provider, "thesvg");
  assert.equal(res.metadata.provenance.slug, "aws");
  assert.deepEqual(res.metadata.provenance.variants, ["default", "mono"]);
});

test("thesvgSearch fetches the manifest once per process", async (t) => {
  resetThesvgManifest();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => json(ICONS));
  await thesvgSearch("slack logo", {});
  await thesvgSearch("nextjs logo", {});
  assert.equal(await thesvgSearch("zzzbrand logo", {}), null);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("thesvgSearch returns null when the network is down, then retries next call", async (t) => {
  resetThesvgManifest();
  let down = true;
  t.mock.method(globalThis, "fetch", async () => {
    if (down) throw new Error("network down");
    return json(ICONS);
  });
  assert.equal(await thesvgSearch("figma logo", {}), null);
  down = false;
  assert.equal((await thesvgSearch("slack logo", {})).metadata.provenance.slug, "slack");
});

test("thesvgSearch treats a non-array manifest as a miss", async (t) => {
  resetThesvgManifest();
  t.mock.method(globalThis, "fetch", async () => json({ error: "unexpected shape" }));
  assert.equal(await thesvgSearch("slack logo", {}), null);
});

test("faviconSearch rejects DDG's sub-500B placeholder with null", async (t) => {
  t.mock.method(globalThis, "fetch", async () => bin(120));
  assert.equal(await faviconSearch("someco logo", {}), null);
});

test("faviconSearch hands verified bytes over as a local file — one fetch, no re-download", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => bin(600));
  const res = await faviconSearch("someco logo", {});
  assert.ok(res.localPath, "returns a localPath, not a url");
  assert.equal(readFileSync(res.localPath).byteLength, 600, "frozen bytes are the verified bytes");
  assert.equal(fetchMock.mock.callCount(), 1, "single network round-trip");
  assert.equal(res.metadata.provenance.low_res, true);
});

test("githubAvatarSearch never touches the network for an unmapped entity", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => status(200));
  assert.equal(await githubAvatarSearch("some-random-startup logo", {}), null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("the real logo cascade resolves a theSVG brand on tier 1", async (t) => {
  resetThesvgManifest();
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("glincker/thesvg")) return json(ICONS);
    throw new Error(`unexpected fetch: ${url}`);
  });
  const res = await runProviders(getProviders("logo"), "search", "Next.js logo", {});
  assert.equal(res.metadata.provider, "thesvg");
  assert.ok(res.url.endsWith("/public/icons/nextdotjs/default.svg"));
});

test("the real logo cascade falls through tier by tier to the first hit", async (t) => {
  resetThesvgManifest();
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    if (u.includes("glincker/thesvg")) return json(ICONS); // tier 1: no entry
    // tier 2 (github) is never called: entity is unmapped
    if (u.includes("duckduckgo")) return bin(600); // tier 3: real favicon
    throw new Error(`unexpected fetch: ${u}`);
  });
  const res = await runProviders(getProviders("logo"), "search", "zzzbrand logo", {
    entity: "zzzbrand",
  });
  assert.ok(res, "cascade must land on the favicon tier");
  assert.equal(res.metadata.provider, "favicon.ddg");
});

test("githubAvatarSearch rejects private HEAD redirects", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    seen.push(url);
    assert.equal(options.method, "HEAD");
    assert.ok(options.signal);
    return options.redirect === "manual"
      ? new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
      : new Response(null, { status: 200 });
  });
  assert.equal(await githubAvatarSearch("vercel logo"), null);
  assert.equal(seen.length, 1);
  assert.ok(!seen[0].includes("127.0.0.1"));
});

test("thesvgSearch rejects a manifest redirect to a private host", async (t) => {
  resetThesvgManifest();
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    seen.push(url);
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  });
  assert.equal(await thesvgSearch("vercel logo"), null);
  assert.equal(seen.length, 1);
});
