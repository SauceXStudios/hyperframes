import { buildProjectApiPath } from "../utils/projectRouting";
import { useState } from "react";
import { IMAGE_EXT, VIDEO_EXT, AUDIO_EXT } from "../utils/mediaTypes";
import { Icon } from "../icons/Icon";

function MediaErrorPanel({ name, filePath }: { name: string; filePath: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950 gap-2">
      <Icon name="warningCircle" size={20} className="text-neutral-600" />
      <span className="text-sm text-neutral-400 font-medium">{name}</span>
      <span className="text-[11px] text-neutral-600 font-mono">{filePath}</span>
      <span className="text-[10px] text-neutral-500">
        Couldn't load this file — it may be missing or corrupt
      </span>
    </div>
  );
}

export function MediaPreview({ projectId, filePath }: { projectId: string; filePath: string }) {
  const serveUrl = buildProjectApiPath(projectId, `/preview/${filePath}`);
  const name = filePath.split("/").pop() ?? filePath;
  // Keyed by path so switching to another file clears a previous failure.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = failedPath === filePath;
  const setFailed = () => setFailedPath(filePath);

  if (failed) return <MediaErrorPanel name={name} filePath={filePath} />;

  if (IMAGE_EXT.test(filePath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950">
        <img
          src={serveUrl}
          alt={name}
          onError={setFailed}
          className="max-w-full max-h-[70%] object-contain rounded border border-neutral-800"
        />
        <span className="mt-3 text-[11px] text-neutral-500 font-mono">{filePath}</span>
      </div>
    );
  }

  if (VIDEO_EXT.test(filePath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950">
        <video
          src={serveUrl}
          controls
          onError={setFailed}
          className="max-w-full max-h-[70%] rounded border border-neutral-800"
        />
        <span className="mt-3 text-[11px] text-neutral-500 font-mono">{filePath}</span>
      </div>
    );
  }

  if (AUDIO_EXT.test(filePath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950 gap-3">
        <Icon name="musicNotes" size={20} className="text-neutral-600" />
        <audio src={serveUrl} controls onError={setFailed} className="w-full max-w-[280px]" />
        <span className="text-[11px] text-neutral-500 font-mono">{filePath}</span>
      </div>
    );
  }

  // Fonts and other binary — show info instead of binary dump
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950 gap-2">
      <Icon name="file" size={20} className="text-neutral-600" />
      <span className="text-sm text-neutral-400 font-medium">{name}</span>
      <span className="text-[11px] text-neutral-600 font-mono">{filePath}</span>
      <span className="text-[10px] text-neutral-600">Binary file — preview not available</span>
    </div>
  );
}
