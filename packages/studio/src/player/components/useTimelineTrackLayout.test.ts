// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { TRACK_H } from "./timelineLayout";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
import { resolveTrackKeyframeClip, useTimelineTrackLayout } from "./useTimelineTrackLayout";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.getState().reset();
});

describe("collapsed audio groups", () => {
  const member = (id: string, track: number): TimelineElement => ({
    id,
    domId: id,
    tag: "audio",
    start: 0,
    duration: 5,
    track,
    audioGroup: "voiceover",
  });

  /** `collapsed` seeds the collapsed set — expanded is the default state. */
  function renderGrouped(collapsed = false): {
    layout: ReturnType<typeof useTimelineTrackLayout>;
    unmount: () => void;
  } {
    if (collapsed) usePlayerStore.setState({ collapsedGroupIds: new Set(["voiceover"]) });
    const elements = [member("voice-1", 0), member("voice-2", 1)];
    let layout: ReturnType<typeof useTimelineTrackLayout> | undefined;
    function Probe() {
      layout = useTimelineTrackLayout(elements, new Map());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Probe)));
    if (!layout) throw new Error("Timeline track layout did not render");
    return { layout, unmount: () => act(() => root.unmount()) };
  }

  // The `∿` area holds the group's own automation rows. Sized without them,
  // every lane the count had just promised was clipped out of the row — which
  // is what "expanding automation on a group doesn't show the automation"
  // looked like from outside.
  it("reserves room for the group's own automation rows, not just the strip", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 1 },
            { t: 5, v: 0.4 },
          ],
        },
      ],
    });
    const elements = [
      { ...member("voice-1", 0), audioGroupAutomation: automation },
      { ...member("voice-2", 1), audioGroupAutomation: automation },
    ];
    let layout: ReturnType<typeof useTimelineTrackLayout> | undefined;
    function Probe() {
      layout = useTimelineTrackLayout(elements, new Map());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => {
      usePlayerStore.setState({ expandedLaneOwnerIds: new Set(["voiceover"]) });
      root.render(React.createElement(Probe));
    });
    // The group's anchor row: the first member track minus 0.5.
    const anchorIndex = layout!.tracks.findIndex(([track]) => track === -0.5);
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    const openHeight = layout!.rowHeights[anchorIndex];
    // One lane of headroom beyond the header row itself.
    expect(openHeight).toBe(TRACK_H + AUTOMATION_LANE_H);
    act(() => root.unmount());
  });

  // buildTimelineLogicalRows stops emitting member rows once a group is
  // collapsed, so TimelineLanes renders null for them. Rows left in `tracks`
  // still reserve height, turning that null into visible dead space — the row
  // list and the logical rows have to agree.
  it("emits only the anchor row while the group is collapsed", () => {
    const { layout, unmount } = renderGrouped(true);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]!.memberTracks).toEqual([0, 1]);
    // The anchor (0 - 0.5) and nothing else.
    expect(layout.trackOrder).toEqual([-0.5]);
    expect(layout.rowGeometry.rowHeights).toHaveLength(1);
    // Membership still resolves — collapsed is hidden, not ungrouped.
    expect(layout.trackGroupOf.get(0)?.id).toBe("voiceover");
    unmount();
  });

  // Membership is not a display concern. Half-lit solo, the automation-lane
  // count and the bus strip's member labels all read the group's members, and
  // all three silently degraded to empty when those were recovered from the
  // display list — which a collapsed group does not appear in. Collapsed is the
  // default, so that was every group until someone opened it.
  it("carries its member elements even while collapsed", () => {
    const { layout, unmount } = renderGrouped(true);
    expect(layout.trackOrder).toEqual([-0.5]); // collapsed: no member rows
    expect(layout.groups[0]!.memberElements.map((el) => el.id)).toEqual(["voice-1", "voice-2"]);
    unmount();
  });

  // The reason the set is stored inverted. As an expanded-set, "absent" could
  // not tell never-touched from deliberately-collapsed, so a freshly created
  // group started collapsed — grouping three tracks made all three vanish
  // behind a header the user had not yet learned to open.
  it("is expanded by default, with nothing seeded", () => {
    const { layout, unmount } = renderGrouped();
    expect(usePlayerStore.getState().collapsedGroupIds.size).toBe(0);
    expect(layout.trackOrder).toEqual([-0.5, 0, 1]);
    unmount();
  });

  it("emits the member rows once the group is expanded", () => {
    // Expanded is the default now — nothing to seed.
    const { layout, unmount } = renderGrouped();
    expect(layout.trackOrder).toEqual([-0.5, 0, 1]);
    for (const track of layout.groups[0]!.memberTracks) {
      expect(layout.rowGeometry.getRowHeight(layout.rowGeometry.getRowIndex(track))).toBe(TRACK_H);
    }
    unmount();
  });
});

const audioClip = (id: string, over: Partial<TimelineElement> = {}): TimelineElement => ({
  id,
  key: id,
  tag: "audio",
  start: 0,
  duration: 10,
  track: 10,
  ...over,
});

describe("resolveTrackKeyframeClip", () => {
  const none = new Map<string, number>();

  it("picks an audio clip that has only automation, no tweens", () => {
    // Gating on tweens alone left an audio clip's envelopes unreachable: no
    // clip resolved, so the track got no caret, no height and no lanes.
    const bgm = audioClip("bgm");
    const picked = resolveTrackKeyframeClip([bgm], none, null, new Set(), () => 1);
    expect(picked).toBe(bgm);
  });

  it("still resolves nothing when a clip has neither", () => {
    expect(resolveTrackKeyframeClip([audioClip("bgm")], none, null, new Set(), () => 0)).toBeNull();
  });

  it("prefers the selected clip over the one with more to show", () => {
    const a = audioClip("a");
    const b = audioClip("b");
    const picked = resolveTrackKeyframeClip([a, b], new Map([["b", 4]]), "a", new Set(), (e) =>
      e.id === "a" ? 1 : 0,
    );
    expect(picked).toBe(a);
  });

  it("counts tweens and automation together when breaking a tie", () => {
    const a = audioClip("a");
    const b = audioClip("b");
    const picked = resolveTrackKeyframeClip(
      [a, b],
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
      null,
      new Set(),
      (e) => (e.id === "b" ? 3 : 0),
    );
    expect(picked).toBe(b);
  });
});

describe("audio lane row height", () => {
  it("stays open when selection moves to a sibling on the same track", () => {
    const automation = JSON.stringify({
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
    });
    const elements = [
      audioClip("narration-1", { track: 0, automation }),
      audioClip("narration-2", { track: 0, automation }),
    ];
    usePlayerStore.setState({ expandedLaneOwnerIds: new Set(["narration-1", "narration-2"]) });
    let layout: ReturnType<typeof useTimelineTrackLayout> | undefined;
    function Probe() {
      layout = useTimelineTrackLayout(elements, new Map());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(React.createElement(Probe)));
    const firstHeight = layout!.rowHeights[0];

    act(() => {
      usePlayerStore.setState({ selectedElementId: "narration-2" });
      root.render(React.createElement(Probe));
    });

    expect(firstHeight).toBe(TRACK_H + AUTOMATION_LANE_H);
    expect(layout!.rowHeights[0]).toBe(firstHeight);
    act(() => root.unmount());
  });
});
