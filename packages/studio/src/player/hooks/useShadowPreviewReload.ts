// Loads a full-reload edit in a hidden shadow iframe and promotes it once painted,
// so the live iframe never shows a blank frame.

import { useCallback, useRef, useState } from "react";
import {
  useTimelineSyncCallbacks,
  planShadowReload,
  planShadowPromotion,
  type PreviewIframeSlot,
  type UseTimelineSyncCallbacksParams,
} from "./useTimelineSyncCallbacks";
import type { PlaybackAdapter } from "../lib/playbackTypes";

type UseShadowPreviewReloadParams = Omit<
  UseTimelineSyncCallbacksParams,
  "probeIntervalRef" | "onAdapterReady" | "getAdapter"
> & {
  getAdapter: (overrideIframe?: HTMLIFrameElement | null) => PlaybackAdapter | null;
};

export function useShadowPreviewReload({
  iframeRef,
  getAdapter,
  pendingSeekRef,
  isRefreshingRef,
  syncTimelineElements,
  setDuration,
  setCurrentTime,
  requestTimelineReady,
  setIsPlaying,
  attachIframeShortcutListeners,
  applyPreviewAudioState,
}: UseShadowPreviewReloadParams) {
  const shadowIframeRef = useRef<HTMLIFrameElement | null>(null);
  const shadowProbeIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const shadowGenRef = useRef(0);
  const [previewSlots, setPreviewSlots] = useState<PreviewIframeSlot[]>([{ gen: 0, role: "live" }]);

  // gen is checked against shadowGenRef (synchronous) so a superseded shadow's late
  // readiness cannot repoint the live ref.
  const promoteShadowToLive = useCallback(
    (shadowIframe: HTMLIFrameElement | null, gen?: number) => {
      if (!shadowIframe || gen == null || gen !== shadowGenRef.current) return;
      iframeRef.current = shadowIframe;
      attachIframeShortcutListeners();
      applyPreviewAudioState();
      setPreviewSlots((prev) => planShadowPromotion(prev, gen));
    },
    [iframeRef, attachIframeShortcutListeners, applyPreviewAudioState],
  );

  const getShadowAdapter = useCallback(() => getAdapter(shadowIframeRef.current), [getAdapter]);

  const { onIframeLoad: onShadowIframeLoad } = useTimelineSyncCallbacks({
    iframeRef: shadowIframeRef,
    probeIntervalRef: shadowProbeIntervalRef,
    pendingSeekRef,
    isRefreshingRef,
    getAdapter: getShadowAdapter,
    syncTimelineElements,
    setDuration,
    setCurrentTime,
    requestTimelineReady,
    setIsPlaying,
    // A hidden shadow gets neither: shortcuts and audio state apply to the
    // live iframe only, once promoteShadowToLive makes it the live one.
    attachIframeShortcutListeners: () => {},
    applyPreviewAudioState: () => {},
    onAdapterReady: promoteShadowToLive,
  });

  const setShadowIframeNode = useCallback((node: HTMLIFrameElement | null) => {
    shadowIframeRef.current = node;
  }, []);

  const beginShadowReload = useCallback((url: string) => {
    shadowGenRef.current += 1;
    setPreviewSlots((prev) => planShadowReload(prev, shadowGenRef.current, url));
  }, []);

  // Composition switch (not an edit reload): drop any in-flight shadow.
  const resetPreviewSlots = useCallback(() => {
    shadowGenRef.current += 1;
    shadowIframeRef.current = null;
    setPreviewSlots([{ gen: shadowGenRef.current, role: "live" }]);
  }, []);

  return {
    previewSlots,
    onShadowIframeLoad,
    setShadowIframeNode,
    beginShadowReload,
    resetPreviewSlots,
  };
}
