import { Icon, type IconName } from "../../icons/Icon";

const FILE_ICON_BY_EXT: Record<string, readonly [IconName, string]> = {
  html: ["fileHtml", "#E44D26"],
  css: ["fileCss", "#264DE4"],
  js: ["fileJs", "#F0DB4F"],
  mjs: ["fileJs", "#F0DB4F"],
  cjs: ["fileJs", "#F0DB4F"],
  jsx: ["fileJsx", "#61DAFB"],
  ts: ["fileTs", "#3178C6"],
  mts: ["fileTs", "#3178C6"],
  tsx: ["fileTsx", "#3178C6"],
  json: ["fileCode", "#4ADE80"],
  svg: ["fileSvg", "#F97316"],
  md: ["fileMd", "#9CA3AF"],
  mdx: ["fileMd", "#9CA3AF"],
  txt: ["fileTxt", "#9CA3AF"],
  png: ["filePng", "#22C55E"],
  jpg: ["fileJpg", "#22C55E"],
  jpeg: ["fileJpg", "#22C55E"],
  webp: ["image", "#22C55E"],
  gif: ["image", "#22C55E"],
  ico: ["image", "#22C55E"],
  mp4: ["fileVideo", "#A855F7"],
  webm: ["fileVideo", "#A855F7"],
  mov: ["fileVideo", "#A855F7"],
  mp3: ["waveform", "#3CE6AC"],
  wav: ["waveform", "#3CE6AC"],
  ogg: ["waveform", "#3CE6AC"],
  m4a: ["waveform", "#3CE6AC"],
  woff: ["textAa", "#6B7280"],
  woff2: ["textAa", "#6B7280"],
  ttf: ["textAa", "#6B7280"],
  otf: ["textAa", "#6B7280"],
};

export function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const [name, color] = Object.hasOwn(FILE_ICON_BY_EXT, ext)
    ? FILE_ICON_BY_EXT[ext]
    : (["file", "#6B7280"] as const);
  return <Icon name={name} size={14} className="flex-shrink-0" style={{ color }} />;
}

// ── Tree Types ──

export interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetIsFolder: boolean;
}

export interface InlineInputState {
  /** Parent folder path (empty string for root) */
  parentPath: string;
  /** "file" or "folder" creation, or "rename" */
  mode: "new-file" | "new-folder" | "rename";
  /** For rename mode, the original full path */
  originalPath?: string;
  /** For rename mode, the original name */
  originalName?: string;
  onCommit?: (name: string) => void;
  onCancel?: () => void;
}

// ── Tree Helpers ──

export function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map(), isFile: false };
  for (const file of files) {
    const parts = file.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
          isFile: isLast,
        });
      }
      current = current.children.get(part)!;
      if (isLast) current.isFile = true;
    }
  }
  return root;
}

export function sortChildren(children: Map<string, TreeNode>): TreeNode[] {
  return Array.from(children.values()).sort((a, b) => {
    // index.html always first
    if (a.name === "index.html") return -1;
    if (b.name === "index.html") return 1;
    // Directories before files
    if (!a.isFile && b.isFile) return -1;
    if (a.isFile && !b.isFile) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function isActiveInSubtree(node: TreeNode, activeFile: string | null): boolean {
  if (!activeFile) return false;
  if (node.fullPath === activeFile) return true;
  for (const child of node.children.values()) {
    if (isActiveInSubtree(child, activeFile)) return true;
  }
  return false;
}
