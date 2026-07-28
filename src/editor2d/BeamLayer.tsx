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
 * dashes over a dimmed plan, with a dot on every crossing.
 *
 * The dots are the point of the mode. `snapToBeam` pins a fixture to a CROSSING
 * and not to the nearest beam (core/layout/beams.ts), and the same snap runs on
 * the drop, on every 2D drag and on paste (state/actions.ts) — so without them
 * the chandelier looks like it jumps for no reason. On the resort grid there are
 * 9 × 4 = 36 of them.
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
