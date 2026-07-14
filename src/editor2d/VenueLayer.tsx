import { Layer, Rect } from 'react-konva'
import { useEditorStore } from '../state/store'

const WALL = '#44403c'

export function VenueLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)

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
    </Layer>
  )
}
