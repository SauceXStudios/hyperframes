const COUNTS_KEY = "__timelineRenderCounts";

export function countTimelineRender(name: string): void {
  if (typeof window === "undefined") return;
  const target = window as typeof window & {
    [COUNTS_KEY]?: Record<string, number>;
  };
  const counts = (target[COUNTS_KEY] ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}
