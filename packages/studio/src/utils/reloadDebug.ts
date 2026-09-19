// Preview full-reload diagnostics — grep [hf-reload]. Off by default; opt in per
// session with `localStorage.setItem("hf-reload-debug", "1")` (then reload).
//
// AD132/D-801: a full reload no longer blanks the stage (see
// useShadowPreviewReload.ts). These lines now answer who asked for a reload
// and why the write that triggered it was not recognised as Studio's own.
import { makeStudioDebugLogger } from "./studioDebug";

export const logReload = makeStudioDebugLogger("reload");
