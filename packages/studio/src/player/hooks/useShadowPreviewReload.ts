/**
 * AD132/D-801: the hidden-shadow-reload mechanism a full-reload edit (drop,
 * insert, lane-move) uses so the preview never shows a blank frame.
 *
 * Extracted from useTimelinePlayer, which had grown past the studio's
 * 600-line file cap (same reason previewMessageRouter.ts and
 * usePlaybackKeyboard.ts were split out earlier).
 *
 * Shape: refreshPlayer (in useTimelinePlayer) calls beginShadowReload with the
 * reload URL, which queues a hidden "shadow" slot alongside the live one
 * (planShadowReload). NLEPreview mounts a second, hidden Player for that slot;
 * once its own restore-seek paints the right frame, its onAdapterReady signal
 * (wired here as onIframeLoad on a second useTimelineSyncCallbacks instance)
 * calls promoteShadowToLive, which repoints the shared iframeRef and swaps
 * the slot list (planShadowPromotion) — a single state update, so a render
 * never shows zero or two live slots.
 */

import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import {
  useTimelineSyncCallbacks,
  planShadowReload,
  planShadowPromotion,
  type PreviewIframeSlot,
} from "./useTimelineSyncCallbacks";
import type { PlaybackAdapter } from "../lib/playbackTypes";
import type { TimelineElement } from "../store/playerStore";

interface UseShadowPreviewReloadParams {
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  getAdapter: (overrideIframe?: HTMLIFrameElement | null) => PlaybackAdapter | null;
  pendingSeekRef: MutableRefObject<number | null>;
  isRefreshingRef: MutableRefObject<boolean>;
  syncTimelineElements: (elements: TimelineElement[], nextDuration?: number) => void;
  setDuration: (v: number) => void;
  setCurrentTime: (v: number) => void;
  requestTimelineReady: (doc: Document | null) => void;
  setIsPlaying: (v: boolean) => void;
  attachIframeShortcutListeners: () => void;
  applyPreviewAudioState: () => void;
}

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

  // Guarded against shadowGenRef (updated synchronously by beginShadowReload,
  // unlike the previewSlots state closure): a superseded shadow's readiness
  // can still arrive late, and must not repoint the live ref to content that
  // was replaced before it ever painted.
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

  // Called when the previewed composition itself changes (project switch,
  // sub-composition drill-down) rather than an edit reload — drops any
  // in-flight shadow, which would otherwise carry a URL for the composition
  // being navigated away from.
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
