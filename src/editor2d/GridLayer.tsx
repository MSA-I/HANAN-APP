import { Layer, Shape } from 'react-konva'
import { useEditorStore } from '../state/store'
import { useViewportStore, ZOOM_100 } from './viewportStore'

const MINOR = '#dcd8d1'
const MAJOR = '#c9c3ba'

/** cm — the drawing module. A plan grid is metres; anything finer is a zoom aid. */
const MODULE = 100
const FINE = 10

/**
 * A dot costs one per crossing where a line costs one per row: the full 10 cm
 * grid over a 6051 × 2544 hall is 153,000 dots and freezes the app. So the fine
 * grid is drawn only inside the visible rectangle, and this is the ceiling on
 * what that rectangle may ever contain.
 *
 * ponytail: over the ceiling the fine grid silently drops out rather than
 * coarsening — reachable by a 4K stage at exactly the 3× threshold. Stepping the
 * spacing up until the count fits would degrade instead of vanish.
 */
const MAX_DOTS = 20000

/** screen px — below this a grid stops reading as a module and starts as texture */
const MIN_DOT_SPACING_PX = 6

/**
 * Dot grid, drawn across the venue area only (CAD-style).
 *
 * Dots rather than lines (source doc §28): a ruled grid competes with the walls
 * and the furniture outlines for the same ink, and an architectural plan does
 * not have one. Dots read as a modular reference and disappear as soon as you
 * stop looking for them.
 */
export function GridLayer() {
  const venueSize = useEditorStore((s) => s.scene.venue.size)
  const showGrid = useEditorStore((s) => s.scene.settings.showGrid)
  const zoom = useViewportStore((s) => s.zoom)

  if (!showGrid) return <Layer listening={false} />

  return (
    <Layer listening={false}>
      <Shape
        sceneFunc={(ctx, shape) => {
          const { width, depth } = venueSize
          const layer = shape.getLayer()
          const stage = layer?.getStage()
          // Scale and viewport come off the live transform, not off the store:
          // panning by dragging the stage redraws this layer without any React
          // render, so the store's zoom is right but its pan is not knowable here.
          const scale = layer?.getAbsoluteScale().x || zoom
          let x0 = 0
          let y0 = 0
          let x1 = width
          let y1 = depth
          if (layer && stage) {
            const inv = layer.getAbsoluteTransform().copy().invert()
            const a = inv.point({ x: 0, y: 0 })
            const b = inv.point({ x: stage.width(), y: stage.height() })
            x0 = Math.max(0, Math.min(a.x, b.x))
            x1 = Math.min(width, Math.max(a.x, b.x))
            y0 = Math.max(0, Math.min(a.y, b.y))
            y1 = Math.min(depth, Math.max(a.y, b.y))
          }
          if (x1 <= x0 || y1 <= y0) return

          const px = 1 / scale // one screen px in world cm
          const drawDots = (step: number, color: string, radius: number) => {
            // a grid tighter than this on screen stops being a reference and
            // becomes a grey haze — at 5% zoom the metre module is 3 px apart
            if (step * scale < MIN_DOT_SPACING_PX) return
            const first = (v: number) => Math.ceil(v / step) * step
            const cols = Math.floor((x1 - first(x0)) / step) + 1
            const rows = Math.floor((y1 - first(y0)) / step) + 1
            if (cols <= 0 || rows <= 0 || cols * rows > MAX_DOTS) return
            const d = radius * 2
            ctx.beginPath()
            for (let x = first(x0); x <= x1; x += step) {
              for (let y = first(y0); y <= y1; y += step) {
                // a square, not an arc: at ~1 px across the two are identical on
                // screen and rect() is an order of magnitude cheaper per point
                ctx.rect(x - radius, y - radius, d, d)
              }
            }
            ctx.setAttr('fillStyle', color)
            ctx.fill()
          }

          // the fine grid only appears once it is a legible spacing on screen,
          // and only ever over the visible rectangle
          if (scale >= ZOOM_100 * 3) drawDots(FINE, MINOR, px * 0.5)
          drawDots(MODULE, MAJOR, px * 0.9)
        }}
      />
    </Layer>
  )
}
