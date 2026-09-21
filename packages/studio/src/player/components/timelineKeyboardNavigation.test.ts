import type { GsapAnimation, PropertyGroupName } from "@hyperframes/core/gsap-parser";
import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  buildTimelineLogicalRows,
  resolveTimelineFocusFallback,
  resolveTimelineNavigationTarget,
} from "./timelineKeyboardNavigation";
import { timelineClipFocusId, timelineTrackRowId } from "./timelineNavigationIdentity";

function clip(id: string, track: number, start: number, duration = 2): TimelineElement {
  return { id, track, start, duration, tag: "div" };
}

function fallbackTracks(firstTrack: TimelineElement[]): [number, TimelineElement[]][] {
  return [
    [1, firstTrack],
    [2, []],
    [3, [clip("right", 3, 18), clip("left", 3, 2)]],
  ];
}

function animation(
  id: string,
  group: PropertyGroupName,
  percentages: readonly number[],
  resolvedStart = 10,
): GsapAnimation {
  return {
    id,
    targetSelector: "#active",
    method: "to",
    position: 0,
    resolvedStart,
    duration: 10,
    properties: {},
    propertyGroup: group,
    keyframes: {
      format: "percentage",
      keyframes: percentages.map((percentage) => ({
        percentage,
        properties: group === "position" ? { x: percentage } : { opacity: percentage / 100 },
      })),
    },
  };
}

function model(overrides: Partial<Parameters<typeof buildTimelineLogicalRows>[0]> = {}) {
  const active = clip("active", 1, 10, 10);
  return buildTimelineLogicalRows({
    tracks: [
      [1, [clip("late", 1, 20), active, clip("early", 1, 0)]],
      [2, []],
      [3, [clip("right", 3, 18), clip("left", 3, 2)]],
    ],
    displayTrackOrder: [1, 2, 3],
    laneCounts: new Map([["active", 2]]),
    selectedElementId: "active",
    selectedElementIds: new Set(),
    collapsedGroupIds: new Set(),
    expandedLaneOwnerIds: new Set(),
    groups: [],
    trackGroupOf: new Map(),
    gsapAnimations: new Map([
      [
        "active",
        [animation("position", "position", [0, 50, 100]), animation("visual", "visual", [25, 75])],
      ],
    ]),
    ...overrides,
  });
}

describe("buildTimelineLogicalRows", () => {
});

describe("resolveTimelineNavigationTarget", () => {
  it("navigates horizontal items plus row Home and End", () => {
    const rows = model();
    const activeId = timelineClipFocusId("active");

    expect(resolveTimelineNavigationTarget(rows, activeId, "ArrowLeft")?.id).toBe(
      timelineClipFocusId("early"),
    );
    expect(resolveTimelineNavigationTarget(rows, activeId, "ArrowRight")?.id).toBe(
      timelineClipFocusId("late"),
    );
    expect(resolveTimelineNavigationTarget(rows, timelineTrackRowId(1), "ArrowLeft")?.id).toBe(
      timelineTrackRowId(1),
    );
    expect(
      resolveTimelineNavigationTarget(rows, timelineClipFocusId("late"), "ArrowRight")?.id,
    ).toBe(timelineClipFocusId("late"));
    expect(resolveTimelineNavigationTarget(rows, timelineTrackRowId(1), "ArrowRight")?.id).toBe(
      timelineClipFocusId("early"),
    );
    expect(
      resolveTimelineNavigationTarget(rows, timelineClipFocusId("early"), "ArrowLeft")?.id,
    ).toBe(timelineTrackRowId(1));
    expect(resolveTimelineNavigationTarget(rows, activeId, "Home")?.id).toBe(timelineTrackRowId(1));
    expect(resolveTimelineNavigationTarget(rows, timelineTrackRowId(1), "End")?.id).toBe(
      timelineClipFocusId("late"),
    );
  });


  it("supports modified Home and End across the whole logical model", () => {
    const rows = model();
    const current = timelineTrackRowId(2);

    expect(
      resolveTimelineNavigationTarget(rows, current, "Home", { timelineBoundary: true })?.id,
    ).toBe(timelineTrackRowId(1));
    expect(
      resolveTimelineNavigationTarget(rows, current, "End", { timelineBoundary: true })?.id,
    ).toBe(timelineTrackRowId(3));
  });


  it("breaks equal-distance vertical ties by time then stable identity", () => {
    const rows = buildTimelineLogicalRows({
      tracks: [
        [1, [clip("current", 1, 9, 2)]],
        [2, [clip("later", 2, 14, 2), clip("earlier-z", 2, 4, 2), clip("earlier-a", 2, 4, 2)]],
      ],
      displayTrackOrder: [1, 2],
      laneCounts: new Map(),
      selectedElementId: null,
      selectedElementIds: new Set(),
      collapsedGroupIds: new Set(),
      expandedLaneOwnerIds: new Set(),
      groups: [],
      trackGroupOf: new Map(),
      gsapAnimations: new Map(),
    });

    expect(
      resolveTimelineNavigationTarget(rows, timelineClipFocusId("current"), "ArrowDown")?.id,
    ).toBe(timelineClipFocusId("earlier-a"));
  });
});

describe("resolveTimelineFocusFallback", () => {
  it("chooses previous, then next, then the containing row after deletion", () => {
    const before = model();
    const withoutActive = model({
      tracks: fallbackTracks([clip("early", 1, 0), clip("late", 1, 20)]),
    });
    expect(
      resolveTimelineFocusFallback(before, withoutActive, timelineClipFocusId("active"))?.id,
    ).toBe(timelineClipFocusId("early"));

    const onlyNext = model({
      tracks: fallbackTracks([clip("late", 1, 20)]),
    });
    expect(resolveTimelineFocusFallback(before, onlyNext, timelineClipFocusId("active"))?.id).toBe(
      timelineClipFocusId("late"),
    );

    const onlyActive = model({
      tracks: [[1, [clip("active", 1, 10, 10)]]],
      displayTrackOrder: [1],
    });
    const empty = model({
      tracks: [[1, []]],
      displayTrackOrder: [1],
    });
    expect(resolveTimelineFocusFallback(onlyActive, empty, timelineClipFocusId("active"))?.id).toBe(
      timelineTrackRowId(1),
    );
  });

  it("returns null for an identity absent from the previous model", () => {
    expect(resolveTimelineFocusFallback(model(), model(), "missing")).toBeNull();
  });
});
