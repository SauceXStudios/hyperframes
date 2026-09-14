import { parseHTML } from "linkedom";
import { parseNumeric } from "@hyperframes/parsers/composition-contract";
import { querySelectorAllIncludingTemplates } from "./domQuery.js";
import type { HyperframeLintFinding } from "./types.js";
import {
  resolveLocalMediaCandidate,
  type HtmlSourceLike,
  type MediaStreamProbeResults,
} from "./mediaStreamProbe.js";

/** One element the render will mix as an audio track. */
export interface RenderAudioSource {
  tag: "audio" | "video";
  elementId: string;
  /** The authored src as written (display value), not the resolved path. */
  src: string;
}

/**
 * Parent `src`, else a descendant `<source src>`, preferring a local path over
 * http(s) so a localized sibling wins. Mirrors the engine's
 * `resolveMediaElementSrc` (packages/engine/src/services/videoFrameExtractor.ts),
 * which the lint package cannot import without a dependency cycle.
 */
function resolveMediaElementSrc(el: Element): string | null {
  const direct = el.getAttribute("src");
  if (direct) return direct;
  let remote: string | null = null;
  for (const source of el.querySelectorAll("source")) {
    const src = source.getAttribute("src");
    if (!src) continue;
    if (!/^https?:\/\//i.test(src)) return src;
    remote ??= src;
  }
  return remote;
}

/**
 * Mirrors the engine's `isKnownInactiveTimelineWindow` (data-duration <= 0, or
 * data-end at/before the resolved start). The engine resolves a relative
 * `data-start` ("intro + 2") against the whole composition; lint cannot, so
 * when the answer depends on such a start the element is treated as unknown
 * and skipped — this rule must never flag an element the render drops.
 */
function isKnownOrPossiblyInactiveWindow(el: Element): boolean {
  const duration = parseNumeric(el.getAttribute("data-duration"));
  if (duration != null && duration <= 0) return true;
  const end = parseNumeric(el.getAttribute("data-end"));
  if (end == null) return false;
  const startAttr = el.getAttribute("data-start");
  const start = startAttr ? parseNumeric(startAttr) : 0;
  return start == null || end <= start;
}

/** The render's two audio-bearing element kinds, in the order `parseAudioElements` walks them. */
const AUDIO_SOURCE_SELECTORS = [
  ["audio", "audio[id]"],
  ["video", 'video[id][data-has-audio="true"]'],
] as const;

/**
 * Every element the render will probe for an audio stream, which is the union
 * of two gates in the producer:
 *
 *   1. The compile gate (`compileForRender` → `assertAssetMediaTypeProfile`)
 *      resolves the duration of every `audio[id]` with a positive
 *      `data-duration` and an existing local src — regardless of `data-hidden`
 *      — and throws when the file has no audio stream.
 *   2. The mixer/preflight gate (`parseAudioElements` →
 *      `preflightCompositionAssetMediaTypes`) covers the rest: `audio[id]` and
 *      `video[id][data-has-audio="true"]`, minus `data-hidden` on the element
 *      or an ancestor, minus members of a hidden `<hf-audio-group>` bus
 *      (membership is the member's `data-audio-group`, so an ancestor walk
 *      cannot see it; audio only in v1), minus known inactive timing windows.
 *
 * So a hidden `<audio>` bounded by `data-duration` is still a candidate (gate 1
 * rejects it), while a hidden `<audio>` bounded only by `data-end` is not (gate
 * 1 never sees it and gate 2 drops it). `<video data-has-audio>` is checked as
 * video by gate 1, so only gate 2's exclusions apply to it.
 *
 * Each candidate needs a resolvable src (own `src` or a `<source src>`) that is
 * an existing local file — remote and missing files are other rules' business.
 *
 * Returned map: absolute file path -> the authored elements pointing at it,
 * so a file shared by several elements is probed once and every element is
 * named in the findings.
 */
// fallow-ignore-next-line complexity
export function collectRenderAudioCandidates(
  projectDir: string,
  htmlSources: HtmlSourceLike[],
): Map<string, RenderAudioSource[]> {
  const candidates = new Map<string, RenderAudioSource[]>();

  for (const { html, compSrcPath } of htmlSources) {
    const { document } = parseHTML(html);
    const hiddenGroupIds = new Set(
      querySelectorAllIncludingTemplates(document, "hf-audio-group[data-hidden]")
        .map((group) => group.getAttribute("id"))
        .filter((id): id is string => Boolean(id)),
    );
    const sources: Array<{ el: Element; tag: RenderAudioSource["tag"] }> = [];
    for (const [tag, selector] of AUDIO_SOURCE_SELECTORS) {
      for (const el of querySelectorAllIncludingTemplates(document, selector)) {
        sources.push({ el, tag });
      }
    }

    for (const { el, tag } of sources) {
      const elementId = el.getAttribute("id");
      if (!elementId) continue;
      const compileGateProbes =
        tag === "audio" && (parseNumeric(el.getAttribute("data-duration")) ?? 0) > 0;
      if (!compileGateProbes) {
        if (el.closest("[data-hidden]")) continue;
        const groupId = tag === "audio" ? el.getAttribute("data-audio-group") : null;
        if (groupId && hiddenGroupIds.has(groupId)) continue;
        if (isKnownOrPossiblyInactiveWindow(el)) continue;
      }
      const rawSrc = resolveMediaElementSrc(el);
      if (!rawSrc) continue;
      const candidate = resolveLocalMediaCandidate(projectDir, compSrcPath, rawSrc);
      if (!candidate) continue;

      const refs = candidates.get(candidate.resolved) ?? [];
      if (!refs.some((ref) => ref.tag === tag && ref.elementId === elementId)) {
        refs.push({ tag, elementId, src: candidate.src });
      }
      candidates.set(candidate.resolved, refs);
    }
  }

  return candidates;
}

/**
 * The probe-backed half of `media_src_kind_mismatch`: the static half in
 * `rules/media.ts` classifies by extension per file; this half classifies the
 * render's audio element set by what ffprobe actually finds on disk, exactly
 * as the producer preflight does (`expected: "audio"` <=> the file has a
 * stream with `codec_type === "audio"`). Same code and severity, because it
 * is the same contract: the tag and the file's kind disagree and the render
 * fail-closes.
 *
 * A file whose probe is unknown (`null`/absent in `probes`) is never reported.
 */
export function lintRenderAudioSourceStreams(
  candidates: ReadonlyMap<string, readonly RenderAudioSource[]>,
  probes: MediaStreamProbeResults,
): HyperframeLintFinding[] {
  const findings: HyperframeLintFinding[] = [];
  for (const [filePath, refs] of candidates) {
    const streams = probes.get(filePath);
    if (!streams || streams.some((stream) => stream.codec_type === "audio")) continue;
    for (const { tag, elementId, src } of refs) {
      const attrs = tag === "video" ? ' data-has-audio="true"' : "";
      findings.push({
        code: "media_src_kind_mismatch",
        severity: "error",
        message: `<${tag} id="${elementId}"${attrs}> src "${src}" has no audio stream, so it is not audio. The producer fail-closes when the tag and file kind disagree.`,
        elementId,
        fixHint:
          tag === "audio"
            ? "Point the <audio> src at media containing an audio stream, or remove the element if no audio is intended."
            : 'Remove data-has-audio="true" from a silent <video>, or point it at media containing an audio stream.',
      });
    }
  }
  return findings;
}
