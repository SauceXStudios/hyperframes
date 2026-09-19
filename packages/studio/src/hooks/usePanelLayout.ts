import { useCallback, useEffect, useRef } from "react";
import type { RightPanelTab } from "../utils/studioHelpers";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { useDockLayoutStore, visiblePanelInZone } from "../components/dock/dockLayoutStore";
import { PANEL_DEFINITIONS, type PanelId } from "../components/dock/panelRegistry";

export interface InitialPanelLayoutState {
  rightCollapsed?: boolean | null;
  rightPanelTab?: RightPanelTab | null;
}

/** The dock panel each legacy right-panel tab name opens; block params render inside Design. */
function panelForTab(tab: RightPanelTab): PanelId {
  return tab === "block-params" ? "design" : tab;
}

function tabForPanel(id: PanelId | null): RightPanelTab {
  return id !== null && PANEL_DEFINITIONS[id].zone === "right" ? (id as RightPanelTab) : "design";
}

/** The right column as the rest of Studio reads it, backed by the dock's panel state. */
export function usePanelLayout(initialState?: InitialPanelLayoutState) {
  const controller = useDockLayoutStore((state) => state.controller);
  const lastActive = useDockLayoutStore((state) => state.lastActive);
  const visiblePanels = useDockLayoutStore((state) => state.visiblePanels);

  const initialRef = useRef(initialState);
  useEffect(() => {
    if (!controller) return;
    const { rightCollapsed, rightPanelTab } = initialRef.current ?? {};
    initialRef.current = undefined;
    const store = useDockLayoutStore.getState();
    if (rightPanelTab && store.openPanels.has(panelForTab(rightPanelTab))) {
      store.activatePanel(panelForTab(rightPanelTab));
    }
    if (rightCollapsed != null) store.setZoneVisible("right", !rightCollapsed);
  }, [controller]);

  const visibleRight = visiblePanelInZone("right", lastActive, visiblePanels);
  const rightPanelTab = tabForPanel(visibleRight);
  const rightCollapsed = visibleRight === null;

  const setRightPanelTab = useCallback((tab: RightPanelTab) => {
    useDockLayoutStore.getState().activatePanel(panelForTab(tab));
    trackStudioEvent("tab_switch", { panel: "right_panel", tab });
  }, []);

  const setRightCollapsed = useCallback((collapsed: boolean) => {
    const store = useDockLayoutStore.getState();
    if (!collapsed && visiblePanelInZone("right", store.lastActive, store.visiblePanels) === null) {
      store.activatePanel("design");
      return;
    }
    store.setZoneVisible("right", !collapsed);
  }, []);

  return { rightCollapsed, setRightCollapsed, rightPanelTab, setRightPanelTab };
}
