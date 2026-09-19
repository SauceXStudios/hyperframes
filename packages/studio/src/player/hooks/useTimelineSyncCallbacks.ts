/**
 * React callbacks for synchronising the player store from iframe runtime data.
 *
 * Covers four related concerns:
 *  - processTimelineMessage  — turn a clip-manifest postMessage into TimelineElements
 *  - enrichMissingCompositions — fill gaps the manifest misses (element-ref starts)
 *  - initializeAdapter        — called after iframe load: seek, set duration, read elements
 *  - onIframeLoad             — orchestrates initializeAdapter with a message-based fallback
 */

import { useCallback } from "react";
import { liveTime, usePlayerStore } from "../store/playerStore";
import type { TimelineElement } from "../store/playerStore";
import type { PlaybackAdapter, IframeWindow } from "../lib/playbackTypes";
import { readTimelineDurationFromDocument } from "../lib/timelineDOM";
import { buildMissingCompositionElements } from "../lib/timelineIframeHelpers";
import { acceptedRuntimeMessageFps } from "../lib/runtimeProtocol";
import {
  buildTimelineElementsFromClips,
  clipTreeParentMap,
  collectSubCompositionDomChildren,
  collectSubCompositionHostState,
  hydrateTimelineFromPreview,
  isPreviewReadinessMessage,
  safeContentDocument,
  sanitizeDurationSeconds,
  seekAdapterToRestorePoint,
  syncAdapterDuration,
  withImplicitDomLayers,
  type RuntimeTimelineMessage,
} from "./timelineSyncHydration";

// Re-exported for the tests and callers that have always imported it from here.
export { resolveReloadSeekTime } from "./timelineSyncHydration";

interface UseTimelineSyncCallbacksParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  probeIntervalRef: React.MutableRefObject<ReturnType<typeof setInterval> | undefined>;
  pendingSeekRef: React.MutableRefObject<number | null>;
  isRefreshingRef: React.MutableRefObject<boolean>;
  getAdapter: () => PlaybackAdapter | null;
  syncTimelineElements: (elements: TimelineElement[], nextDuration?: number) => void;
  setDuration: (v: number) => void;
  setCurrentTime: (v: number) => void;
  requestTimelineReady: (doc: Document | null) => void;
  setIsPlaying: (v: boolean) => void;
  attachIframeShortcutListeners: () => void;
  applyPreviewAudioState: () => void;
  /**
   * Called once initializeAdapter's restore-seek has rendered the correct
   * frame. Defaults to revealIframe (the live iframe, never actually
   * hidden anymore, so this is a no-op there). The shadow instantiation
   * passes the promotion callback instead — same signal, different action.
   * `context` carries opaque caller data (the shadow's generation number)
   * through untouched.
   */
  onAdapterReady?: (iframe: HTMLIFrameElement | null, context?: number) => void;
}

/**
 * Where should the player seek when the preview (re)loads?
 * Priority: explicit pending seek (saved by refreshPlayer right before a
 * reload) → store-level seek request (deep-link `?t=` hydration) → the store's
 * last known playhead. The last fallback makes the playhead RELOAD-INVARIANT:
 * edits persist + reload the preview, sometimes more than once (App's
 * refreshPreviewDocumentVersion staggers extra bumps at 80/300ms), and the
 * consume-once pendingSeekRef meant any reload after the first found the slot
 * empty and reset the playhead to 0 — the "dropped a file and the playhead
 * jumped to 0" bug. Falling back to the store's playhead means every reload
 * restores position; a fresh project load still starts at 0 because the store
 * resets currentTime on project switch. Invariant: an edit NEVER moves the
 * playhead (the clamp below is the one sanctioned move — content shrank past it).
 */
/**
 * Undo a hidden `visibility` a caller may have set on an iframe. Safe to call
 * when the iframe was never hidden (idempotent no-op). This is the default
 * "adapter ready" handler for the always-visible live iframe, which
 * refreshPlayer no longer hides (see planShadowReload) — kept for the
 * initial mount and as the fallback signature other callers rely on.
 */
export function revealIframe(iframe: HTMLIFrameElement | null): void {
  if (iframe && iframe.style.visibility === "hidden") {
    iframe.style.visibility = "";
  }
}

export type PreviewIframeRole = "live" | "shadow";

export interface PreviewIframeSlot {
  gen: number;
  role: PreviewIframeRole;
  url?: string;
}

/**
 * AD132/D-801: a full-reload edit (drop/insert/lane-move) never touches the
 * live iframe. Instead it queues a hidden "shadow" slot pointed at the reload
 * URL, replacing any earlier shadow that never became live — that content
 * went stale before it ever painted, so there is nothing in it worth keeping.
 * The live slot is untouched, so the visible frame never blanks.
 */
export function planShadowReload(
  slots: PreviewIframeSlot[],
  nextGen: number,
  url: string,
): PreviewIframeSlot[] {
  const live = slots.find((slot) => slot.role === "live");
  return live ? [live, { gen: nextGen, role: "shadow", url }] : [{ gen: nextGen, role: "live" }];
}

/**
 * Swap a ready shadow in for the live slot with a single array replacement,
 * so a render can never show zero (or two) live slots — the old live slot
 * disappears in the exact update that makes the shadow the new one. A
 * readyGen that no longer matches the current shadow (superseded by a later
 * reload before it painted) is a no-op.
 */
export function planShadowPromotion(
  slots: PreviewIframeSlot[],
  readyGen: number,
): PreviewIframeSlot[] {
  const ready = slots.find((slot) => slot.gen === readyGen && slot.role === "shadow");
  return ready ? [{ ...ready, role: "live" }] : slots;
}

/**
 * The transport TOTAL a clip-manifest message should write to the store.
 *
 * The manifest's `durationInFrames` measures the runtime timeline; some runtimes
 * report only the furthest clip end and ignore the root composition's authored
 * `data-duration`. When that manifest total is SHORTER than the authored root
 * duration, writing it makes the readout stale (playback still runs the full
 * authored window — the user saw "0:44/0:40" on a root authored at 44.5s whose
 * last clip ends at 40s). The authored root duration is the floor for the total,
 * so the readout can never sit below what the file declares. A manifest total
 * that is LONGER (clips extend past the root) still wins — content can only grow
 * the timeline, never shrink it below the authored window.
 */
export function resolveTimelineTotalDuration(input: {
  manifestDurationSeconds: number;
  authoredRootDurationSeconds: number;
}): number {
  return Math.max(
    sanitizeDurationSeconds(input.manifestDurationSeconds),
    sanitizeDurationSeconds(input.authoredRootDurationSeconds),
  );
}

export function useTimelineSyncCallbacks({
  iframeRef,
  probeIntervalRef,
  pendingSeekRef,
  isRefreshingRef,
  getAdapter,
  syncTimelineElements,
  setDuration,
  setCurrentTime,
  requestTimelineReady,
  setIsPlaying,
  attachIframeShortcutListeners,
  applyPreviewAudioState,
  onAdapterReady = revealIframe,
}: UseTimelineSyncCallbacksParams) {
  // Convert a runtime timeline message (from iframe postMessage) into TimelineElements
  const processTimelineMessage = useCallback(
    (data: RuntimeTimelineMessage) => {
      if (!data.clips || data.clips.length === 0) {
        return;
      }

      usePlayerStore.getState().setClipManifest(data.clips);

      // Show root-level clips: no parentCompositionId, OR parent is a "phantom wrapper"
      const clipCompositionIds = new Set(data.clips.map((c) => c.compositionId).filter(Boolean));
      const filtered = data.clips.filter(
        (clip) => !clip.parentCompositionId || !clipCompositionIds.has(clip.parentCompositionId),
      );
      const iframeDoc = safeContentDocument(iframeRef.current);

      try {
        const parentMap = clipTreeParentMap(iframeRef.current?.contentWindow ?? null);
        const domClipChildren = collectSubCompositionDomChildren(iframeDoc, data.clips, parentMap);
        usePlayerStore.getState().setClipParentMap(parentMap);
        usePlayerStore.getState().setDomClipChildren(domClipChildren);
        usePlayerStore
          .getState()
          .setSubCompositionHostState(collectSubCompositionHostState(iframeDoc, data.clips));
      } catch {
        // cross-origin or __clipTree not available — maps stay empty
      }

      const els = buildTimelineElementsFromClips(filtered, iframeDoc);
      // Clamp non-finite or absurdly large durations — the runtime can emit
      // Infinity when it detects a loop-inflated GSAP timeline without an
      // explicit data-duration on the root composition. Floor the manifest total
      // at the authored root `data-duration` so a runtime that measures only the
      // furthest clip end (shorter than the authored window) can't leave a stale,
      // too-short total in the transport (the "0:44/0:40" bug).
      const newDuration = resolveTimelineTotalDuration({
        manifestDurationSeconds: data.durationInFrames / acceptedRuntimeMessageFps(data),
        authoredRootDurationSeconds: readTimelineDurationFromDocument(iframeDoc),
      });
      const timelineEls = withImplicitDomLayers(
        els,
        iframeDoc,
        newDuration > 0 ? newDuration : usePlayerStore.getState().duration,
      );
      if (timelineEls.length > 0) {
        syncTimelineElements(timelineEls, newDuration > 0 ? newDuration : undefined);
      }
    },
    [iframeRef, syncTimelineElements],
  );

  const enrichMissingCompositions = useCallback(() => {
    try {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      const iframeWin = iframe?.contentWindow as IframeWindow | null;
      if (!doc || !iframeWin) return;

      const currentEls = usePlayerStore.getState().elements;
      const rootDuration = usePlayerStore.getState().duration;
      const { missing, updatedEls, patched } = buildMissingCompositionElements(
        doc,
        iframeWin,
        currentEls,
        rootDuration,
      );

      if (missing.length > 0 || patched) {
        // Dedup: ensure no missing element duplicates an existing one
        const finalIds = new Set(updatedEls.map((e) => e.id));
        const dedupedMissing = missing.filter((m) => !finalIds.has(m.id));
        syncTimelineElements([...updatedEls, ...dedupedMissing]);
      }
    } catch {}
  }, [iframeRef, syncTimelineElements]);

  const initializeAdapter = useCallback(
    (context?: number) => {
      const adapter = getAdapter();
      if (!adapter || adapter.getDuration() <= 0) return false;

      adapter.pause();
      const startTime = seekAdapterToRestorePoint(adapter, pendingSeekRef);
      // The correct frame is now rendered — signal readiness so the caller can
      // reveal it (the live iframe, never hidden anymore) or promote it (a
      // shadow reload, AD132/D-801) — never before this point, so the visible
      // frame is either the old content or the new one, never neither.
      onAdapterReady(iframeRef.current, context);
      // Keep non-React listeners such as the capture link and time display in sync
      // with the initial adapter seek on iframe load.
      liveTime.notify(startTime);
      syncAdapterDuration(adapter, setDuration);
      setCurrentTime(startTime);
      if (!isRefreshingRef.current) {
        // Enables Play from actual play-readiness, not just a known duration —
        // a click before this resolves used to start the timeline with media,
        // images or fonts still loading and never recover.
        requestTimelineReady(safeContentDocument(iframeRef.current));
      }
      isRefreshingRef.current = false;
      setIsPlaying(false);

      hydrateTimelineFromPreview({
        iframe: iframeRef.current,
        adapter,
        processTimelineMessage,
        enrichMissingCompositions,
        applyPreviewAudioState,
        attachIframeShortcutListeners,
        syncTimelineElements,
      });
      return true;
    },
    [
      getAdapter,
      setDuration,
      setCurrentTime,
      requestTimelineReady,
      setIsPlaying,
      processTimelineMessage,
      enrichMissingCompositions,
      syncTimelineElements,
      attachIframeShortcutListeners,
      applyPreviewAudioState,
      onAdapterReady,
      iframeRef,
      isRefreshingRef,
      pendingSeekRef,
    ],
  );

  const onIframeLoad = useCallback(
    (context?: number) => {
      applyPreviewAudioState();
      if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);

      // Fast path: adapter already available (in-place reloads, cached compositions)
      if (initializeAdapter(context)) return;

      // The runtime posts "state" or "timeline" messages once ready.
      // Listen for those instead of polling.
      const iframe = iframeRef.current;
      let settled = false;

      const trySettle = () => {
        if (settled) return;
        if (initializeAdapter(context)) {
          settled = true;
          window.removeEventListener("message", onMessage);
          if (probeIntervalRef.current) clearInterval(probeIntervalRef.current);
        }
      };

      const onMessage = (e: MessageEvent) => {
        if (isPreviewReadinessMessage(e, iframe)) trySettle();
      };
      window.addEventListener("message", onMessage);

      // Safety net: if no message arrives within 5s, try one last time then give up.
      probeIntervalRef.current = setTimeout(() => {
        if (!settled) {
          trySettle();
        }
        window.removeEventListener("message", onMessage);
        // Never leave the live iframe stuck invisible if the runtime never
        // settled. A shadow that gives up here is simply never promoted — the
        // live iframe it would have replaced was never touched, so there is
        // nothing to undo.
        revealIframe(iframeRef.current);
      }, 5000) as unknown as ReturnType<typeof setInterval>;
    },
    [initializeAdapter, iframeRef, probeIntervalRef, applyPreviewAudioState],
  );

  // Stable refs so mount-effect closures always call the latest version
  const processTimelineMessageRef = { current: processTimelineMessage };
  const enrichMissingCompositionsRef = { current: enrichMissingCompositions };

  return {
    processTimelineMessage,
    processTimelineMessageRef,
    enrichMissingCompositions,
    enrichMissingCompositionsRef,
    initializeAdapter,
    onIframeLoad,
  };
}
