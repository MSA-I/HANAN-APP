import { useMemo } from 'react'
import { Circle, Layer, Line, Rect } from 'react-konva'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { beamCrossings, beamSpans } from '../core/layout/beamCrossings'
import { beamGrid, snapToBeam } from '../core/layout/beams'
import { getVenuePack } from '../core/venuePacks'
import { useEditorStore } from '../state/store'
import { isLightingPlanOn, useOverlayStore } from './overlayStore'
import { useViewportStore } from './viewportStore'

/** handoff/04-plan-style.md §1 — the accent the rest of the 2D overlay already uses. */
const BEAM = '#3056d3'

/**
 * handoff/04-plan-style.md §5. Source doc §33 asks for the plan underneath to be
 * "blurred, but you can still see its context".
 *
 * ponytail: this is a half-opaque white veil, not a blur. A real
 * `Konva.Filters.Blur` needs `cache()` on a venue-sized layer every frame and
 * would freeze the drag; dimming reads the same at zero cost. Caching + blur is
 * the upgrade if it is ever actually wanted.
 */
const VEIL = 'rgba(255,255,255,0.62)'

/**
 * The lighting-planning overlay: the warp-and-weft of the ceiling truss drawn in
 * dashes over a dimmed plan, with a dot on every crossing. This is the ONLY place
 * in the app where beams are drawn at all — the 3D view shows the truss baked
 * into `venue.glb` and never reads `ceilingBeams` (AGENT-BRIEF §8.4), so the two
 * are independent representations of one truss and this one has to earn its
 * agreement with the other.
 *
 * ⚠ The lines are the point of the mode, not the dots. `snapToBeam` pins a
 * fixture to the nearest BEAM and lets it slide along that beam; it has not
 * snapped to a crossing since PLAN-05 (core/layout/beams.ts, and the string in
 * ui/strings.ts was corrected in 0aabc1f while this comment was not). The dots
 * mark where both families hold the fixture and both axes snap at once — 11 × 3 =
 * 33 of them on the resort grid, not the 9 × 4 = 36 quoted before the 2026-07-29
 * re-extraction. The same snap runs on the drop, on every 2D drag and on paste
 * (state/actions.ts), so the lines are what explain where a chandelier will go.
 *
 * ⚠ Stroke widths and dashes here are in SCREEN pixels, not world cm, because
 * `strokeScaleEnabled={false}` makes Konva stroke under an identity transform —
 * do not "fix" them by multiplying with `px`. Only sizes given as geometry (the
 * dot radii) carry the `px` conversion.
 */
export function BeamLayer() {
  const on = useOverlayStore(isLightingPlanOn)
  const venue = useEditorStore((s) => s.scene.venue.size)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const zoom = useViewportStore((s) => s.zoom)
  // Where the armed fixture would actually land. Null unless a ceiling item is
  // armed — which also keeps this from re-rendering on every mouse move while
  // some other kind of item is being placed.
  const cursor = useOverlayStore((s) => {
    if (!s.placing || !hasCatalogEntry(s.placing)) return null
    return getCatalogEntry(s.placing).placement === 'ceiling' ? s.cursorWorld : null
  })

  const beams = useMemo(() => beamGrid(getVenuePack(venuePackId), venue), [venuePackId, venue])

  const px = 1 / zoom // one screen pixel, in world cm
  // memoised so tracking the cursor re-renders nothing but the target marker
  const grid = useMemo(
    () => (
      <>
        {beamSpans(beams, venue).map((span, i) => (
          <Line
            key={`beam${i}`}
            points={[span.x1, span.y1, span.x2, span.y2]}
            stroke={BEAM}
            strokeWidth={1.4}
            strokeScaleEnabled={false}
            dash={[7, 5]}
            opacity={0.8}
          />
        ))}
        {beamCrossings(beams).map((point, i) => (
          <Circle key={`cross${i}`} x={point.x} y={point.y} radius={3.5 * px} fill={BEAM} />
        ))}
      </>
    ),
    [beams, venue, px],
  )

  // an empty Layer rather than null: the capture in Stage2D addresses layers by
  // index, so this one has to keep its slot whether the mode is on or off
  if (!on) return <Layer listening={false} />

  const target = cursor ? snapToBeam(cursor, beams) : null

  return (
    <Layer listening={false}>
      <Rect x={0} y={0} width={venue.width} height={venue.depth} fill={VEIL} />
      {grid}
      {target && (
        <Circle
          x={target.x}
          y={target.y}
          radius={9 * px}
          fill="rgba(48,86,211,0.18)"
          stroke={BEAM}
          strokeWidth={2}
          strokeScaleEnabled={false}
        />
      )}
    </Layer>
  )
}
