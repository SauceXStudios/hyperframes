import { useCallback, useRef } from "react";
import { trackStudioPendingEdit } from "../utils/studioPendingEdits";

type AsyncFn = (...args: never[]) => Promise<unknown>;

/**
 * Wraps a hand-edit handler so its write is added to Studio's shared
 * pending-edit registry (utils/studioPendingEdits.ts) — the same one
 * waitForPendingDomEditSaves already drains before undo/redo runs. Without
 * this, undo/redo can only see edits that had already reached history,
 * so an undo fired while a delete/move/resize/etc. is still in flight finds
 * no entry yet and the edit is lost with nothing to restore it.
 *
 * Returns the same wrapper for the same `fn` across renders, so a caller
 * using a tracked handler as a memo or effect dependency stays stable.
 */
export function useTrackPendingTimelineEdit() {
  const wrappedRef = useRef(new WeakMap<AsyncFn, AsyncFn>());
  return useCallback(<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) => {
    const key = fn as unknown as AsyncFn;
    const cached = wrappedRef.current.get(key);
    if (cached) return cached as unknown as (...args: Args) => Promise<R>;
    const wrapped = (...args: Args): Promise<R> => {
      const result = fn(...args);
      trackStudioPendingEdit(result);
      return result;
    };
    wrappedRef.current.set(key, wrapped as unknown as AsyncFn);
    return wrapped;
  }, []);
}
