import { Layer, Line, Rect, Text } from 'react-konva'
import { getVenuePack } from '../core/venuePacks'
import { useEditorStore } from '../state/store'

const WALL = '#44403c'

export function VenueLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const pack = getVenuePack(venuePackId)
  const zones = pack?.restricted ?? []
  const floorAreas = pack?.floorAreas ?? []

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
      {zones.map((z, i) => (
        <Rect
          key={`z${i}`}
          x={z.x}
          y={z.y}
          width={z.width}
          height={z.depth}
          fill="#bae0fb"
          opacity={0.55}
          stroke="#3b82f6"
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          dash={[12, 7]}
          dashEnabled
        />
      ))}
      {zones.map((z, i) =>
        z.label ? (
          <Text
            key={`t${i}`}
            x={z.x}
            y={z.y}
            width={z.width}
            height={z.depth}
            text={z.label}
            fontSize={90}
            fontFamily="Assistant, sans-serif"
            fontStyle="600"
            fill="#1d4ed8"
            align="center"
            verticalAlign="middle"
          />
        ) : null,
      )}
    </Layer>
  )
}
