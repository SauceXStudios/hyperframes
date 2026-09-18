// NLE Layout
export { EditorShell } from "./components/EditorShell";
export type { EditorShellProps } from "./components/EditorShell";
export { NLEPreview } from "./components/nle/NLEPreview";
export { CompositionBreadcrumb } from "./components/nle/CompositionBreadcrumb";
export type { CompositionLevel } from "./components/nle/CompositionBreadcrumb";

// Shell pieces (D-776 am.5: mounted in-tree by a host, no iframe)
export { StudioLeftSidebar } from "./components/StudioLeftSidebar";
export type { StudioLeftSidebarProps } from "./components/StudioLeftSidebar";
export { PreviewPane } from "./components/nle/PreviewPane";
export type { PreviewPaneProps } from "./components/nle/PreviewPane";
export { StudioRightPanel } from "./components/StudioRightPanel";
export type { StudioRightPanelProps } from "./components/StudioRightPanel";
export { TimelinePane } from "./components/nle/TimelinePane";
export type { TimelinePaneProps } from "./components/nle/TimelinePane";

// Session providers a host mounts the shell pieces inside — see CONTRACTS.md
export { PanelLayoutProvider, usePanelLayoutContext } from "./contexts/PanelLayoutContext";
export { StudioShellProvider, useStudioShellContext } from "./contexts/StudioContext";
export { FileManagerProvider, useFileManagerContext } from "./contexts/FileManagerContext";
export { DomEditProvider, useDomEditSelectionContext } from "./contexts/DomEditContext";
export type { DomEditSelectionValue } from "./contexts/DomEditContext";
export type { DomEditSelection } from "./components/editor/domEditingTypes";

// Player (preview, timeline, playback controls)
export {
  Player,
  PlayerControls,
  Timeline,
  VideoThumbnail,
  CompositionThumbnail,
  useTimelinePlayer,
  resolveIframe,
  usePlayerStore,
  liveTime,
  formatTime,
} from "./player";
export type { TimelineElement } from "./player";

// Editor
export { SourceEditor } from "./components/editor/SourceEditor";
export { PropertyPanel } from "./components/editor/PropertyPanel";
export { FileTree } from "./components/editor/FileTree";

// App
export { StudioApp } from "./App";

// Hooks
export { useElementPicker } from "./hooks/useElementPicker";
export type { PickedElement } from "./hooks/useElementPicker";

// Utilities
export { resolveSourceFile, applyPatch } from "./utils/sourcePatcher";
export type { PatchOperation } from "./utils/sourcePatcher";
export { parseStyleString, mergeStyleIntoTag, findElementBlock } from "./utils/htmlEditor";
