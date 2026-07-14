import { Layer, Shape } from 'react-konva'
import { useEditorStore } from '../state/store'
import { useViewportStore, ZOOM_100 } from './viewportStore'

const MINOR = '#ebe9e4'
const MAJOR = '#dad7d0'

/** Adaptive grid drawn across the venue area only (CAD-style). */
export function GridLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)
  const showGrid = useEditorStore((s) => s.scene.settings.showGrid)
  const zoom = useViewportStore((s) => s.zoom)

  if (!showGrid) return <Layer listening={false} />

  const minorStep = zoom >= ZOOM_100 * 3 ? 10 : zoom >= ZOOM_100 * 0.5 ? 50 : 100

  return (
    <Layer listening={false}>
      <Shape
        sceneFunc={(ctx, shape) => {
          const { width, depth } = venueSize
          const px = 1 / zoom // 1 screen px in world cm
          const drawLines = (step: number, color: string) => {
            ctx.beginPath()
            for (let x = 0; x <= width; x += step) {
              ctx.moveTo(x, 0)
              ctx.lineTo(x, depth)
            }
            for (let y = 0; y <= depth; y += step) {
              ctx.moveTo(0, y)
              ctx.lineTo(width, y)
            }
            ctx.setAttr('strokeStyle', color)
            ctx.setAttr('lineWidth', px)
            ctx.stroke()
          }
          if (minorStep < 100) drawLines(minorStep, MINOR)
          drawLines(100, MAJOR)
          ctx.fillStrokeShape(shape)
        }}
      />
    </Layer>
  )
}
