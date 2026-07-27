import { Fragment } from 'react'
import { Layer, Line, Rect, Text } from 'react-konva'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { isZoneOccupied } from '../core/layout/zoneOccupancy'
import type { Vec2 } from '../core/model/types'
import { venueOutline } from '../core/venueOutline'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import { isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { strings } from '../ui/strings'

const WALL = '#44403c'
const FALLBACK_ZONE_STYLE = { fill: '#eef2ff', stroke: '#4f46e5', text: '#3730a3' }
const ZONE_STYLES: Record<string, typeof FALLBACK_ZONE_STYLE> = {
  pool: { fill: '#dff4f7', stroke: '#0891b2', text: '#155e75' },
  bar: { fill: '#f8eedb', stroke: '#a16207', text: '#78350f' },
  dancefloor: { fill: '#ede9fe', stroke: '#7c3aed', text: '#5b21b6' },
  dj: { fill: '#ffedd5', stroke: '#ea580c', text: '#9a3412' },
  chuppah: { fill: '#fce7f3', stroke: '#db2777', text: '#9d174d' },
  corridor: { fill: '#e2e8f0', stroke: '#64748b', text: '#334155' },
  // PLAN-07 renames corridor → passage and adds the reception zone; carrying
  // both spellings here means that rename lands without a restyle.
  passage: { fill: '#e2e8f0', stroke: '#64748b', text: '#334155' },
  kabalatPanim: { fill: '#e7f0e2', stroke: '#5f8a4a', text: '#3b5a2c' },
}

const LABEL_INSET = 16
const LABEL_HEIGHT = 210
const LABEL_MAX_WIDTH = 360

const zoneKey = (z: RestrictedZone) => `${z.kind}-${z.x}-${z.y}`

export function VenueLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const pack = getVenuePack(venuePackId)
  const zones = pack?.restricted ?? []
  const floorAreas = pack?.floorAreas ?? []
  const outline = venueOutline(pack)
  const orderedZones = [...zones].sort((a, b) => b.width * b.depth - a.width * a.depth)

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

  return (
    <Layer listening={false}>
      {outline ? (
        <Line
          points={outline.flat()}
          closed
          fill="#ffffff"
          stroke={WALL}
          strokeWidth={2.5}
          strokeScaleEnabled={false}
          shadowColor="#1c1916"
          shadowOpacity={0.08}
          shadowBlur={24}
          shadowOffsetY={6}
        />
      ) : (
        <Rect
          x={0}
          y={0}
          width={venueSize.width}
          height={venueSize.depth}
          fill="#ffffff"
          stroke={WALL}
          strokeWidth={2.5}
          strokeScaleEnabled={false}
          shadowColor="#1c1916"
          shadowOpacity={0.08}
          shadowBlur={24}
          shadowOffsetY={6}
        />
      )}
      {/* placeable area (green) — furniture is confined to these polygons */}
      {floorAreas.map((poly, i) => (
        <Line
          key={`f${i}`}
          points={poly.flat()}
          closed
          fill="#d7efd7"
          opacity={0.6}
          stroke="#4d9a5a"
          strokeWidth={1.5}
          strokeScaleEnabled={false}
        />
      ))}
      {/* restricted zones (pool, bar, dj, dance floor, chuppah, passage) */}
      {orderedZones.map((z) => {
        const style = ZONE_STYLES[z.kind ?? ''] ?? FALLBACK_ZONE_STYLE
        return (
          <Rect
            key={`z-${zoneKey(z)}`}
            x={z.x}
            y={z.y}
            width={z.width}
            height={z.depth}
            fill={style.fill}
            stroke={style.stroke}
            strokeWidth={2}
            strokeScaleEnabled={false}
            dash={[12, 7]}
            dashEnabled
          />
        )
      })}
      {orderedZones.map((z) => {
        // strings.ts is the dictionary; the pack's own label stays as the
        // fallback for a zone kind that has no entry there yet.
        const label = strings.zones[z.kind ?? ''] ?? z.label
        if (!label || occupiedKeys.has(zoneKey(z))) return null
        const style = ZONE_STYLES[z.kind ?? ''] ?? FALLBACK_ZONE_STYLE
        const width = Math.max(1, Math.min(LABEL_MAX_WIDTH, z.width - LABEL_INSET * 2))
        const height = Math.max(1, Math.min(LABEL_HEIGHT, z.depth - LABEL_INSET * 2))
        // centred: the passage is 461 × 2544 cm, so a corner-anchored chip sat
        // in the top 210 cm of a 25 m strip and read as a mistake
        const x = z.x + (z.width - width) / 2
        const y = z.y + (z.depth - height) / 2
        return (
          <Fragment key={`label-${zoneKey(z)}`}>
            <Rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill="rgba(255,255,255,0.9)"
              stroke={style.stroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              cornerRadius={16}
            />
            <Text
              x={x}
              y={y}
              width={width}
              height={height}
              padding={10}
              text={label}
              fontSize={96}
              fontFamily="Assistant, sans-serif"
              fontStyle="600"
              lineHeight={0.9}
              fill={style.text}
              align="center"
              verticalAlign="middle"
              wrap="word"
              ellipsis
            />
          </Fragment>
        )
      })}
    </Layer>
  )
}
