import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import type { DomEditSelection } from "./domEditingTypes";
import { Icon } from "../../icons/Icon";

/** The action buttons in the inspector header: visibility, Ungroup (groups only), copy, clear. */
export function InspectorHeaderActions({
  element,
  copied,
  onCopy,
  onClear,
  onUngroup,
  selectedElementId,
  selectedElementHidden,
  visibilityLabel,
  onToggleHidden,
}: {
  element: DomEditSelection;
  copied: boolean;
  onCopy: () => void;
  onClear: () => void;
  onUngroup?: () => void;
  selectedElementId?: string | null;
  selectedElementHidden?: boolean;
  visibilityLabel?: string;
  onToggleHidden?: (id: string, hidden: boolean) => void;
}) {
  const track = useTrackDesignInput();
  return (
    <div className="flex items-center gap-1">
      {selectedElementId && onToggleHidden && (
        <button
          type="button"
          aria-label={visibilityLabel}
          title={visibilityLabel}
          onClick={() => {
            track("toggle", "Element visibility");
            void onToggleHidden(selectedElementId, !selectedElementHidden);
          }}
          className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
        >
          {selectedElementHidden ? (
            <Icon name="eyeSlash" size={14} />
          ) : (
            <Icon name="eye" size={14} />
          )}
        </button>
      )}
      {onUngroup && element.dataAttributes["hf-group"] != null && (
        <button
          type="button"
          onClick={() => {
            track("button", "Ungroup");
            onUngroup();
          }}
          title="Ungroup (⌘⇧G)"
          className="flex h-6 items-center rounded px-2 text-[11px] font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
        >
          Ungroup
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          track("button", "Copy element info");
          onCopy();
        }}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
          copied
            ? "text-studio-accent"
            : "text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
        }`}
        title={copied ? "Copied!" : "Copy element info to clipboard"}
      >
        <Icon name="copy" size={14} />
      </button>
      <button
        type="button"
        aria-label="Clear selection"
        onClick={() => {
          track("button", "Clear selection");
          onClear();
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
