import { describe, expect, it, vi } from "vitest";

const readinessCalls = vi.hoisted(() => [] as Array<{ scope?: string }>);

vi.mock("@hyperframes/core/composition-readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/core/composition-readiness")>();
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

import { HyperframesPlayer } from "./hyperframes-player.js";

describe("HyperframesPlayer readiness callsite", () => {
  it("passes the shared first-frame scope to composition readiness", () => {
    const player = new HyperframesPlayer() as HyperframesPlayer & {
      _waitForAssetsReady(doc: Document): void;
    };
    const doc = document.implementation.createHTMLDocument("composition");

    player._waitForAssetsReady(doc);

    expect(readinessCalls.at(-1)).toEqual({ scope: "first-frame", timeoutMs: 8_000 });
  });
});
