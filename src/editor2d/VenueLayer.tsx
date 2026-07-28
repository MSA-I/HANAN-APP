/**
 * The building, drawn as an architect draws it (source doc §28: "it looks like a
 * pile of shapes and colours — the surroundings should look like an
 * architectural plan section, same for the reception area").
 *
 * The rule the whole layer follows: THE BUILDING IS THE DARK THING and the
 * contents are the light thing. The wall is a filled band of real thickness
 * (poché), furniture is a thin outline, and line weight is a hierarchy — wall
 * over zone over furniture. The full contract, which PLAN-07 also reads so that
 * design mode matches: HANAN-APP-DOCS/Plans/R2/handoff/04-plan-style.md.
 *
 * ⚠ ONE part of that contract was reversed by the user on 2026-07-28: zones are
 * a soft tint again, not a hatch. The reasoning is with `ZONE_TINT` below. The
 * handoff document still describes the hatch version — read the code, not it.
 */
import { Fragment } from 'react'
import { Group, Layer, Line, Rect, Text } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { isZoneOccupied } from '../core/layout/zoneOccupancy'
import { formatElevation, LABEL_ELEVATION_HEIGHT, zoneLabelBoxes, type ZoneLabelBox } from '../core/layout/zoneLabels'
import type { Vec2 } from '../core/model/types'
import { venueOutline } from '../core/venueOutline'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import { isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { strings } from '../ui/strings'

const PAPER = '#ffffff'
const WALL = '#2b2724'
const FLOOR_AREA_STROKE = '#cfc9c1'
const LABEL_TEXT = '#4a443e'
const LABEL_BG = 'rgba(255,255,255,0.82)'
const LEVEL_TEXT = '#6b635a'

/**
 * cm. The wall is stroked ON the floor contour, so it straddles it: 10 cm of it
 * eats into the room and 10 cm stands outside. At 6051 cm across that is not
 * visible, and offsetting the polygon outward is a lot of machinery for it.
 *
 * ponytail: invented number. `VenuePack` carries no wall thickness — the venue
 * GLB has the walls as baked geometry and extract-zones.mjs only reads the
 * ZONE_* floor markers. The right home is a `wallThickness` field on VenuePack
 * (PLAN-01) once someone measures it in the SketchUp model; until then every
 * pack draws a 20 cm wall.
 */
const WALL_THICKNESS = 20

const LABEL_FONT_SIZE = 44
const LEVEL_FONT_SIZE = 30

/** dimmed side of the hall/reception toggle (source doc §18). ObjectsLayer dims
 *  the furniture standing on the far side to the same value — one number. */
export const ZONE_OFF_OPACITY = 0.28

interface ZoneTint {
  fill: string
  stroke: string
}

/**
 * One soft tint per zone kind. Hue carries the identity, the way it did before
 * the plan restyle — blue is the pool, pink the ceremony, violet the dance floor
 * — so the plan is read by colour and not by decoding a pattern legend.
 *
 * These replaced a set of hatch fills. Hatching is the correct architectural
 * convention and it is what §28 asked for, but at hall zoom the floor became one
 * field of texture with no way to tell two zones apart at a glance, so the user
 * asked for the colour back (2026-07-28). What is kept from the restyle is
 * everything ELSE about it: the wall is still poché at real thickness, furniture
 * is still a thin outline, and the line-weight hierarchy still runs wall over
 * zone over furniture.
 *
 * Both values are deliberately weak. The fills sit a few percent off the paper
 * and the strokes are desaturated to roughly a third of the originals, which is
 * the whole difference from the first colour scheme: that one used saturated
 * strokes (#0891b2, #7c3aed) and they shouted over the furniture they contain.
 *
 * Nested zones rely on the biggest-first draw order below — the ceremony and DJ
 * rectangles sit inside the pool one and paint over it, so their tint is what
 * shows. That is why the fills are opaque: stacking three translucent layers
 * would make the innermost zone the darkest, which is backwards.
 */
const ZONE_TINT: Record<string, ZoneTint> = {
  pool: { fill: '#e6f2f5', stroke: '#a6c6cf' },
  saviv: { fill: '#eaf3ec', stroke: '#aac7b2' },
  dancefloor: { fill: '#eeecf8', stroke: '#bab4d8' },
  bar: { fill: '#f7efe1', stroke: '#d3bf9b' },
  dj: { fill: '#fbeee1', stroke: '#dcbc98' },
  chuppah: { fill: '#f9eaf1', stroke: '#ddb4c9' },
  passage: { fill: '#edeff3', stroke: '#bcc3cc' },
  // the pack used to spell the passage `corridor`; both resolve, as in strings.ts
  corridor: { fill: '#edeff3', stroke: '#bcc3cc' },
  kabalatPanim: { fill: '#edf2e9', stroke: '#b4c6a8' },
}
const FALLBACK_TINT: ZoneTint = { fill: '#f0eff4', stroke: '#c0bcc8' }

const zoneKey = (z: RestrictedZone) => `${z.kind}-${z.x}-${z.y}`

function ZoneFill({ zone }: { zone: RestrictedZone }) {
  const tint = ZONE_TINT[zone.kind ?? ''] ?? FALLBACK_TINT
  return (
    <Rect
      x={zone.x}
      y={zone.y}
      width={zone.width}
      height={zone.depth}
      fill={tint.fill}
      stroke={tint.stroke}
      strokeWidth={1.2}
      strokeScaleEnabled={false}
    />
  )
}

function ZoneLabel({ zone, box }: { zone: RestrictedZone; box: ZoneLabelBox }) {
  // strings.ts is the dictionary; the pack's own label stays as the fallback for
  // a zone kind that has no entry there yet.
  const label = strings.zones[zone.kind ?? ''] ?? zone.label
  if (!label) return null
  const levelH = zone.elevation === undefined ? 0 : Math.min(LABEL_ELEVATION_HEIGHT, box.h / 2)
  return (
    <Fragment>
      <Rect x={box.x} y={box.y} width={box.w} height={box.h} fill={LABEL_BG} cornerRadius={4} />
      <Text
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h - levelH}
        padding={6}
        text={label}
        fontSize={LABEL_FONT_SIZE}
        fontFamily="Assistant, sans-serif"
        fontStyle="600"
        lineHeight={0.95}
        fill={LABEL_TEXT}
        align="center"
        verticalAlign="middle"
        wrap="word"
        ellipsis
      />
      {levelH > 0 && (
        <Text
          x={box.x}
          y={box.y + box.h - levelH}
          width={box.w}
          height={levelH}
          text={formatElevation(zone.elevation ?? 0)}
          fontSize={LEVEL_FONT_SIZE}
          fontFamily="Assistant, sans-serif"
          fill={LEVEL_TEXT}
          align="center"
          verticalAlign="middle"
        />
      )}
    </Fragment>
  )
}

export function VenueLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  // display preference, deliberately OUTSIDE the undo zone (BRIEF §8) — read
  // only, never written from here and never moved into `scene`.
  const activeZone = useEditorStore((s) => s.activeZone)
  const pack = getVenuePack(venuePackId)
  const zones = pack?.restricted ?? []
  const floorAreas = pack?.floorAreas ?? []
  const outline = venueOutline(pack)
  // index-aligned with `zones`: solved geometry, not a style choice — see
  // core/layout/zoneLabels.ts for why centring cannot work here (source doc §17).
  const labelBoxes = zoneLabelBoxes(zones)
  // biggest first, so a zone that sits inside another (chuppah, DJ) stays legible
  // on top of it. The labels are keyed by index and do not follow this order.
  const drawOrder = zones
    .map((_, i) => i)
    .sort((a, b) => zones[b].width * zones[b].depth - zones[a].width * zones[a].depth)

  // Which zones are currently stood on. Selecting the KEYS rather than the
  // object centres is what keeps this layer still during a drag: the centres
  // move every frame, the answer to "is the bar zone occupied" almost never
  // does, and useShallow bails out on the unchanged array.
  const occupied = useEditorStore(
    useShallow((s) => {
      const packZones = getVenuePack(s.scene.venue.venuePackId)?.restricted ?? []
      if (!packZones.length) return [] as string[]
      const centres: Vec2[] = []
      for (const id of s.scene.objectOrder) {
        const o = s.scene.objects[id]
        if (!o || !hasCatalogEntry(o.catalogId) || !isObjectVisible(s.scene, id)) continue
        // a chandelier hung over the dance floor is not standing on it
        if (getCatalogEntry(o.catalogId).placement === 'ceiling') continue
        centres.push(o.transform.position)
      }
      return packZones.filter((z) => isZoneOccupied(z, centres)).map(zoneKey)
    }),
  )
  const occupiedKeys = new Set(occupied)

  // source doc §18: the two work zones take turns. The one you are not in stays
  // visible — you still need its context — but drops back so the active one reads.
  const isReception = (i: number) => zones[i].kind === 'kabalatPanim'
  const hallOpacity = activeZone === 'kabalatPanim' ? ZONE_OFF_OPACITY : 1
  const receptionOpacity = activeZone === 'hall' ? ZONE_OFF_OPACITY : 1
  const hallZones = drawOrder.filter((i) => !isReception(i))
  const receptionZones = drawOrder.filter(isReception)

  const zoneNodes = (indices: number[]) => (
    <Fragment>
      {indices.map((i) => (
        <ZoneFill key={`z-${zoneKey(zones[i])}`} zone={zones[i]} />
      ))}
      {indices.map((i) =>
        occupiedKeys.has(zoneKey(zones[i])) ? null : (
          <ZoneLabel key={`label-${zoneKey(zones[i])}`} zone={zones[i]} box={labelBoxes[i]} />
        ),
      )}
    </Fragment>
  )

  return (
    <Layer listening={false}>
      <Group opacity={hallOpacity}>
        {/* poché: the wall is a BAND of real thickness, not a hairline. That means
            strokeScaleEnabled TRUE — the one place in the project that wants it —
            so 20 stays 20 cm of world and shrinks on screen as you zoom out, the
            way a wall on a drawing does. `false` would pin it to 20 screen px and
            give a cartoon outline. No drop shadow: a cut wall is not an object
            floating over paper, it IS the paper. */}
        {outline ? (
          <Line
            points={outline.flat()}
            closed
            fill={PAPER}
            stroke={WALL}
            strokeWidth={WALL_THICKNESS}
            strokeScaleEnabled={true}
            lineJoin="miter"
          />
        ) : (
          <Rect
            x={0}
            y={0}
            width={venueSize.width}
            height={venueSize.depth}
            fill={PAPER}
            stroke={WALL}
            strokeWidth={WALL_THICKNESS}
            strokeScaleEnabled={true}
            lineJoin="miter"
          />
        )}
        {/* placeable area: an edge, not a green wash. The fill said "this green
            means something" when all it meant was "not restricted". */}
        {floorAreas.map((poly, i) => (
          <Line
            key={`f${i}`}
            points={poly.flat()}
            closed
            stroke={FLOOR_AREA_STROKE}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        ))}
        {zoneNodes(hallZones)}
      </Group>
      <Group opacity={receptionOpacity}>{zoneNodes(receptionZones)}</Group>
    </Layer>
  )
}
