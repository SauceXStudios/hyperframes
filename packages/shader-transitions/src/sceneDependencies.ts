const FILE_SIGNATURES_META = 'meta[name="hyperframes-file-signatures"]';
const URL_ATTRIBUTES = ["src", "href", "poster", "srcset"] as const;
const STYLE_URL_PATTERN = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"\s]+))\s*\)/g;

type FileSignatureMeta =
  | { kind: "none" }
  | { kind: "opaque"; raw: string }
  | { kind: "all"; all: string }
  | { kind: "files"; root: string; files: Record<string, string> };

function readFileSignatureMeta(doc: Document): FileSignatureMeta {
  const raw = doc.querySelector(FILE_SIGNATURES_META)?.getAttribute("content");
  if (raw === null || raw === undefined) return { kind: "none" };
  try {
    const parsed = JSON.parse(raw) as { root?: unknown; files?: unknown; all?: unknown };
    if (typeof parsed.all === "string") return { kind: "all", all: parsed.all };
    if (typeof parsed.root === "string" && parsed.files && typeof parsed.files === "object") {
      return { kind: "files", root: parsed.root, files: parsed.files as Record<string, string> };
    }
  } catch {
    // An unreadable payload still has to invalidate on change, so it folds in verbatim.
  }
  return { kind: "opaque", raw };
}

function attributeUrls(el: Element): string[] {
  return URL_ATTRIBUTES.flatMap((name) => {
    const value = el.getAttribute(name);
    if (!value) return [];
    if (name !== "srcset") return [value];
    return value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "");
  });
}

function styleUrls(el: Element): string[] {
  return Array.from(
    (el.getAttribute("style") ?? "").matchAll(STYLE_URL_PATTERN),
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

function collectRawUrls(scene: Element, doc: Document): string[] {
  const elements = [scene, ...Array.from(scene.querySelectorAll("*"))];
  const documentLoads = Array.from(doc.querySelectorAll("script[src], link[href]"));
  return [
    ...elements.flatMap((el) => [...attributeUrls(el), ...styleUrls(el)]),
    ...documentLoads.map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? ""),
  ];
}

function projectRelativePath(rawUrl: string, baseUri: string, root: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, baseUri);
  } catch {
    return null;
  }
  if (url.origin !== new URL(baseUri).origin || !url.pathname.startsWith(root)) return null;
  const relative = url.pathname.slice(root.length);
  try {
    return decodeURIComponent(relative);
  } catch {
    return relative;
  }
}

/**
 * Fingerprint of the project files a scene loads (its own src/href/poster/srcset/url()
 * references plus the document's scripts and stylesheets), from the host's
 * `hyperframes-file-signatures` meta. Empty when the host provides none.
 */
export function getSceneDependencySignature(scene: Element, doc: Document): string {
  const meta = readFileSignatureMeta(doc);
  if (meta.kind === "none") return "";
  if (meta.kind === "all") return `all:${meta.all}`;
  if (meta.kind === "opaque") return `opaque:${meta.raw}`;
  const deps = new Set<string>();
  for (const rawUrl of collectRawUrls(scene, doc)) {
    const path = projectRelativePath(rawUrl, doc.baseURI, meta.root);
    if (path === null) continue;
    if (path in meta.files) deps.add(`${path}:${meta.files[path]}`);
  }
  return Array.from(deps).sort().join("\n");
}
