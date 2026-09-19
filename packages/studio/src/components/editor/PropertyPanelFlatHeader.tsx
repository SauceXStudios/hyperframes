import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { Icon } from "../../icons/Icon";

const ICON_BY_KIND = { text: "textT", media: "filmStrip", other: "square" } as const;
const ICON_COLOR_BY_KIND = {
  text: "text-panel-accent",
  media: "text-panel-media",
  other: "text-panel-container",
} as const;

export function PropertyPanelFlatHeader({
  name,
  meta,
  elementKind,
  hidden,
  onToggleHidden,
  copied,
  onCopy,
  onClear,
  onUngroup,
  showUngroup,
}: {
  name: string;
  meta: string;
  elementKind: "text" | "media" | "other";
  hidden: boolean;
  onToggleHidden?: () => void;
  copied: boolean;
  onCopy: () => void;
  onClear: () => void;
  onUngroup?: () => void;
  showUngroup: boolean;
}) {
  const track = useTrackDesignInput();
  const visibilityLabel = hidden ? "Show element" : "Hide element";

  return (
    <div className="flex items-center gap-2.5 border-b border-panel-hairline px-4 py-3">
      <Icon
        name={ICON_BY_KIND[elementKind]}
        size={16}
        data-flat-header-icon="true"
        className={`flex-shrink-0 ${ICON_COLOR_BY_KIND[elementKind]}`}
      />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-[13px] font-semibold text-panel-text-0">{name}</span>
        <span className="truncate font-mono text-[10px] text-panel-text-4">{meta}</span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2.5 text-panel-text-3">
        {showUngroup && (
          <button
            type="button"
            aria-label="Ungroup"
            title="Ungroup (⌘⇧G)"
            onClick={() => {
              track("button", "Ungroup");
              onUngroup?.();
            }}
          >
            <Icon name="intersect" size={14} />
          </button>
        )}
        {onToggleHidden && (
          <button
            type="button"
            aria-label={visibilityLabel}
            title={visibilityLabel}
            onClick={() => {
              track("toggle", "Element visibility");
              onToggleHidden();
            }}
          >
            <Icon name={hidden ? "eyeSlash" : "eye"} size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label="Copy element info to clipboard"
          title={copied ? "Copied!" : "Copy element info for any AI agent"}
          onClick={() => {
            track("button", "Copy element info");
            onCopy();
          }}
          className={copied ? "text-panel-accent" : undefined}
        >
          <Icon name="clipboardText" size={14} />
        </button>
        <button
          type="button"
          aria-label="Clear selection"
          onClick={() => {
            track("button", "Clear selection");
            onClear();
          }}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
