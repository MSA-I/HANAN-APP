import { Fragment } from 'react'
import { Layer, Line, Rect, Text } from 'react-konva'
import { getVenuePack } from '../core/venuePacks'
import { useEditorStore } from '../state/store'

const WALL = '#44403c'
const FALLBACK_ZONE_STYLE = { fill: '#eef2ff', stroke: '#4f46e5', text: '#3730a3' }
const ZONE_STYLES: Record<string, typeof FALLBACK_ZONE_STYLE> = {
  pool: { fill: '#dff4f7', stroke: '#0891b2', text: '#155e75' },
  bar: { fill: '#f8eedb', stroke: '#a16207', text: '#78350f' },
  dancefloor: { fill: '#ede9fe', stroke: '#7c3aed', text: '#5b21b6' },
  dj: { fill: '#ffedd5', stroke: '#ea580c', text: '#9a3412' },
  chuppah: { fill: '#fce7f3', stroke: '#db2777', text: '#9d174d' },
  corridor: { fill: '#e2e8f0', stroke: '#64748b', text: '#334155' },
}

const LABEL_INSET = 16
const LABEL_HEIGHT = 210
const LABEL_MAX_WIDTH = 360

export function VenueLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const pack = getVenuePack(venuePackId)
  const zones = pack?.restricted ?? []
  const floorAreas = pack?.floorAreas ?? []
  const orderedZones = [...zones].sort((a, b) => b.width * b.depth - a.width * a.depth)

  return (
    <Layer listening={false}>
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
      {/* restricted zones (pool, bar, dj, dance floor, chuppah, corridor) */}
      {orderedZones.map((z) => {
        const style = ZONE_STYLES[z.kind ?? ''] ?? FALLBACK_ZONE_STYLE
        return (
          <Rect
            key={`z-${z.kind}-${z.x}-${z.y}`}
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
        if (!z.label) return null
        const style = ZONE_STYLES[z.kind ?? ''] ?? FALLBACK_ZONE_STYLE
        const width = Math.max(1, Math.min(LABEL_MAX_WIDTH, z.width - LABEL_INSET * 2))
        const height = Math.max(1, Math.min(LABEL_HEIGHT, z.depth - LABEL_INSET * 2))
        return (
          <Fragment key={`label-${z.kind}-${z.x}-${z.y}`}>
            <Rect
              x={z.x + LABEL_INSET}
              y={z.y + LABEL_INSET}
              width={width}
              height={height}
              fill="rgba(255,255,255,0.9)"
              stroke={style.stroke}
              strokeWidth={1.5}
              strokeScaleEnabled={false}
              cornerRadius={16}
            />
            <Text
              x={z.x + LABEL_INSET}
              y={z.y + LABEL_INSET}
              width={width}
              height={height}
              padding={10}
              text={z.label}
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
