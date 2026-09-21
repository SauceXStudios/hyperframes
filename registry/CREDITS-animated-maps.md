# Credits - Animated Maps pack

Inspired by the Animated Maps collection at Moving Image Archive
(https://www.movingimagearchive.com/collection/animated-maps).
Not affiliated; footage not included. Original HyperFrames GSAP/HTML compositions only.

## Items

- `map-route-draw` - route line stroke draw-on
- `map-territory-wipe` - territory/region fill wipe
- `map-city-pins` - labeled city pins (pop/stagger)
- `map-region-zoom` - grid overlay + camera zoom
- `map-campaign-arrows` - sequential schematic campaign arrows
- `map-front-line-crawl` - dashed battle/front line crawl
- `map-ink-blot-soak` - ink/blot territory soak
- `map-shipping-lanes` - sea/shipping lane dotted path
- `map-globe-inset` - inset rotating globe + main map
- `map-stamp-labels` - stamp/typewriter location labels
- `map-border-chase` - border highlight chase
- `map-radar-rings` - concentric radar/range rings
- `map-boundary-morph` - crossfade/simplified SVG historical boundary morph
- `map-compass-scale` - compass rose + scale bar reveal
- `map-itinerary-stops` - multi-stop itinerary with numbered markers
- `map-hotspot-pulse` - heat pulse / hotspot blink
- `map-parchment-fold` - paper-map fold / parchment aesthetic
- `map-split-theater` - split-screen two-theater maps
- `map-arrow-fanout` - arrow swarm / advance fan-out
- `map-grid-crosshair` - lat-long grid draw + crosshair lock
- `map-isoline-reveal` - isoline/contour reveal
- `map-conquest-fill-sequence` - sequential region conquest fill
- `map-legend-build` - legend panel assemble

## map-globe-inset (REHOLD 2026-09-21)

Miguel rejected CEILING_ONLY ports on #4237. Reverted to pre-port baseline SVG. Ungated until Lead+judge QC_PASS. No CEILING_ONLY without Miguel OK.

## map-arrow-fanout (REHOLD 2026-09-21)

Miguel rejected CEILING_ONLY ports on #4237. Reverted to pre-port baseline SVG. Ungated until Lead+judge QC_PASS. No CEILING_ONLY without Miguel OK.

## map-territory-wipe (REHOLD 2026-09-21)

Miguel rejected CEILING_ONLY port look on #4237. Reverted to pre-port baseline SVG. Ungated again until Lead re-gates with Miguel OK.

## map-shipping-lanes (QC_PASS 2026-09-20)

Source: Moving Image Archive, City Water Supply, 1941.
Ported from `reversals/mia-maps/shipping-lanes/recreate/` with topo plate externalized to `assets/topo-plate.png` (no base64 blob; no MP4 wrapper).
Ceilings: live open stand-ins, grain/weave, DEM sharpness, tunnel micro-breaks, hidden credit.

## map-border-chase (QC_PASS 2026-09-21)

Source inspiration: Moving Image Archive animated-map clip map-border-chase (Alaska Highway).
Ported from `reversals/mia-maps/border-chase/recreate/hf-project/compositions/map-border-chase.html` + `public/basemap-t0.png` (still plate, not MP4).

## map-radar-rings (QC_PASS 2026-09-21 pass8j-closer)

Source: Moving Image Archive, Network Broadcasting, 1934 (clip bbdd60a1-a3f6-5d22-8953-3419f5a17afd; IA 0809_Network_Broadcasting_02_01_12_00).
Ported from `reversals/mia-maps/radar-rings/recreate/` (hold-plate.png + measured GSAP rings). No MP4 wrapper. Lead + independent judge PASS.
