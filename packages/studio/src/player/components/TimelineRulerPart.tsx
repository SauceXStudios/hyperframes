import { TimelineRuler as TimelineRulerImpl } from "./TimelineRuler";
import { useTimelineContext } from "./TimelineProvider";
import { countTimelineRender } from "./timelineRenderCounter";

export function TimelineRulerPart() {
  countTimelineRender("TimelineRuler");
  const { state } = useTimelineContext();
  const props = state.canvas;
  return (
    <TimelineRulerImpl
      major={props.major}
      minor={props.minor}
      pps={props.pps}
      trackContentWidth={props.trackContentWidth}
      totalH={props.totalH}
      effectiveDuration={props.effectiveDuration}
      majorTickInterval={props.majorTickInterval}
      theme={props.theme}
      beatAnalysis={props.beatAnalysis}
      contentOrigin={props.contentOrigin}
      renderTimeRange={props.rowsVirtualized ? props.renderTimeRange : undefined}
    />
  );
}
