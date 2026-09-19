import { useEffect } from "react";
import { useDockLayoutStore, visiblePanelInZone } from "../components/dock/dockLayoutStore";

/** Opens the Slideshow panel when the file becomes a slideshow and closes it when it stops being one; a user's own close sticks. */
export function useSlideshowDockPanel(isSlideshowComposition: boolean) {
  useEffect(() => {
    const { controller, openPanels } = useDockLayoutStore.getState();
    const inDock = openPanels.has("slideshow");
    if (isSlideshowComposition && !inDock) controller?.open("slideshow");
    if (!isSlideshowComposition && inDock) controller?.close("slideshow");
  }, [isSlideshowComposition]);
}

/** Block params replace the Design body only until something else takes the user's attention. */
export function useBlockParamsDismissal({
  hasBlockParams,
  hasSelection,
  onDismiss,
}: {
  hasBlockParams: boolean;
  hasSelection: boolean;
  onDismiss?: () => void;
}) {
  const designVisible = useDockLayoutStore((state) => state.visiblePanels.has("design"));
  useEffect(() => {
    if (hasBlockParams && (hasSelection || !designVisible)) onDismiss?.();
  }, [hasBlockParams, hasSelection, designVisible, onDismiss]);
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
