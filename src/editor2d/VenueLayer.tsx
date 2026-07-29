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
import { Fragment, useEffect, useState } from 'react'
import { Group, Layer, Line, Rect, Text } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { isZoneInside, isZoneOccupied } from '../core/layout/zoneOccupancy'
import { formatElevation, LABEL_ELEVATION_HEIGHT, zoneLabelBoxes, type ZoneLabelBox } from '../core/layout/zoneLabels'
import type { Vec2 } from '../core/model/types'
import { venueOutline } from '../core/venueOutline'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import { cachedVenueSection, loadVenueSection, type VenueSection } from '../core/venueSection'
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
 * cm. Only for a pack with NO `section` asset: the contour is stroked as if it
 * were a wall, straddling the floor edge.
 *
 * ponytail: invented number, and it is exactly the fake the section replaces —
 * one thickness for every wall and no openings anywhere, because the contour is
 * a floor polygon and knows nothing about a door. A pack that ships a section
 * never reaches this.
 */
const FALLBACK_WALL_THICKNESS = 20

/** the floor's edge once the real walls are drawn: the placement limit, not a wall */
const OUTLINE_HAIRLINE = '#b6afa7'

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

/**
 * The building, cut. `closed` runs are wall cross-sections and are FILLED — that
 * is the poché, and it is why an opening reads as an opening: there is simply no
 * loop across it. Open runs are surfaces the plane clipped without going around,
 * mostly glazing, and are hairlines.
 *
 * Hairline, i.e. `strokeScaleEnabled={false}`, on the open runs only. The filled
 * loops need no stroke at all — their width IS the wall's width in world cm, so
 * they thin out as you zoom out exactly as a drawing does. Giving them a world
 * stroke as well would fatten every wall by the stroke.
 */
function SectionLines({ section }: { section: VenueSection }) {
  return (
    <Fragment>
      {section.lines.map((line, i) =>
        line.closed ? (
          <Line key={`sc${i}`} points={line.pts.flat()} closed fill={WALL} listening={false} />
        ) : (
          <Line
            key={`so${i}`}
            points={line.pts.flat()}
            stroke={WALL}
            strokeWidth={1}
            strokeScaleEnabled={false}
            listening={false}
          />
        ),
      )}
    </Fragment>
  )
}

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
  // The section is a static asset of a static pack, so it is fetched once and
  // held. Seeded from the cache so a venue already loaded paints its walls on the
  // first frame instead of flashing a wall-less plan.
  const [section, setSection] = useState<VenueSection | null>(() => cachedVenueSection(pack?.section))
  useEffect(() => {
    let live = true
    void loadVenueSection(pack?.section).then((s) => {
      if (live) setSection(s)
    })
    return () => {
      live = false
    }
  }, [pack?.section])
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
  //
  // ⚠ Membership is GEOMETRIC, not by `kind` — the same rule ObjectsLayer applies
  // to furniture, for the same reason: this asks where a rectangle is drawn, not
  // what it is. By kind, the deck's own chuppah (`kind: 'chuppah'`, +5.20, wholly
  // inside `kabalatPanim`) counted as a hall zone and behaved backwards: lit while
  // you worked in the hall, gone the moment you switched to reception.
  const deck = zones.find((z) => z.kind === 'kabalatPanim')
  const isReception = (i: number) =>
    zones[i].kind === 'kabalatPanim' || (!!deck && isZoneInside(zones[i], deck))
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
        {/* The paper. Where the section exists this is only the sheet the drawing
            sits on; the walls come from the cut below, at their real thickness and
            with their real openings. Where it does not, the contour doubles as a
            wall band, which is the pre-section behaviour and all a pack without a
            model can offer. */}
        {outline ? (
          <Line
            points={outline.flat()}
            closed
            fill={PAPER}
            stroke={section ? OUTLINE_HAIRLINE : WALL}
            strokeWidth={section ? 1 : FALLBACK_WALL_THICKNESS}
            strokeScaleEnabled={!section}
            lineJoin="miter"
          />
        ) : (
          <Rect
            x={0}
            y={0}
            width={venueSize.width}
            height={venueSize.depth}
            fill={PAPER}
            stroke={section ? OUTLINE_HAIRLINE : WALL}
            strokeWidth={section ? 1 : FALLBACK_WALL_THICKNESS}
            strokeScaleEnabled={!section}
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
      {/* The building itself, last: a cut wall sits OVER the floor it encloses,
          and over the zone tints, which are markings on that floor. Not inside
          either opacity group — the hall/reception toggle dims what stands in a
          zone, and the building is not standing in one. */}
      {section ? <SectionLines section={section} /> : null}
    </Layer>
  )
}
