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
import { Circle, Group, Layer, Line, Rect, Shape, Text } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { effectiveZones } from '../core/layout/venueZones'
import { isZoneInside, isZoneOccupied } from '../core/layout/zoneOccupancy'
import {
  formatElevation,
  LABEL_ELEVATION_HEIGHT,
  labelFits,
  zoneLabelBoxes,
  type ZoneLabelBox,
} from '../core/layout/zoneLabels'
import type { Vec2 } from '../core/model/types'
import { venueOutline } from '../core/venueOutline'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import { cachedVenueCut, loadVenueCut, type CutTriangle, type VenueCut } from '../core/venueCut'
import { isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { strings } from '../ui/strings'

const PAPER = '#ffffff'
const WALL = '#2b2724'
const FLOOR_AREA_STROKE = '#cfc9c1'
const LABEL_TEXT = '#4a443e'
const LEVEL_TEXT = '#6b635a'

/**
 * LINE WEIGHT IS THE INFORMATION. On an architectural plan you know what a line
 * is before you read any label: the heaviest ink is the building itself, cut
 * through, and lighter ink is everything the drawing only passes over.
 *
 *   poché          the walls the user painted as ZONE_CUT
 *   floor / level  BELOW the walls — floor edge, change of level
 *
 * The glazing / unclassified / railing pens that used to live here went with the
 * cut-plane extractor on 2026-07-29. They classified by GLB material at a chosen
 * cut height, and the height was the bug: see core/venueCut.ts.
 *
 * Widths are SCREEN px (`strokeScaleEnabled={false}`), not world cm. That is
 * what a drawing does: print it at 1:200 and the wall gets thinner but its
 * outline does not vanish.
 */
const INK_FLOOR_EDGE = '#7d746a'

const INK_LEVEL = '#6b635a'

const W_FLOOR_EDGE = 1.6
const W_LEVEL = 2.2
const W_NOTE = 1.3

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

const LABEL_FONT_SIZE = 44
const LEVEL_FONT_SIZE = 30


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
  // the aisle to the ceremony — same hue family as the pad it leads to, a shade
  // lighter, so the two read as one place rather than two
  shvilHupa: { fill: '#fdf3f7', stroke: '#e8cbd9' },
  passage: { fill: '#edeff3', stroke: '#bcc3cc' },
  // the pack used to spell the passage `corridor`; both resolve, as in strings.ts
  corridor: { fill: '#edeff3', stroke: '#bcc3cc' },
  kabalatPanim: { fill: '#edf2e9', stroke: '#b4c6a8' },
}
const FALLBACK_TINT: ZoneTint = { fill: '#f0eff4', stroke: '#c0bcc8' }

/**
 * The building, as the user painted it.
 *
 * ONE Konva shape for every triangle. A path per triangle would put a seam on
 * every shared edge — antialiasing does not cancel between two adjacent fills —
 * and 4,640 nodes into a layer that redraws on every pan. One path with one fill
 * has neither problem: the interior edges disappear because the fill never stops.
 *
 * There is no stroke. The old poché carried a screen-space edge so a 5 cm wall
 * stayed visible when zoomed out, and that was needed because the extractor
 * returned some walls as 5 cm slivers. These are the footprints the user drew,
 * at the thickness he drew them.
 */
function CutPoche({ tris }: { tris: readonly CutTriangle[] }) {
  return (
    <Shape
      listening={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath()
        for (const t of tris) {
          ctx.moveTo(t[0], t[1])
          ctx.lineTo(t[2], t[3])
          ctx.lineTo(t[4], t[5])
          ctx.closePath()
        }
        ctx.fillStrokeShape(shape)
      }}
      fill={WALL}
    />
  )
}


/*
 * The sheet furniture that used to live here — drawing title, north point and
 * scale bar — was removed on 2026-07-29 at the user's request: this drawing is a
 * working plan of a hall, not a sheet issued for construction, and a title block
 * on it is decoration that competes with the furniture it is meant to describe.
 * `strings.plan.north` and `strings.plan.title` stay in the dictionary; nothing
 * reads them. Bring the block back only with a real margin to put it in.
 */

const zoneKey = (z: RestrictedZone) => `${z.kind}-${z.x}-${z.y}`

function ZoneFill({ zone }: { zone: RestrictedZone }) {
  const tint = ZONE_TINT[zone.kind ?? ''] ?? FALLBACK_TINT
  // a raised zone's edge is drawn by LevelChanges instead, at the weight a step
  // in the floor deserves — stroking it here as well doubles the line
  const raised = zone.elevation !== undefined
  return (
    <Rect
      x={zone.x}
      y={zone.y}
      width={zone.width}
      height={zone.depth}
      fill={tint.fill}
      stroke={raised ? undefined : tint.stroke}
      strokeWidth={1.2}
      strokeScaleEnabled={false}
    />
  )
}

/**
 * Where the floor steps. The reception deck stands at +4.70 m and the plan said
 * so in one line of grey text under its name and in no other way — no edge, no
 * mark, nothing that reads as "there is a four-and-a-half-metre drop here".
 *
 * A change of level is seen BELOW the cut plane, so it is not poché and it is
 * not glazing; it is the heaviest of the "below" weights, above the floor
 * contour, and it is drawn under the walls because a wall standing on the step
 * sits over it.
 *
 * ⚠ Drawn OUTSIDE the two opacity groups, like the section itself. The
 * hall/reception toggle dims what STANDS in a zone; a step in the ground is
 * building, and the deck's own glass edge (drawn from the cut) is already
 * undimmed — dimming the step would put the two at different strengths along
 * the same line.
 *
 * ⚠ The 470 comes from `venuePacks.ts` and is read, never written: that file
 * belongs to PLAN-01.
 */
function LevelChanges({ zones }: { zones: readonly RestrictedZone[] }) {
  return (
    <Fragment>
      {zones.map((z, i) =>
        z.elevation === undefined ? null : (
          <Rect
            key={`lv${i}`}
            x={z.x}
            y={z.y}
            width={z.width}
            height={z.depth}
            stroke={INK_LEVEL}
            strokeWidth={W_LEVEL}
            strokeScaleEnabled={false}
            listening={false}
          />
        ),
      )}
    </Fragment>
  )
}

/** cm — the spot-level disc, and the width the value is centred in beside it. */
const LEVEL_MARK_R = 19
const LEVEL_MARK_GAP = 12
const LEVEL_VALUE_WIDTH = 150

/**
 * The spot level as a plan writes it: a small disc quartered by a cross, with
 * the value beside it. It replaces a bare line of text, which is what a UI does
 * and not what a drawing does.
 *
 * The disc is a fixed size in plan cm rather than a share of the row, so the
 * mark means the same thing on a 17 m deck and on a 4 m chuppah.
 */
function LevelMark({ x, y, w, h, cm }: { x: number; y: number; w: number; h: number; cm: number }) {
  const r = Math.min(LEVEL_MARK_R, h / 2)
  const total = r * 2 + LEVEL_MARK_GAP + LEVEL_VALUE_WIDTH
  const left = x + (w - total) / 2
  const cx = left + r
  const cy = y + h / 2
  return (
    <Fragment>
      <Circle x={cx} y={cy} radius={r} stroke={LEVEL_TEXT} strokeWidth={W_NOTE} strokeScaleEnabled={false} />
      <Line points={[cx - r, cy, cx + r, cy]} stroke={LEVEL_TEXT} strokeWidth={W_NOTE} strokeScaleEnabled={false} />
      <Line points={[cx, cy - r, cx, cy + r]} stroke={LEVEL_TEXT} strokeWidth={W_NOTE} strokeScaleEnabled={false} />
      <Text
        x={left + r * 2 + LEVEL_MARK_GAP}
        y={y}
        width={LEVEL_VALUE_WIDTH}
        height={h}
        text={formatElevation(cm)}
        fontSize={LEVEL_FONT_SIZE}
        fontFamily="Assistant, sans-serif"
        fill={LEVEL_TEXT}
        align="center"
        verticalAlign="middle"
      />
    </Fragment>
  )
}

function ZoneLabel({ zone, box }: { zone: RestrictedZone; box: ZoneLabelBox }) {
  // strings.ts is the dictionary; the pack's own label stays as the fallback for
  // a zone kind that has no entry there yet.
  const label = strings.zones[zone.kind ?? ''] ?? zone.label
  if (!label || !labelFits(box, LABEL_FONT_SIZE)) return null
  const levelH = zone.elevation === undefined ? 0 : Math.min(LABEL_ELEVATION_HEIGHT, box.h / 2)
  return (
    <Fragment>
      {/* No card behind the words. A rounded white box with a drop of text in it
          is a UI chip, and it was the single loudest reason the drawing read as
          an interface rather than a plan (source doc §28). An annotation on a
          plan is ink on the paper; the zone tints are pale enough by design
          (see ZONE_TINT) that plain text sits on them and stays legible. */}
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
        <LevelMark
          x={box.x}
          y={box.y + box.h - levelH}
          w={box.w}
          h={levelH}
          cm={zone.elevation ?? 0}
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
  // THE rectangle the user is asking about: with "חופה למטה" the deck's ceremony
  // marker is not drawn, with "חופה למעלה" the hall's is not. One list, and it is
  // the same one the rules judge against (core/layout/venueZones.ts).
  // no `useShallow`: `effectiveZones` hands back a cached frozen array, so the
  // reference itself is already stable across every store update that does not
  // change the pack or the switch
  const zones = useEditorStore((s) => effectiveZones(s.scene))
  const floorAreas = pack?.floorAreas ?? []
  const outline = venueOutline(pack)
  // The walls are a static asset of a static pack, so they are fetched once and
  // held. Seeded from the cache so a venue already loaded paints them on the
  // first frame instead of flashing a wall-less plan.
  const [cut, setCut] = useState<VenueCut | null>(() => cachedVenueCut(pack?.cut))
  useEffect(() => {
    let live = true
    void loadVenueCut(pack?.cut).then((c) => {
      if (live) setCut(c)
    })
    return () => {
      live = false
    }
  }, [pack?.cut])
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
      const packZones = effectiveZones(s.scene)
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

  // source doc §18: the two work zones take turns. The one you are not in is now
  // GONE, not dimmed. It was dimmed for three rounds — first to 0.28, then to
  // 0.45 — and the user's verdict on the result was that it is confusing: the
  // hall and the deck are two separate buildings 4.70 m apart in height, and a
  // ghost of the other one laid over the same sheet reads as part of the drawing
  // you are working on. Absent is unambiguous in a way that faint is not.
  //
  // ⚠ Membership is GEOMETRIC, not by `kind` — the same rule ObjectsLayer applies
  // to furniture, for the same reason: this asks where a rectangle is drawn, not
  // what it is. By kind, the deck's own chuppah (`kind: 'chuppah'`, +5.20, wholly
  // inside `kabalatPanim`) counted as a hall zone and behaved backwards: lit while
  // you worked in the hall, gone the moment you switched to reception.
  const deck = zones.find((z) => z.kind === 'kabalatPanim')
  const onDeck = (z: RestrictedZone) => z.kind === 'kabalatPanim' || (!!deck && isZoneInside(z, deck))
  const isReception = (i: number) => onDeck(zones[i])
  const showHall = activeZone !== 'kabalatPanim'
  const showReception = activeZone !== 'hall'
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
      {showHall ? (
      <Group>
        {/* The paper. Where the section exists this is only the sheet the drawing
            sits on; the walls come from the cut below, at their real thickness and
            with their real openings. Where it does not, the contour doubles as a
            wall band, which is the pre-section behaviour and all a pack without a
            model can offer.

            ⚠ With a section this contour used to be a #b6afa7 hairline, and at
            the resort that was the whole reason the drawing had no edges: the
            hall's west side has ZERO geometry in the cut and its north side is
            seven piers with 2.4 m gaps between them (measured on section.json),
            so the contour is the ONLY thing that closes the building on three
            sides. It is still not a wall — it is where the floor stops — so it
            takes the floor-edge weight and not the poché. */}
        {outline ? (
          <Line
            points={outline.flat()}
            closed
            fill={PAPER}
            stroke={cut ? INK_FLOOR_EDGE : WALL}
            strokeWidth={cut ? W_FLOOR_EDGE : FALLBACK_WALL_THICKNESS}
            strokeScaleEnabled={!cut}
            lineJoin="miter"
          />
        ) : (
          <Rect
            x={0}
            y={0}
            width={venueSize.width}
            height={venueSize.depth}
            fill={PAPER}
            stroke={cut ? INK_FLOOR_EDGE : WALL}
            strokeWidth={cut ? W_FLOOR_EDGE : FALLBACK_WALL_THICKNESS}
            strokeScaleEnabled={!cut}
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
      ) : null}
      {showReception ? <Group>{zoneNodes(receptionZones)}</Group> : null}
      {/* The ground before the building on it: a wall standing on the deck sits
          over the step, not under it. */}
      <LevelChanges zones={zones.filter((z) => onDeck(z) === !showHall)} />
      {/* The building itself, last: a cut wall sits OVER the floor it encloses,
          and over the zone tints, which are markings on that floor.

          ⚠ THE WALLS ARE ONE MARKER AND THEY GO WITH THE HALL — all of them or
          none of them. ZONE_CUT is a single face the user painted over the whole
          building, so splitting it here by which rectangle a triangle lands in
          would be this file inventing a division the source does not make. That
          split was tried and the user asked for it to be reverted; do not
          reintroduce it geometrically.

          ⚠ SO THE DECK LOSES ITS OWN WALLS UP HERE TOO, and that is a real cost,
          not a rounding error. Measured on the shipped cut.json against the
          `kabalatPanim` rectangle: 431 of the 4,640 triangles have their centroid
          inside it, 9.8 m² of the 28.5 m² of painted wall. In reception mode
          those go with the rest. What the deck keeps is `LevelChanges` above,
          which draws its +4.70 / +5.20 edges at step weight in exactly this mode
          — so the drawing still says where the deck stops, it just does not say
          what encloses it.

          The day the user paints the reception its own marker the split becomes
          DATA, and this line draws whichever envelope belongs to the active side.
          core/venueCut.test.ts pins the 431 so that day is noticed. */}
      {cut && showHall ? <CutPoche tris={cut.tris} /> : null}
    </Layer>
  )
}
