import { useEffect, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import type { TimelineTimeRange } from "../store/rangeSelectionSlice";
import type { TimelineRangeSelection } from "./timelineEditing";

/** Mirrors the gesture's range into usePlayerStore.rangeSelection (t0 <= t1) and notifies the host. */
export function usePublishRangeSelection(
  rangeSelection: TimelineRangeSelection | null,
  onRangeSelect?: (range: TimelineTimeRange | null) => void,
) {
  const onRangeSelectRef = useRef(onRangeSelect);
  onRangeSelectRef.current = onRangeSelect;
  useEffect(() => {
    const range = rangeSelection
      ? {
          t0: Math.min(rangeSelection.start, rangeSelection.end),
          t1: Math.max(rangeSelection.start, rangeSelection.end),
        }
      : null;
    const store = usePlayerStore.getState();
    const current = store.rangeSelection;
    if (current?.t0 === range?.t0 && current?.t1 === range?.t1) return;
    store.setRangeSelection(range);
    onRangeSelectRef.current?.(range);
  }, [rangeSelection]);
  useEffect(() => () => usePlayerStore.getState().setRangeSelection(null), []);
}
