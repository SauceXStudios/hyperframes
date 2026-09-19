// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDockLayoutStore, type DockController } from "../components/dock/dockLayoutStore";
import { PANEL_IDS, type PanelId } from "../components/dock/panelRegistry";
import {
  useBlockParamsDismissal,
  useCaptionDesignFocus,
  useRightPanelIntent,
  useSlideshowDockPanel,
} from "./useRightPanelIntents";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function controllerMock(): DockController {
  return {
    open: vi.fn(),
    activate: vi.fn(),
    close: vi.fn(),
    setTitle: vi.fn(),
    setGroupVisible: vi.fn(),
    reset: vi.fn(),
  };
}

function seed(state: {
  open?: PanelId[];
  visible?: PanelId[];
  lastActive?: Partial<Record<"left" | "center" | "right", PanelId>>;
}) {
  const controller = controllerMock();
  useDockLayoutStore.setState({
    controller,
    openPanels: new Set(state.open ?? PANEL_IDS.filter((id) => id !== "slideshow")),
    visiblePanels: new Set(state.visible ?? []),
    lastActive: state.lastActive ?? {},
    activePanel: null,
  });
  return controller;
}

function mountHook<P>(hook: (props: P) => unknown, initial: P) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let latest: unknown;
  function Harness({ props }: { props: P }) {
    latest = hook(props);
    return null;
  }
  const render = (props: P) => act(() => root.render(React.createElement(Harness, { props })));
  render(initial);
  return { render, value: () => latest, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  useDockLayoutStore.setState({ controller: null });
});

describe("useSlideshowDockPanel", () => {
  it("opens the panel when the file becomes a slideshow and closes it when it stops", () => {
    const controller = seed({});
    const view = mountHook(useSlideshowDockPanel, false);
    expect(controller.open).not.toHaveBeenCalled();
    view.render(true);
    expect(controller.open).toHaveBeenCalledWith("slideshow");
    act(() =>
      useDockLayoutStore.setState({ openPanels: new Set<PanelId>(["design", "slideshow"]) }),
    );
    view.render(false);
    expect(controller.close).toHaveBeenCalledWith("slideshow");
  });

  it("does not reopen a panel the user closed while the file is still a slideshow", () => {
    const controller = seed({});
    const view = mountHook(useSlideshowDockPanel, true);
    expect(controller.open).toHaveBeenCalledTimes(1);
    act(() => useDockLayoutStore.setState({ openPanels: new Set<PanelId>(["design"]) }));
    view.render(true);
    expect(controller.open).toHaveBeenCalledTimes(1);
  });
});

describe("useBlockParamsDismissal", () => {
  const props = { hasBlockParams: true, hasSelection: false, onDismiss: vi.fn() };

  it("dismisses block params when an element is selected", () => {
    seed({ visible: ["design"] });
    const onDismiss = vi.fn();
    const view = mountHook(useBlockParamsDismissal, { ...props, onDismiss });
    expect(onDismiss).not.toHaveBeenCalled();
    view.render({ ...props, onDismiss, hasSelection: true });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("dismisses block params when the Design panel is no longer showing", () => {
    seed({ visible: ["design"] });
    const onDismiss = vi.fn();
    mountHook(useBlockParamsDismissal, { ...props, onDismiss });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => useDockLayoutStore.setState({ visiblePanels: new Set<PanelId>(["layers"]) }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("useCaptionDesignFocus", () => {
  it("brings Design forward when caption editing starts over another right panel", () => {
    seed({ visible: ["layers"], lastActive: { right: "layers" } });
    const view = mountHook(useCaptionDesignFocus, false);
    const activate = vi.spyOn(useDockLayoutStore.getState(), "activatePanel");
    view.render(true);
    expect(activate).toHaveBeenCalledWith("design");
  });

  it("leaves a collapsed right column alone", () => {
    seed({ visible: [], lastActive: { right: "layers" } });
    const activate = vi.spyOn(useDockLayoutStore.getState(), "activatePanel");
    mountHook(useCaptionDesignFocus, true);
    expect(activate).not.toHaveBeenCalled();
  });
});

describe("useRightPanelIntent", () => {
  it("still names the inspector panel while the right column is collapsed", () => {
    seed({ visible: [], lastActive: { right: "design" } });
    const view = mountHook(useRightPanelIntent, undefined);
    expect(view.value()).toBe("design");
  });
});
