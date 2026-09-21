import { afterEach, describe, expect, it, vi } from "vitest";

const readinessCalls = vi.hoisted(() => [] as Array<{ scope?: string }>);

vi.mock("../compositionReadiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../compositionReadiness")>();
  return {
    ...actual,
    settleCompositionReadiness: (
      _doc: Document,
      onSettled: (result: { timedOut: boolean }) => void,
      options: { scope?: string },
    ) => {
      readinessCalls.push(options);
      onSettled({ timedOut: false });
    },
  };
});

import { initSandboxRuntimeModular } from "./init.js";

describe("runtime readiness callsite", () => {
  afterEach(() => {
    window.__hfRuntimeTeardown?.();
    document.body.innerHTML = "";
    readinessCalls.length = 0;
  });

  it("passes the shared first-frame scope to composition readiness", () => {
    document.body.innerHTML = '<div data-composition-id="main" data-root="true"></div>';

    initSandboxRuntimeModular();

    expect(readinessCalls.at(-1)).toEqual({ scope: "first-frame" });
  });
});
