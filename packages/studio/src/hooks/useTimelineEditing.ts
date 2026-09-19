// fallow-ignore-file complexity
import { useCallback, useRef } from "react";
import type { TimelineElement } from "../player";
import { useRazorSplit } from "./useRazorSplit";
import { useTimelineAssetDropOps } from "./useTimelineAssetDropOps";
import {
  applyTimelineStackingReorder,
  patchIframeDomTiming,
  playbackStartAttributeForElement,
  persistTimelineEdit,
  formatTimelineAttributeNumber,
  extendRootDurationIfNeeded,
  buildTimelineMoveTimingPatch,
  buildTimelineResizeTimingPatch,
} from "./timelineEditingHelpers";
import {
  captureDurationRollback,
  finishClipTimingFallback,
  readFileContent,
  syncPreviewContentDuration,
} from "./timelineTimingSync";
import type { PersistTimelineEditInput } from "./timelineEditingHelpers";
import { useSetAudioGroupAttribute } from "./timelineAudioGroupVolume";
import { useSetElementAttribute } from "./timelineElementFxAttribute";
import { useTimelineDeleteOps } from "./useTimelineDeleteOps";
import { useTrackPendingTimelineEdit } from "./useTrackPendingTimelineEdit";
import { useAudioGroupCarveAssignment } from "./timelineAudioGroupCreate";
import {
  useTimelineElementVisibilityEditing,
  useTimelineTrackVisibilityEditing,
} from "./timelineTrackVisibility";
import {
  useTimelineGroupEditing,
  type TimelineGroupCommitOptions,
  type TimelineGroupMoveChange,
  type TimelineGroupResizeChange,
} from "./useTimelineGroupEditing";
import { useBlockedTimelineEditToast } from "./useBlockedTimelineEditToast";
import { useTimelineEditGate } from "./timelineEditPermission";
import { serializeZLaneGesture } from "../components/nle/zLaneGesture";
import { cutoverCommittedOrThrow, sdkTimingPersist } from "../utils/sdkCutover";
import type { TimelineMoveUpdates, UseTimelineEditingOptions } from "./useTimelineEditingTypes";
import { getStudioSaveErrorMessage } from "../utils/studioSaveDiagnostics";

export function useTimelineEditing({
  projectId,
  activeCompPath,
  timelineElements,
  showToast,
  writeProjectFile,
  observeProjectFileVersion,
  recordEdit,
  reloadPreview,
  previewIframeRef,
  pendingTimelineEditPathRef,
  uploadProjectFiles,
  isRecordingRef,
  sdkSession,
  publishSdkSession,
  forceReloadSdkSession,
  invalidateGsapCache,
  handleDomZIndexReorderCommitRef,
  canEdit,
}: UseTimelineEditingOptions) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const editQueueRef = useRef(Promise.resolve());
  const track = useTrackPendingTimelineEdit();
  const checkEditable = useTimelineEditGate(canEdit, showToast);
  // Refuses (no call, no write, no history entry) when any target is
  // blocked; otherwise runs fn as before. The one gate every covered
  // handler below goes through, ahead of tracking its write.
  const guard = useCallback(
    <Args extends unknown[]>(
      resolveTargets: (...args: Args) => readonly TimelineElement[],
      fn: (...args: Args) => Promise<void>,
    ) =>
      (...args: Args): Promise<void> =>
        checkEditable(resolveTargets(...args)) ? fn(...args) : Promise.resolve(),
    [checkEditable],
  );

  const enqueueEdit = useCallback(
    (
      element: TimelineElement,
      label: string,
      buildPatches: PersistTimelineEditInput["buildPatches"],
      coalesceKey?: string,
    ): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.resolve();
      }
      const pid = projectIdRef.current;
      if (!pid) return Promise.resolve();
      const queued = editQueueRef.current
        .then(() =>
          persistTimelineEdit({
            projectId: pid,
            element,
            activeCompPath,
            label,
            buildPatches,
            writeProjectFile,
            recordEdit,
            pendingTimelineEditPathRef,
            coalesceKey,
          }),
        )
        .then(() => {
          forceReloadSdkSession?.();
        });
      editQueueRef.current = queued.catch((error) => {
        console.error(`[Timeline] Failed to persist: ${label}`, error);
      });
      return queued;
    },
    [
      activeCompPath,
      recordEdit,
      writeProjectFile,
      pendingTimelineEditPathRef,
      showToast,
      isRecordingRef,
      forceReloadSdkSession,
    ],
  );
  const groupEditing = useTimelineGroupEditing({
    activeCompPath,
    editQueueRef,
    forceReloadSdkSession,
    invalidateGsapCache,
    isRecordingRef,
    pendingTimelineEditPathRef,
    previewIframeRef,
    projectIdRef,
    recordEdit,
    reloadPreview,
    sdkSession,
    publishSdkSession,
    showToast,
    writeProjectFile,
  });
  const handleTimelineElementMove = useCallback(
    // fallow-ignore-next-line complexity
    (element: TimelineElement, updates: TimelineMoveUpdates) => {
      const commitMove = () => {
        const targetPath = element.sourceFile || activeCompPath || "index.html";
        const startChanged = updates.start !== element.start;
        // A vertical-only lane move arrives with start unchanged but track changed
        // (on this single-element path the drag commit has already folded the
        // AUTHORED persist track into updates.track). It must persist like any
        // other move — early-returning on !startChanged alone silently dropped
        // the file write, so the lane snapped back on reload.
        const trackChanged = updates.track !== element.track;

        if (startChanged || trackChanged) {
          const liveAttrs: Array<[string, string]> = [];
          if (startChanged) {
            liveAttrs.push(["data-start", formatTimelineAttributeNumber(updates.start)]);
          }
          if (trackChanged) {
            liveAttrs.push(["data-track-index", formatTimelineAttributeNumber(updates.track)]);
          }
          patchIframeDomTiming(previewIframeRef.current, element, liveAttrs, activeCompPath);
        }

        const reorderDone = applyTimelineStackingReorder({
          element,
          stackingReorder: updates.stackingReorder,
          timelineElements,
          iframe: previewIframeRef.current,
          activeCompPath,
          commit: handleDomZIndexReorderCommitRef?.current,
        });

        if (!startChanged && !trackChanged) return reorderDone;

        // Snapshot the duration BEFORE the optimistic updates below so a failed
        // persist can roll the readout + live root back (see captureDurationRollback).
        const rollbackDuration = captureDurationRollback(previewIframeRef.current);
        // needsExtension gates the SDK path (setTiming can't grow the root duration), so read the store BEFORE the readout sync below optimistically updates it.
        const needsExtension = extendRootDurationIfNeeded(updates.start + element.duration);
        // Optimistic duration readout: content-driven (grow AND shrink), from the just-patched live DOM. See syncPreviewContentDuration.
        syncPreviewContentDuration(previewIframeRef.current);

        const buildMovePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
          // Persist lane changes too — data-start-only writes let reload snap the lane back.
          const track = trackChanged ? updates.track : undefined;
          return buildTimelineMoveTimingPatch(
            original,
            target,
            updates.start,
            element.duration,
            track,
          );
        };
        const coalesceKey = `timeline-move:${element.hfId ?? element.id}`;
        const finishMoveGsapSync = () =>
          // Every timing writer converges the same GSAP positions after its
          // durable clip-start commit. The SDK owns the attribute write; this
          // sync owns only the dependent animation rewrite and preview refresh.
          finishClipTimingFallback({
            iframe: previewIframeRef.current,
            reloadPreview,
            projectId: projectIdRef.current,
            targetPath,
            domId: element.domId,
            label: "Move timeline clip",
            coalesceKey,
            recordEdit,
            edit: { kind: "shift", delta: updates.start - element.start },
          }).finally(() => invalidateGsapCache?.());
        const moveFallback = () =>
          enqueueEdit(element, "Move timeline clip", buildMovePatches, coalesceKey).then(
            finishMoveGsapSync,
          );
        return reorderDone
          .then(() => {
            // The SDK setTiming path writes start only — a lane change must take
            // the fallback, whose patch builder writes data-track-index too.
            if (sdkSession && element.hfId && !needsExtension && !trackChanged) {
              return sdkTimingPersist(
                element.hfId,
                targetPath,
                { start: updates.start },
                sdkSession,
                {
                  editHistory: { recordEdit },
                  writeProjectFile,
                  reloadPreview,
                  compositionPath: activeCompPath,
                  // Capture on-disk bytes as the undo `before` so undoing a timing move
                  // restores the file verbatim, not a normalized full-DOM re-emit.
                  readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
                  publishSession: publishSdkSession,
                },
                { label: "Move timeline clip", coalesceKey, skipRefresh: true },
              ).then((result) => {
                if (!cutoverCommittedOrThrow(result)) return moveFallback();
                return finishMoveGsapSync();
              });
            }
            return moveFallback();
          })
          .catch((error) => {
            // Failed persist: revert the optimistic duration readout + live root.
            rollbackDuration();
            showToast(getStudioSaveErrorMessage(error), "error");
            throw error;
          });
      };
      return updates.stackingReorder ? serializeZLaneGesture(commitMove) : commitMove();
    },
    [
      previewIframeRef,
      enqueueEdit,
      activeCompPath,
      sdkSession,
      publishSdkSession,
      recordEdit,
      writeProjectFile,
      reloadPreview,
      timelineElements,
      handleDomZIndexReorderCommitRef,
      showToast,
      invalidateGsapCache,
    ],
  );

  const handleTimelineElementResize = useCallback(
    // fallow-ignore-next-line complexity
    (
      element: TimelineElement,
      updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
    ) => {
      const liveAttrs: Array<[string, string]> = [
        ["data-start", formatTimelineAttributeNumber(updates.start)],
        ["data-duration", formatTimelineAttributeNumber(updates.duration)],
      ];
      if (updates.playbackStart != null) {
        const liveAttr = playbackStartAttributeForElement(element);
        liveAttrs.push([liveAttr, formatTimelineAttributeNumber(updates.playbackStart)]);
      }
      patchIframeDomTiming(previewIframeRef.current, element, liveAttrs, activeCompPath);
      // Snapshot the duration BEFORE the optimistic updates below so a failed
      // persist can roll the readout + live root back (see captureDurationRollback).
      const rollbackDuration = captureDurationRollback(previewIframeRef.current);
      // needsExtension gates the SDK path (setTiming can't grow the root duration), so read the store BEFORE the readout sync below optimistically updates it.
      const needsExtension = extendRootDurationIfNeeded(updates.start + updates.duration);
      // Optimistic duration readout: content-driven (grow AND shrink), from the just-patched live DOM. See syncPreviewContentDuration.
      syncPreviewContentDuration(previewIframeRef.current);
      const targetPath = element.sourceFile || activeCompPath || "index.html";
      const buildResizePatches: PersistTimelineEditInput["buildPatches"] = (original, target) => {
        return buildTimelineResizeTimingPatch(original, target, element, updates);
      };
      const hasPbsAdjustment =
        updates.playbackStart != null ||
        (updates.start !== element.start && element.playbackStart != null);
      // Server-path fallback: after persisting the attr patch, scale GSAP tween
      // positions/durations on the server, then soft-reload with the rewritten
      // script (timing-only resize) — same no-flash path as move; full reload is
      // the fallback.
      const coalesceKey = `timeline-resize:${element.hfId ?? element.id}`;
      const finishResizeGsapSync = () =>
        finishClipTimingFallback({
          iframe: previewIframeRef.current,
          reloadPreview,
          projectId: projectIdRef.current,
          targetPath,
          domId: element.domId,
          label: "Resize timeline clip",
          coalesceKey,
          recordEdit,
          edit: {
            kind: "scale",
            from: { start: element.start, duration: element.duration },
            to: { start: updates.start, duration: updates.duration },
          },
        }).finally(() => invalidateGsapCache?.());
      const resizeFallback = () =>
        enqueueEdit(element, "Resize timeline clip", buildResizePatches, coalesceKey).then(
          finishResizeGsapSync,
        );
      const persistDone =
        sdkSession && element.hfId && !hasPbsAdjustment && !needsExtension
          ? sdkTimingPersist(
              element.hfId,
              targetPath,
              { start: updates.start, duration: updates.duration },
              sdkSession,
              {
                editHistory: { recordEdit },
                writeProjectFile,
                reloadPreview,
                compositionPath: activeCompPath,
                // Capture on-disk bytes as the undo `before` so undoing a timing
                // resize restores the file verbatim, not a normalized full-DOM re-emit.
                readProjectFile: (path) => readFileContent(projectIdRef.current ?? "", path),
                publishSession: publishSdkSession,
              },
              { label: "Resize timeline clip", coalesceKey, skipRefresh: true },
            ).then((result) => {
              if (!cutoverCommittedOrThrow(result)) return resizeFallback();
              return finishResizeGsapSync();
            })
          : resizeFallback();
      return persistDone.catch((error) => {
        // Failed persist: revert the optimistic duration readout + live root.
        rollbackDuration();
        showToast(getStudioSaveErrorMessage(error), "error");
        throw error;
      });
    },
    [
      previewIframeRef,
      enqueueEdit,
      activeCompPath,
      sdkSession,
      publishSdkSession,
      recordEdit,
      writeProjectFile,
      reloadPreview,
      showToast,
      invalidateGsapCache,
    ],
  );

  const handleToggleTrackHidden = useTimelineTrackVisibilityEditing({
    projectIdRef,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    forceReloadSdkSession,
  });

  const handleToggleElementHidden = useTimelineElementVisibilityEditing({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
    forceReloadSdkSession,
  });

  const handleAutoGroupCarveSources = useAudioGroupCarveAssignment({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
  });

  const setElementFxAttribute = useSetElementAttribute({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
  });

  const setAudioGroupAttribute = useSetAudioGroupAttribute({
    projectIdRef,
    activeCompPath,
    showToast,
    writeProjectFile,
    recordEdit,
    previewIframeRef,
    pendingTimelineEditPathRef,
    isRecordingRef,
  });

  const { handleTimelineElementsDelete, handleTimelineElementDelete } = useTimelineDeleteOps({
    projectIdRef,
    activeCompPath,
    timelineElements,
    showToast,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    isRecordingRef,
    forceReloadSdkSession,
    previewIframeRef,
    handleTimelineGroupMove: groupEditing.handleTimelineGroupMove,
  });

  const { handleTimelineAssetDrop, handleTimelineFileDrop, handleTimelineCompositionDrop } =
    useTimelineAssetDropOps({
      projectIdRef,
      activeCompPath,
      timelineElements,
      showToast,
      writeProjectFile,
      recordEdit,
      reloadPreview,
      uploadProjectFiles,
      isRecordingRef,
      forceReloadSdkSession,
      observeProjectFileVersion,
    });

  const handleBlockedTimelineEdit = useBlockedTimelineEditToast(showToast);

  const { handleRazorSplit, handleRazorSplitAll } = useRazorSplit({
    projectId,
    activeCompPath,
    showToast,
    writeProjectFile,
    observeProjectFileVersion,
    recordEdit,
    reloadPreview,
    isRecordingRef,
    forceReloadSdkSession,
  });

  // Every write-handler is tracked here, the one place all hand edits
  // converge, so undo (already awaiting this registry) never races a write.
  // canEdit is checked at the same point, ahead of tracking: split, move,
  // resize, group move/resize, delete and the fx-attribute persist are
  // covered by resolving their element(s); toggle-hidden resolves by key or
  // track. Not covered here: the audio-group attribute (keyed by a group id
  // with no element to resolve), razor-split-all, and the three drop
  // handlers (they add content, not edit an existing element).
  const trackedRazorSplit = track(
    guard((element: TimelineElement, _splitTime: number) => [element], handleRazorSplit),
  );
  return {
    handleTimelineElementMove: track(
      guard(
        (element: TimelineElement, _updates: TimelineMoveUpdates) => [element],
        handleTimelineElementMove,
      ),
    ),
    handleTimelineElementResize: track(
      guard(
        (
          element: TimelineElement,
          _updates: Pick<TimelineElement, "start" | "duration" | "playbackStart">,
        ) => [element],
        handleTimelineElementResize,
      ),
    ),
    handleToggleTrackHidden: track(
      guard(
        (trackIndex: number, _hidden: boolean, _displayNumber?: number | null) =>
          timelineElements.filter((el) => el.track === trackIndex),
        handleToggleTrackHidden,
      ),
    ),
    handleToggleElementHidden: track(
      guard((elementKey: string | readonly string[], _hidden: boolean) => {
        const keys = new Set(Array.isArray(elementKey) ? elementKey : [elementKey]);
        return timelineElements.filter((el) => keys.has(el.key ?? el.id));
      }, handleToggleElementHidden),
    ),
    handleAutoGroupCarveSources: track(handleAutoGroupCarveSources),
    setAudioGroupAttribute: {
      ...setAudioGroupAttribute,
      setQuiet: track(setAudioGroupAttribute.setQuiet),
    },
    setElementFxAttribute: {
      ...setElementFxAttribute,
      setQuiet: track(
        guard(
          (element: TimelineElement, _attr: string, _value: string | null, _label: string) => [
            element,
          ],
          setElementFxAttribute.setQuiet,
        ),
      ),
    },
    handleTimelineElementDelete: track(
      guard((element: TimelineElement) => [element], handleTimelineElementDelete),
    ),
    handleTimelineElementsDelete: track(
      guard((elements: TimelineElement[]) => elements, handleTimelineElementsDelete),
    ),
    handleTimelineElementSplit: trackedRazorSplit,
    handleRazorSplit: trackedRazorSplit,
    handleRazorSplitAll: track(handleRazorSplitAll),
    handleTimelineAssetDrop: track(handleTimelineAssetDrop),
    handleTimelineFileDrop: track(handleTimelineFileDrop),
    handleTimelineCompositionDrop: track(handleTimelineCompositionDrop),
    handleBlockedTimelineEdit,
    handleTimelineGroupMove: track(
      guard(
        (changes: TimelineGroupMoveChange[], _options?: TimelineGroupCommitOptions) =>
          changes.map((c) => c.element),
        groupEditing.handleTimelineGroupMove,
      ),
    ),
    handleTimelineGroupResize: track(
      guard(
        (changes: TimelineGroupResizeChange[], _options?: TimelineGroupCommitOptions) =>
          changes.map((c) => c.element),
        groupEditing.handleTimelineGroupResize,
      ),
    ),
  };
}
