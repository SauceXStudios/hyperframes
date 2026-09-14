// In-page motion sampler for `hyperframes inspect` motion verification (#1437).
// Runs inside the seeked, paused page (via page.evaluate). For each asserted
// selector it returns this frame's { rect, opacity, visible }; for each liveness
// scope it returns a bucketed signature of all visible elements, so the Node-side
// evaluator can detect frozen windows by comparing signatures across frames.
(function () {
  // Visibility, opacity, and the liveness signature all come from the shared
  // motion classifier so this sampler and the frozen-sweep guard can never
  // disagree on what counts as motion (see motion-signature.browser.js).
  const shared = window.__hyperframesMotionSignature;
  if (!shared) {
    throw new Error("motion-signature.browser.js must be injected before motion-sample.browser.js");
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function toRect(rect) {
    return {
      left: round(rect.left),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      width: round(rect.width),
      height: round(rect.height),
    };
  }

  function sampleElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      rect: toRect(rect),
      opacity: round(shared.opacityChain(element)),
      visible: shared.isVisibleElement(element),
    };
  }

  function safeQuery(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function sampleSelectors(selectors) {
    const data = {};
    for (const selector of selectors) {
      // Multi-match selectors are rejected before this point by findAmbiguousSelectors
      // in layout.ts; querySelector is safe here.
      const element = safeQuery(selector);
      data[selector] = element ? sampleElement(element) : null;
    }
    return data;
  }

  function sampleLiveness(scopes) {
    const liveness = {};
    for (const scope of scopes) {
      const root = scope === "*" ? shared.compositionRoot() : safeQuery(scope);
      // ponytail: O(DOM) × MOTION_MAX_SAMPLES (300), with three computed-style
      // reads (element + ::before/::after) plus an ancestor walk per box-generating
      // element — fine for typical compositions; narrow the scope if heavy-DOM
      // compositions slow down.
      liveness[scope] = shared.compositionSignature(root, { quantize: true });
    }
    return liveness;
  }

  window.__hyperframesMotionSample = function motionSample(options) {
    const { selectors = [], livenessScopes = [] } = options || {};
    return { data: sampleSelectors(selectors), liveness: sampleLiveness(livenessScopes) };
  };
})();
