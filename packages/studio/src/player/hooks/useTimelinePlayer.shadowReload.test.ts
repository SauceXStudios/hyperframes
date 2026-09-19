// @vitest-environment happy-dom
//
// AD132/D-801: a full-reload edit (lane-move drop) must never show a blank
// preview frame. This drives the real refreshPlayer -> shadow-load ->
// promoteShadowToLive orchestration through useTimelinePlayer exactly as
// NLEContext/NLEPreview call it, and asserts the previously-visible iframe
// is never hidden or removed until the replacement has signaled it painted.

import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelinePlayer } from "./useTimelinePlayer";
import { usePlayerStore } from "../store/playerStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function resetPlayerStore() {
  usePlayerStore.getState().reset();
  usePlayerStore.setState({ requestedSeekTime: null });
}

function TimelinePlayerHarness({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useTimelinePlayer>) => void;
}) {
  const value = useTimelinePlayer();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

function renderTimelinePlayerHarness() {
  // Fields backed by a ref (iframeRef) stay live on a stale snapshot because
  // the ref object itself is stable; plain values (previewSlots) are not —
  // reading them after a state update requires re-fetching via getApi(),
  // never a destructured one-time snapshot of the hook's return value.
  let latest: ReturnType<typeof useTimelinePlayer> | null = null;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      React.createElement(TimelinePlayerHarness, { onValue: (value) => (latest = value) }),
    );
  });

  if (!latest) throw new Error("useTimelinePlayer did not mount");
  return { getApi: () => latest as ReturnType<typeof useTimelinePlayer>, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
});

function makeFakeAdapterWindow(duration: number): Record<string, unknown> {
  let currentTime = 0;
  let playing = false;
  return {
    __player: {
      play: vi.fn(() => {
        playing = true;
      }),
      pause: vi.fn(() => {
        playing = false;
      }),
      seek: (time: number) => {
        currentTime = time;
      },
      getTime: () => currentTime,
      getDuration: () => duration,
      isPlaying: () => playing,
    },
    postMessage: () => {},
    scrollTo: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

function makeFakeIframe(duration: number): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  Object.defineProperty(iframe, "contentWindow", {
    value: makeFakeAdapterWindow(duration),
    configurable: true,
  });
  Object.defineProperty(iframe, "contentDocument", {
    value: document.implementation.createHTMLDocument("preview"),
    configurable: true,
  });
  iframe.src = "http://localhost/api/projects/demo/preview";
  return iframe;
}

describe("useTimelinePlayer shadow reload (AD132/D-801)", () => {
  it("never hides or removes the live iframe before the shadow signals it has painted", () => {
    const { getApi, root } = renderTimelinePlayerHarness();
    const liveIframe = makeFakeIframe(30);

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
    const shadowIframe = makeFakeIframe(30);
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
    const liveIframe = makeFakeIframe(30);
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
    const firstShadowIframe = makeFakeIframe(30);
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

function unmount(root: ReturnType<typeof createRoot>) {
  act(() => {
    root.unmount();
  });
}
