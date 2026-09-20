// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";
import { useTimelineLogicalRows } from "./useTimelineLogicalRows";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type TrackInput = readonly (readonly [number, readonly TimelineElement[]])[];

const tracks: TrackInput = Array.from(
  { length: 1_000 },
  (_, track) =>
    [
      track,
      [{ id: `clip-${track}`, tag: "div", track, start: track, duration: 1 }],
    ] as const satisfies readonly [number, readonly TimelineElement[]],
);
const laneCounts = new Map<string, number>();
const selectedElementIds = new Set<string>();
const expandedClipIds = new Set<string>();
const collapsedGroupIds = new Set<string>();
const expandedLaneOwnerIds = new Set<string>();
const groups: never[] = [];
const trackGroupOf = new Map();
const gsapAnimations = new Map();

function Harness({
  snapshots,
  inputTracks = tracks,
}: {
  snapshots: Array<readonly TimelineLogicalRow[]>;
  inputTracks?: TrackInput;
}) {
  usePlayerStore((state) => state.currentTime);
  const logicalRows = useTimelineLogicalRows({
    tracks: inputTracks,
    displayTrackOrder: inputTracks.map(([track]) => track),
    laneCounts,
    selectedElementId: null,
    selectedElementIds,
    expandedClipIds,
    collapsedGroupIds,
    expandedLaneOwnerIds,
    groups,
    trackGroupOf,
    gsapAnimations,
  });
  snapshots.push(logicalRows);
  return null;
}

afterEach(() => usePlayerStore.getState().reset());

describe("useTimelineLogicalRows", () => {
  it("preserves the dense logical model across an unrelated store update", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const snapshots: Array<readonly TimelineLogicalRow[]> = [];
    act(() => root.render(<Harness snapshots={snapshots} />));
    const first = snapshots.at(-1);

    act(() => usePlayerStore.setState({ requestedSeekTime: 1 }));

    expect(snapshots.at(-1)).toBe(first);
    act(() => root.unmount());
  });

  it("keeps a nested element in one row as the playhead crosses it", () => {
    const nestedTracks = [
      [
        0,
        [
          {
            id: "nested-div",
            tag: "div",
            track: 0,
            start: 1,
            duration: 2,
            parentCompositionId: "scene",
          },
        ],
      ],
    ] as const satisfies TrackInput;
    const host = document.createElement("div");
    const root = createRoot(host);
    const snapshots: Array<readonly TimelineLogicalRow[]> = [];
    act(() => root.render(<Harness snapshots={snapshots} inputTracks={nestedTracks} />));
    const before = snapshots.at(-1);

    act(() => usePlayerStore.setState({ currentTime: 2.5 }));

    const after = snapshots.at(-1);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after?.[0]?.items).toHaveLength(1);
    expect(after?.map((row) => row.id)).toEqual(before?.map((row) => row.id));
    act(() => root.unmount());
  });
});
