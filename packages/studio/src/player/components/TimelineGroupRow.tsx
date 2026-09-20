import {
  HF_AUDIO_FX_ATTR,
  serializeAudioFxChain,
  type HfAudioFxChain,
} from "@hyperframes/core/audio-fx";
import type { TimelineTheme } from "./timelineTheme";
import type { TimelineTrackGroupInfo } from "./useTimelineTrackDerivations";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { TimelineTrackRow } from "./TimelineTrackRow";
import { TimelineGroupHeader } from "./TimelineGroupHeader";
import { groupAutomationElement } from "./groupAutomationElement";
import { LABEL_COL_W } from "./timelineLayout";
import { useTimelineEditContextOptional } from "../../contexts/TimelineEditContext";
import { useDomEditActionsContextOptional } from "../../contexts/DomEditContext";
import { usePlayerStore } from "../store/playerStore";

interface TimelineGroupRowProps {
  index: number;
  rowKey: number;
  group: TimelineTrackGroupInfo;
  logicalRow: TimelineLogicalRow;
  top: number;
  height: number;
  virtualized: boolean;
  contentOrigin: number;
  theme: TimelineTheme;
  rovingTargetId?: string | null;
  collapsedGroupIds: ReadonlySet<string>;
  expandedLaneOwnerIds?: ReadonlySet<string>;
  toggleGroupExpanded: (id: string) => void;
  toggleLaneOwnerExpanded?: (id: string) => void;
  lanes?: unknown;
  pps?: number;
  currentTime?: number;
  beatTimes?: readonly number[];
  trackContentWidth?: number;
  contentGutter?: number;
  /** A group's lanes are in composition time (§1.3), so this is their span. */
  compositionDuration: number;
}

/** A group's own row: the accessible shell (shared with track rows) plus the group header. */
export function TimelineGroupRow({
  index,
  rowKey,
  group,
  logicalRow,
  top,
  height,
  virtualized,
  contentOrigin,
  theme,
  rovingTargetId = null,
  collapsedGroupIds,
  expandedLaneOwnerIds: _expandedLaneOwnerIds,
  toggleGroupExpanded,
  toggleLaneOwnerExpanded: _toggleLaneOwnerExpanded,
  compositionDuration,
}: TimelineGroupRowProps) {
  // From the group, NOT from `tracks`: a collapsed group emits no member rows
  // into the display list, and every one of these reads silently degraded to
  // empty in that (default) state — the lane count
  // read 0, and the bus strip fell back to "track 1", "track 2".
  const memberElements = group.memberElements;
  // The group wearing a clip's shape so the lane machinery can render it — see
  // `groupAutomationElement` for why that beats a second, parallel lane path.
  const groupElement = groupAutomationElement(group, compositionDuration);
  // The binder writes through the dom-edit selection, so a group lane is
  // editable exactly when the group is the selected element — which clicking
  // its name in the header does.
  // Optional, like every sibling row: Timeline renders outside the edit
  // provider in read-only hosts (Timeline.test.ts asserts it), and the throwing
  // hook took the whole timeline down with it the moment a group existed —
  // not just this row.
  const { onSetAudioGroupAttributeLive, onSetAudioGroupAttributeQuiet } =
    useTimelineEditContextOptional();
  const domEditActions = useDomEditActionsContextOptional();
  const revealAudioFx = usePlayerStore((state) => state.setRevealedAudioFxTarget);
  const writeGroupFxChain = (next: HfAudioFxChain, live: boolean) => {
    const value = next.nodes.length ? serializeAudioFxChain(next) : null;
    if (live) onSetAudioGroupAttributeLive?.(group.id, HF_AUDIO_FX_ATTR, value);
    else void onSetAudioGroupAttributeQuiet?.(group.id, HF_AUDIO_FX_ATTR, value, "Apply preset");
  };
  const openGroupFxRack = (automationTarget?: string) => {
    // Use the guarded timeline-selection path even though the bus is synthetic:
    // it invalidates an older clip selection that may still be resolving. The
    // old direct build/apply path let that late clip reclaim the rack.
    const selection = domEditActions?.handleTimelineElementSelect(groupElement);
    if (!selection || !automationTarget) return;
    // Bus selection clears the clip selection, which intentionally retires any
    // old reveal request. Publish this one afterwards so the newly mounted bus
    // rack can consume it rather than losing it during that clear.
    void selection.then(() =>
      revealAudioFx({
        elementKey: group.id,
        automationTarget,
      }),
    );
  };
  return (
    <TimelineTrackRow
      index={index}
      rowKey={rowKey}
      logicalRow={logicalRow}
      propertyRows={[]}
      lanesId=""
      headerLanesId=""
      top={top}
      height={height}
      virtualized={virtualized}
      background={theme.rowBackground}
      borderColor={theme.rowBorder}
      rovingTargetId={rovingTargetId}
    >
      {/* Header and its lane labels in ONE sticky column — the shape
          `TimelineTrackHeader` already uses: a fixed TRACK_H line box with the
          lane rows absolutely positioned beneath it, the whole thing pinned.
          The labels used to be SIBLINGS of the header, so `absolute left-0`
          resolved against the ROW, and the row is what scrolls horizontally —
          they slid away with the canvas. Sticky lives here rather than on the
          header, which keeps its own box inside; a zero-width sticky wrapper
          around the labels alone does not work either, because as a flex item
          after the header it starts at x = columnWidth, i.e. inside the lanes. */}
      <div
        className="sticky left-0 z-12 shrink-0"
        style={{ width: contentOrigin >= LABEL_COL_W ? LABEL_COL_W : contentOrigin }}
      >
        <TimelineGroupHeader
          label={group.label}
          memberCount={group.memberTracks.length}
          isExpanded={!collapsedGroupIds.has(group.id)}
          onToggleExpanded={() => toggleGroupExpanded(group.id)}
          laneCount={0}
          isLaneOpen={false}
          onToggleLanes={() => undefined}
          fxChain={group.fxChain}
          onFxChainChange={(next) => writeGroupFxChain(next, false)}
          onFxChainPreview={(next) => writeGroupFxChain(next, true)}
          auditionSpans={memberElements}
          onOpenFxRack={() => openGroupFxRack()}
          // Same width as every other row's header. The group row needs a real
          // label column, but it gets one by turning `labelMode` on for the whole
          // timeline (see Timeline.tsx) rather than by overhanging alone — an
          // overhanging header paints opaquely across the rest of its row and
          // stays pinned there through horizontal scroll.
          columnWidth={contentOrigin >= LABEL_COL_W ? LABEL_COL_W : contentOrigin}
          theme={theme}
        />
      </div>
    </TimelineTrackRow>
  );
}
