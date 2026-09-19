import { create } from "zustand";

interface PreviewIframeState {
  iframe: HTMLIFrameElement | null;
  setIframe: (iframe: HTMLIFrameElement | null) => void;
}

/** The one owner of "the live preview iframe element"; a promoted reload replaces it. */
export const usePreviewIframeStore = create<PreviewIframeState>((set) => ({
  iframe: null,
  setIframe: (iframe) => set({ iframe }),
}));

/** Subscribe an effect to the live iframe by listing the result in its dependencies. */
export const useLivePreviewIframe = () => usePreviewIframeStore((s) => s.iframe);
