// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { getSceneSignature } from "./hyper-shader.js";

const ROOT = "/api/projects/demo/preview/";

function setMeta(payload: object): void {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "hyperframes-file-signatures");
  meta.setAttribute("content", JSON.stringify({ root: ROOT, ...payload }));
  document.head.append(meta);
}

function setup(files: Record<string, string> | { all: string }): void {
  document.head.innerHTML = `<base href="${ROOT}"><script type="text/plain" src="js/app.js"></script>`;
  document.body.innerHTML = `
    <div id="a"><img src="img/a.png"><video src="media/a.mp4"></video></div>
    <div id="b"><div style="background: url('img/b.png')"></div></div>`;
  setMeta("all" in files ? files : { files });
}

const BASE = {
  "js/app.js": "1",
  "img/a.png": "1",
  "media/a.mp4": "1",
  "img/b.png": "1",
  "x.html": "1",
};

beforeEach(() => {
  window.happyDOM.setURL(`http://localhost${ROOT}`);
});

describe("scene cache key dependencies", () => {
  it("ignores a change to a file no scene loads", () => {
    setup(BASE);
    const before = [getSceneSignature("a"), getSceneSignature("b")];
    setup({ ...BASE, "x.html": "2" });
    expect([getSceneSignature("a"), getSceneSignature("b")]).toEqual(before);
  });

  it("changes only the scene that loads the edited file", () => {
    setup(BASE);
    const [a, b] = [getSceneSignature("a"), getSceneSignature("b")];
    setup({ ...BASE, "media/a.mp4": "2" });
    expect(getSceneSignature("a")).not.toBe(a);
    expect(getSceneSignature("b")).toBe(b);
    setup({ ...BASE, "img/b.png": "2" });
    expect(getSceneSignature("b")).not.toBe(b);
  });

  it("changes every scene when a document script file changes", () => {
    setup(BASE);
    const [a, b] = [getSceneSignature("a"), getSceneSignature("b")];
    setup({ ...BASE, "js/app.js": "2" });
    expect(getSceneSignature("a")).not.toBe(a);
    expect(getSceneSignature("b")).not.toBe(b);
  });

  it("changes when a referenced file is deleted", () => {
    setup(BASE);
    const a = getSceneSignature("a");
    const { "img/a.png": _gone, ...rest } = BASE;
    setup(rest);
    expect(getSceneSignature("a")).not.toBe(a);
  });

  it("changes on any file change in the whole-project fallback", () => {
    setup({ all: "sig1" });
    const a = getSceneSignature("a");
    setup({ all: "sig2" });
    expect(getSceneSignature("a")).not.toBe(a);
  });
});
