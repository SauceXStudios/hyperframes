import { useEffect, useRef } from "react";
import { useDockLayoutStore, visiblePanelInZone } from "../components/dock/dockLayoutStore";

/** Opens the Slideshow panel when the file becomes a slideshow and closes it when it stops being one; a user's own close sticks. */
export function useSlideshowDockPanel(isSlideshowComposition: boolean) {
  const controller = useDockLayoutStore((state) => state.controller);
  useEffect(() => {
    if (!controller) return;
    const inDock = useDockLayoutStore.getState().openPanels.has("slideshow");
    if (isSlideshowComposition && !inDock) controller.open("slideshow");
    if (!isSlideshowComposition && inDock) controller.close("slideshow");
  }, [isSlideshowComposition, controller]);
}

/** Block params replace the Design body until a different element is picked or Design stops showing. */
export function useBlockParamsDismissal({
  hasBlockParams,
  selection,
  onDismiss,
}: {
  hasBlockParams: boolean;
  selection: unknown;
  onDismiss: () => void;
}) {
  const designVisible = useDockLayoutStore((state) => state.visiblePanels.has("design"));
  const selectionWhenOpened = useRef(selection);
  useEffect(() => {
    if (!hasBlockParams) selectionWhenOpened.current = selection;
  }, [hasBlockParams, selection]);
  useEffect(() => {
    const picked = selection != null && selection !== selectionWhenOpened.current;
    if (hasBlockParams && (picked || !designVisible)) onDismiss();
  }, [hasBlockParams, selection, designVisible, onDismiss]);
}

/** Caption edit mode owns the Design panel: whenever the right column shows something else, bring Design back. */
export function useCaptionDesignFocus(captionEditMode: boolean) {
  const designVisible = useDockLayoutStore((state) => state.visiblePanels.has("design"));
  const rightShown = useDockLayoutStore(
    (state) => visiblePanelInZone("right", state.lastActive, state.visiblePanels) !== null,
  );
  useEffect(() => {
    if (captionEditMode && rightShown && !designVisible) {
      useDockLayoutStore.getState().activatePanel("design");
    }
  }, [captionEditMode, rightShown, designVisible]);
}

/** The right-column panel the user last focused, whether or not the column is currently showing. */
export function useRightPanelIntent() {
  return useDockLayoutStore((state) =>
    visiblePanelInZone("right", state.lastActive, state.openPanels),
  );
}
