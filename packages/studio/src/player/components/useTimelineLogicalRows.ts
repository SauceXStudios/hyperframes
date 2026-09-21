import { useMemo } from "react";
import {
  buildTimelineLogicalRows,
  type BuildTimelineLogicalRowsInput,
} from "./timelineKeyboardNavigation";

type TimelineLogicalRowsInput = BuildTimelineLogicalRowsInput;

/** Shared by rendering and focus coordination; stable input refs preserve memo identity. */
export function useTimelineLogicalRows({
  tracks,
  displayTrackOrder,
  laneCounts,
  selectedElementId,
  selectedElementIds,
  collapsedGroupIds,
  expandedLaneOwnerIds,
  groups,
  trackGroupOf,
}: TimelineLogicalRowsInput) {
  return useMemo(
    () =>
      buildTimelineLogicalRows({
        tracks,
        displayTrackOrder,
        laneCounts,
        selectedElementId,
        selectedElementIds,
        collapsedGroupIds,
        expandedLaneOwnerIds,
        groups,
        trackGroupOf,
      }),
    [
      displayTrackOrder,
      collapsedGroupIds,
      expandedLaneOwnerIds,
      groups,
      trackGroupOf,
      laneCounts,
      selectedElementId,
      selectedElementIds,
      tracks,
    ],
  );
}
