import type { StoreApi } from "zustand";

export interface TimelineTimeRange {
  t0: number;
  t1: number;
}

export interface RangeSelectionSlice {
  /** Shift-drag ruler range (seconds, t0 <= t1). Read-only for hosts; written only by usePublishRangeSelection. */
  rangeSelection: TimelineTimeRange | null;
  setRangeSelection: (range: TimelineTimeRange | null) => void;
}

export function createRangeSelectionSlice(
  set: StoreApi<RangeSelectionSlice>["setState"],
): RangeSelectionSlice {
  return {
    rangeSelection: null,
    setRangeSelection: (range) => set({ rangeSelection: range }),
  };
}
