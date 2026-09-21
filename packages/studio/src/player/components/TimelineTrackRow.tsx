import type { ReactNode } from "react";
import type { TimelineLogicalRow } from "./timelineKeyboardNavigation";

interface TimelineTrackRowProps {
  index: number;
  rowKey: number;
  logicalRow: TimelineLogicalRow;
  top: number;
  height: number;
  virtualized: boolean;
  background: string;
  borderColor: string;
  rovingTargetId?: string | null;
  children: ReactNode;
}

/** Accessible row shell; edit geometry owns its exact top and height. */
export function TimelineTrackRow({
  index,
  rowKey,
  logicalRow,
  top,
  height,
  virtualized,
  background,
  borderColor,
  rovingTargetId = null,
  children,
}: TimelineTrackRowProps) {
  return (
    <div
      role="rowgroup"
      data-index={index}
      data-timeline-row={index}
      data-timeline-row-key={rowKey}
      className={virtualized ? "absolute left-0 right-0" : "relative"}
      style={{
        top: virtualized ? top : undefined,
        height,
        background,
        borderBottom: `1px solid ${borderColor}`,
      }}
    >
      <div
        role="row"
        aria-rowindex={logicalRow.logicalIndex + 1}
        aria-level={logicalRow.level}
        aria-expanded={logicalRow.expandable ? logicalRow.expanded : undefined}
        data-timeline-logical-row-id={logicalRow.id}
        data-timeline-focus-id={logicalRow.id}
        tabIndex={rovingTargetId === logicalRow.id ? 0 : -1}
        className="flex"
        style={{ height }}
      >
        {children}
      </div>
    </div>
  );
}
