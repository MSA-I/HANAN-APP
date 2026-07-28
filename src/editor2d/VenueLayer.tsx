/**
 * The building, drawn as an architect draws it (source doc §28: "it looks like a
 * pile of shapes and colours — the surroundings should look like an
 * architectural plan section, same for the reception area").
 *
 * The rule the whole layer follows: THE BUILDING IS THE DARK THING, the contents
 * are the light thing, and colour appears only when it carries information. So
 * the wall is a filled band of real thickness (poché), a zone is a hatch and a
 * small tag rather than a pastel fill, and nothing in here is coloured by
 * "kind" any more. The full contract, which PLAN-07 also reads so that design
 * mode matches: HANAN-APP-DOCS/Plans/R2/handoff/04-plan-style.md.
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
const ZONE_STROKE = '#8a827a'
const HATCH = '#b9b2a9'
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

/** the hatch tile is drawn at 2× and scaled by 0.5, which is what anti-aliases it */
const TILE = 32
const HATCH_LINE = 4
const PATTERN_UNIT = 0.5

const LABEL_FONT_SIZE = 44
const LEVEL_FONT_SIZE = 30

/** dimmed side of the hall/reception toggle (source doc §18). ObjectsLayer dims
 *  the furniture standing on the far side to the same value — one number. */
export const ZONE_OFF_OPACITY = 0.28

interface Hatch {
  /** degrees the horizontal tile is turned by — this is the whole difference between kinds */
  rotation: number
  /** multiplies the 16 cm base pitch: below 1 is denser, above 1 is sparser */
  density: number
  dots?: boolean
}

const ZONE_HATCH: Record<string, Hatch> = {
  pool: { rotation: 45, density: 0.75 },
  saviv: { rotation: 45, density: 1.5 },
  dancefloor: { rotation: 45, density: 1.6 },
  bar: { rotation: -45, density: 1 },
  dj: { rotation: -45, density: 0.8 },
  chuppah: { rotation: 90, density: 1 },
  passage: { rotation: 0, density: 1, dots: true },
  // the pack used to spell the passage `corridor`; both resolve, as in strings.ts
  corridor: { rotation: 0, density: 1, dots: true },
  kabalatPanim: { rotation: -45, density: 1.3 },
}
const FALLBACK_HATCH: Hatch = { rotation: 45, density: 1.2 }

/**
 * ONE tile per module, not one per shape. Every zone reuses these two canvases
 * and only differs by `fillPatternRotation`/`fillPatternScale`; building a canvas
 * per zone is the performance trap this layer was warned about, because the
 * pattern lives in world coordinates and gets re-rasterised on zoom.
 */
function makeTile(draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = HATCH
  draw(ctx)
  return canvas
}

let lineTile: HTMLCanvasElement | null | undefined
let dotTile: HTMLCanvasElement | null | undefined

/**
 * Konva types `fillPatternImage` as HTMLImageElement, but it only ever hands the
 * value to `createPattern`, which takes any CanvasImageSource — a canvas is the
 * cheap way to make a tile without shipping an asset. The cast is the whole of
 * the workaround and lives here alone.
 */
function hatchTile(hatch: Hatch): HTMLImageElement | undefined {
  return (tileCanvas(hatch) ?? undefined) as HTMLImageElement | undefined
}

function tileCanvas(hatch: Hatch): HTMLCanvasElement | null {
  if (hatch.dots) {
    if (dotTile === undefined) {
      dotTile = makeTile((ctx) => {
        ctx.beginPath()
        ctx.arc(TILE / 2, TILE / 2, HATCH_LINE / 2 + 1, 0, Math.PI * 2)
        ctx.fill()
      })
    }
    return dotTile
  }
  if (lineTile === undefined) {
    lineTile = makeTile((ctx) => ctx.fillRect(0, (TILE - HATCH_LINE) / 2, TILE, HATCH_LINE))
  }
  return lineTile
}

const zoneKey = (z: RestrictedZone) => `${z.kind}-${z.x}-${z.y}`

function ZoneHatch({ zone }: { zone: RestrictedZone }) {
  const hatch = ZONE_HATCH[zone.kind ?? ''] ?? FALLBACK_HATCH
  const scale = PATTERN_UNIT * hatch.density
  return (
    <Rect
      x={zone.x}
      y={zone.y}
      width={zone.width}
      height={zone.depth}
      fillPatternImage={hatchTile(hatch)}
      fillPatternRepeat="repeat"
      fillPatternRotation={hatch.rotation}
      fillPatternScaleX={scale}
      fillPatternScaleY={scale}
      stroke={ZONE_STROKE}
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
        <ZoneHatch key={`z-${zoneKey(zones[i])}`} zone={zones[i]} />
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
