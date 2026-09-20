import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { PropertyGroupName } from "@hyperframes/core/gsap-parser";
import type { TimelineElement } from "../store/playerStore";
import { type TimelineKeyframeTarget } from "./timelineKeyframeIdentity";
import {
  timelineClipFocusId,
  timelineGroupRowId,
  timelineTrackRowId,
} from "./timelineNavigationIdentity";
import type { TimelineTrackGroupInfo } from "./useTimelineTrackDerivations";

export type TimelineNavigationKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

const NAVIGATION_KEYS: ReadonlySet<string> = new Set<TimelineNavigationKey>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

export function isTimelineNavigationKey(key: string): key is TimelineNavigationKey {
  return NAVIGATION_KEYS.has(key);
}

export interface TimelineLogicalItem {
  id: string;
  kind: "clip" | "keyframe" | "ease";
  rowId: string;
  elementId: string;
  /** The item's time anchor. Clips use their midpoint; ease controls use the segment midpoint. */
  time: number;
  keyframeTarget?: TimelineKeyframeTarget;
}

export interface TimelineLogicalRow {
  id: string;
  kind: "row";
  physicalTrackKey: number;
  logicalIndex: number;
  level: 1 | 2 | 3;
  parentId: string | null;
  elementId: string | null;
  /** Set only on a group's own row (level 1, no clips of its own). */
  groupId?: string;
  expandable: boolean;
  expanded: boolean;
  propertyGroup?: PropertyGroupName;
  items: readonly TimelineLogicalItem[];
}

export type TimelineLogicalTarget = TimelineLogicalRow | TimelineLogicalItem;

export interface BuildTimelineLogicalRowsInput {
  tracks: readonly (readonly [number, readonly TimelineElement[]])[];
  displayTrackOrder: readonly number[];
  laneCounts: ReadonlyMap<string, number>;
  selectedElementId: string | null;
  selectedElementIds: ReadonlySet<string>;
  /** @deprecated Accepted for fixture compatibility; expansion no longer affects rows. */
  expandedClipIds?: ReadonlySet<string>;
  /** Groups the caret has COLLAPSED — absent means expanded, the default. */
  collapsedGroupIds: ReadonlySet<string>;
  /** @deprecated Accepted for fixture compatibility; expansion no longer affects rows. */
  expandedLaneOwnerIds?: ReadonlySet<string>;
  /** Rows (clip id or group id) whose automation-lane rows the `∿` button opened. */
  groups: readonly TimelineTrackGroupInfo[];
  trackGroupOf: ReadonlyMap<number, TimelineTrackGroupInfo>;
  gsapAnimations: ReadonlyMap<string, readonly GsapAnimation[]>;
}

export interface TimelineNavigationOptions {
  /** Supplied by the viewport actor; the model never guesses a fixed page size. */
  pageSize?: number;
  /** Ctrl/Meta + Home/End moves to the first/last logical row. */
  timelineBoundary?: boolean;
}

function elementId(element: TimelineElement): string {
  return element.key ?? element.id;
}

function clipItems(rowId: string, elements: readonly TimelineElement[]): TimelineLogicalItem[] {
  return [...elements]
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.start + left.duration - (right.start + right.duration) ||
        elementId(left).localeCompare(elementId(right)),
    )
    .map((element) => {
      const id = elementId(element);
      return {
        id: timelineClipFocusId(id),
        kind: "clip",
        rowId,
        elementId: id,
        time: element.start + element.duration / 2,
      };
    });
}

/** Canonical model of the treegrid, independent of which virtual rows or clips are mounted. */
export function buildTimelineLogicalRows({
  tracks,
  displayTrackOrder,
  selectedElementId,
  selectedElementIds,
  collapsedGroupIds,
  groups,
  trackGroupOf,
}: BuildTimelineLogicalRowsInput): TimelineLogicalRow[] {
  const trackMap = new Map(tracks);
  const groupByAnchor = new Map(groups.map((group) => [group.anchorKey, group]));
  const rows: TimelineLogicalRow[] = [];

  // A real track is always one logical row. Keyframe navigation stays on the
  // clip itself; property-lane rows no longer exist in the timeline tree.
  function emitTrack(track: number, level: 1 | 2, parentId: string | null): void {
    const elements = trackMap.get(track) ?? [];
    const trackId = timelineTrackRowId(track);
    const selected = elements.find((element) => {
      const id = elementId(element);
      return id === selectedElementId || selectedElementIds.has(id);
    });
    const activeId = selected ? elementId(selected) : elements[0] ? elementId(elements[0]) : null;
    rows.push({
      id: trackId,
      kind: "row",
      physicalTrackKey: track,
      logicalIndex: rows.length,
      level,
      parentId,
      elementId: activeId,
      expandable: false,
      expanded: false,
      items: clipItems(trackId, elements),
    });
  }

  // A group's own row (level 1) plus, when its `∿` is open, its own
  // automation-lane rows (level 2) — structural content deferred to whatever
  // step wires group automation editing; this reserves the rows and their
  // count.
  function emitGroup(group: TimelineTrackGroupInfo): void {
    const groupRowId = timelineGroupRowId(group.id);
    const groupExpanded = !collapsedGroupIds.has(group.id);
    rows.push({
      id: groupRowId,
      kind: "row",
      physicalTrackKey: group.anchorKey,
      logicalIndex: rows.length,
      level: 1,
      parentId: null,
      elementId: null,
      groupId: group.id,
      expandable: group.memberTracks.length > 0,
      expanded: groupExpanded,
      items: [],
    });
    if (!groupExpanded) return;
    for (const track of group.memberTracks) emitTrack(track, 2, groupRowId);
  }

  for (const key of displayTrackOrder) {
    const group = groupByAnchor.get(key);
    if (group) {
      emitGroup(group);
      continue;
    }
    if (trackGroupOf.has(key)) continue; // emitted above, under its group
    emitTrack(key, 1, null);
  }
  return rows;
}

export function locateTimelineLogicalTarget(rows: readonly TimelineLogicalRow[], id: string) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]!;
    if (row.id === id) return { row, rowIndex, itemIndex: -1, target: row };
    const itemIndex = row.items.findIndex((item) => item.id === id);
    if (itemIndex >= 0) return { row, rowIndex, itemIndex, target: row.items[itemIndex]! };
  }
  return null;
}

function nearestTarget(row: TimelineLogicalRow, time: number): TimelineLogicalTarget {
  return (
    [...row.items].sort(
      (left, right) =>
        Math.abs(left.time - time) - Math.abs(right.time - time) ||
        left.time - right.time ||
        left.id.localeCompare(right.id),
    )[0] ?? row
  );
}

/**
 * Resolve the next logical target without touching the DOM. The downstream
 * `useTimelineKeyboardActor` hook consumes this model when keyboard controls
 * are wired to the rendered timeline.
 */
// The branching is the keyboard contract: four key classes intentionally share one actor.
// fallow-ignore-next-line complexity
export function resolveTimelineNavigationTarget(
  rows: readonly TimelineLogicalRow[],
  currentId: string,
  key: TimelineNavigationKey,
  options: TimelineNavigationOptions = {},
): TimelineLogicalTarget | null {
  const current = locateTimelineLogicalTarget(rows, currentId);
  if (!current) return null;
  const { row, rowIndex, itemIndex, target } = current;

  if (key === "Home" || key === "End") {
    const boundaryRow = options.timelineBoundary ? (key === "Home" ? rows[0] : rows.at(-1)) : row;
    if (!boundaryRow) return target;
    if (options.timelineBoundary) return boundaryRow;
    return key === "Home" ? boundaryRow : (boundaryRow.items.at(-1) ?? boundaryRow);
  }
  if (key === "ArrowLeft") {
    if (itemIndex < 0) {
      if (!row.parentId) return row;
      return locateTimelineLogicalTarget(rows, row.parentId)?.target ?? row;
    }
    return itemIndex === 0 ? row : row.items[itemIndex - 1]!;
  }
  if (key === "ArrowRight") {
    if (itemIndex < 0) return row.items[0] ?? row;
    return row.items[itemIndex + 1] ?? target;
  }

  const direction = key === "ArrowUp" || key === "PageUp" ? -1 : 1;
  const pageKey = key === "PageUp" || key === "PageDown";
  const pageSize = options.pageSize;
  if (pageKey && (pageSize === undefined || !Number.isFinite(pageSize) || pageSize < 1)) {
    return target;
  }
  const distance = pageKey ? Math.floor(pageSize!) : 1;
  const destinationIndex = Math.max(0, Math.min(rows.length - 1, rowIndex + direction * distance));
  const destination = rows[destinationIndex];
  if (!destination || destinationIndex === rowIndex) return target;
  return target.kind === "row" ? destination : nearestTarget(destination, target.time);
}

/**
 * Preserve focus when possible, then choose previous, next, parent, or the
 * nearest surviving row. The downstream `useTimelineFocusCoordinator` hook
 * consumes this fallback when virtualization unmounts a logical target.
 */
// The ordered fallback chain is the invariant; splitting it would duplicate traversal state.
// fallow-ignore-next-line complexity
export function resolveTimelineFocusFallback(
  previousRows: readonly TimelineLogicalRow[],
  nextRows: readonly TimelineLogicalRow[],
  currentId: string,
): TimelineLogicalTarget | null {
  const unchanged = locateTimelineLogicalTarget(nextRows, currentId);
  if (unchanged) return unchanged.target;
  const previous = locateTimelineLogicalTarget(previousRows, currentId);
  if (!previous) return null;

  if (previous.itemIndex >= 0) {
    for (let index = previous.itemIndex - 1; index >= 0; index -= 1) {
      const candidate = locateTimelineLogicalTarget(nextRows, previous.row.items[index]!.id);
      if (candidate) return candidate.target;
    }
    for (let index = previous.itemIndex + 1; index < previous.row.items.length; index += 1) {
      const candidate = locateTimelineLogicalTarget(nextRows, previous.row.items[index]!.id);
      if (candidate) return candidate.target;
    }
  }

  const survivingRow = locateTimelineLogicalTarget(nextRows, previous.row.id);
  if (survivingRow) return survivingRow.target;
  if (previous.row.parentId) {
    const parent = locateTimelineLogicalTarget(nextRows, previous.row.parentId);
    if (parent) return parent.target;
  }
  return nextRows[previous.rowIndex] ?? nextRows[previous.rowIndex - 1] ?? null;
}
