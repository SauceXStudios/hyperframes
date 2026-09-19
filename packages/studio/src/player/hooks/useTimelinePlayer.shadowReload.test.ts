// @vitest-environment happy-dom
// A full-reload edit must never hide the live iframe until the shadow has painted.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NLEProvider, useNLEContext, type NLEContextValue } from "../../components/nle/NLEContext";
import {
  makeAdapterWindow,
  makeFakeIframe,
  renderTimelinePlayerHarness,
  resetPlayerStore,
} from "./timelinePlayerTestHarness";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
});

function makeLiveIframe(): HTMLIFrameElement {
  const iframe = makeFakeIframe(makeAdapterWindow().win);
  iframe.src = "http://localhost/api/projects/demo/preview";
  return iframe;
}

describe("useTimelinePlayer shadow reload (AD132/D-801)", () => {
  it("never hides or removes the live iframe before the shadow signals it has painted", () => {
    const { getApi, root } = renderTimelinePlayerHarness();
    const liveIframe = makeLiveIframe();

    act(() => {
      getApi().iframeRef.current = liveIframe;
      getApi().onIframeLoad();
    });

    expect(getApi().previewSlots).toEqual([{ gen: 0, role: "live" }]);
    expect(liveIframe.style.visibility).toBe("");

    // A lane-move drop persists, then bumps refreshKey -> refreshPlayer().
    act(() => {
      getApi().refreshPlayer();
    });

    // The live iframe must be untouched: still the ref target, still visible,
    // still in the slot list as "live". A shadow slot appears alongside it —
    // this is the queued background reload, not a swap.
    expect(getApi().iframeRef.current).toBe(liveIframe);
    expect(liveIframe.style.visibility).toBe("");
    expect(getApi().previewSlots).toHaveLength(2);
    const liveSlot = getApi().previewSlots.find((s) => s.role === "live");
    const shadowSlot = getApi().previewSlots.find((s) => s.role === "shadow");
    expect(liveSlot).toEqual({ gen: 0, role: "live" });
    expect(shadowSlot?.role).toBe("shadow");
    expect(shadowSlot?.url).toBeTruthy();

    // The shadow iframe loads and its restore-seek finds a ready adapter —
    // the readiness signal this whole mechanism hangs off.
    const shadowIframe = makeLiveIframe();
    act(() => {
      getApi().setShadowIframeNode(shadowIframe);
    });

    // Still untouched right up to the instant before the ready signal.
    expect(getApi().iframeRef.current).toBe(liveIframe);
    expect(liveIframe.style.visibility).toBe("");

    act(() => {
      getApi().onShadowIframeLoad(shadowSlot!.gen);
    });

    // Promotion: a single atomic swap. Exactly one live slot, pointing at the
    // shadow's iframe; the old live slot is gone, not merely hidden.
    expect(getApi().previewSlots).toEqual([
      { gen: shadowSlot!.gen, role: "live", url: shadowSlot!.url },
    ]);
    expect(getApi().iframeRef.current).toBe(shadowIframe);

    unmount(root);
  });

  it("replaces a superseded shadow rather than accumulating extra slots (repeated lane-moves)", () => {
    const { getApi, root } = renderTimelinePlayerHarness();
    const liveIframe = makeLiveIframe();
    act(() => {
      getApi().iframeRef.current = liveIframe;
      getApi().onIframeLoad();
    });

    act(() => {
      getApi().refreshPlayer();
    });
    const firstShadowGen = getApi().previewSlots.find((s) => s.role === "shadow")?.gen;
    expect(firstShadowGen).toBeDefined();

    // The first shadow's iframe finishes loading and is fully adapter-ready
    // (a real "would have painted correctly" candidate) before it is
    // superseded.
    const firstShadowIframe = makeLiveIframe();
    act(() => {
      getApi().setShadowIframeNode(firstShadowIframe);
    });

    // A second edit lands before the first shadow's readiness was consumed.
    act(() => {
      getApi().refreshPlayer();
    });

    // Never more than one extra (shadow) slot alive at a time.
    expect(getApi().previewSlots).toHaveLength(2);
    const secondShadow = getApi().previewSlots.find((s) => s.role === "shadow");
    expect(secondShadow?.gen).not.toBe(firstShadowGen);

    // The first shadow's readiness signal now arrives late (its own iframe is
    // still referenced, fully ready). It must NOT promote — that content was
    // replaced before it ever painted, and gen no longer matches the current
    // pending shadow.
    act(() => {
      getApi().onShadowIframeLoad(firstShadowGen!);
    });
    expect(getApi().previewSlots.find((s) => s.role === "live")).toEqual({ gen: 0, role: "live" });
    expect(getApi().iframeRef.current).toBe(liveIframe);

    unmount(root);
  });
});

describe("drop that removes a covered clip (reloadPreview -> refreshKey bump)", () => {
  it("swaps in the reloaded document without ever hiding the live iframe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    let ctx: NLEContextValue | null = null;
    const Probe = () => {
      ctx = useNLEContext();
      return null;
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (refreshKey: number) =>
      act(async () => {
        root.render(
          React.createElement(
            NLEProvider,
            { projectId: "demo", refreshKey },
            React.createElement(Probe),
          ),
        );
        await Promise.resolve();
      });
    await render(0);
    const live = makeLiveIframe();
    await act(async () => {
      ctx!.iframeRef.current = live;
      ctx!.onIframeLoad();
    });

    // runPlacementSteps ends in exactly one reloadPreview: App bumps refreshKey.
    await render(1);
    expect(live.style.visibility).toBe("");
    expect(ctx!.iframeRef.current).toBe(live);
    const shadow = ctx!.previewSlots.find((s) => s.role === "shadow");
    expect(shadow).toBeDefined();
    expect(ctx!.previewSlots).toHaveLength(2);

    const shadowIframe = makeLiveIframe();
    await act(async () => {
      ctx!.setShadowIframeNode(shadowIframe);
      ctx!.onShadowIframeLoad(shadow!.gen);
    });
    expect(ctx!.previewSlots).toEqual([{ ...shadow!, role: "live" }]);
    expect(ctx!.iframeRef.current).toBe(shadowIframe);

    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

function unmount(root: ReturnType<typeof createRoot>) {
  act(() => {
    root.unmount();
  });
}
