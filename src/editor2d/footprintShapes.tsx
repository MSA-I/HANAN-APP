/**
 * The one place a catalog `FootprintPart` becomes a Konva shape.
 *
 * ObjectNode (placed objects) and OverlayLayer (the placing ghost) drew the same
 * switch with different fill/stroke; a third part kind would have meant writing
 * the same arc case twice and letting them drift. They differ only in styling,
 * so styling is what they pass in.
 */
import { Circle, Rect, Ring, Shape } from 'react-konva'
import type { FootprintPart } from '../core/catalog/types'

export interface FootprintPartStyle {
  fill: string
  stroke: string
  strokeWidth?: number
  /** dashed outline marks a ceiling item seen from above */
  dash?: number[]
  /**
   * 0 hides the shape while leaving it in the tree. A top-down plan image is
   * drawn over the footprint, but the footprint is still the hit region
   * (Konva's hit graph ignores opacity) and still the geometry PLAN-03 builds
   * collisions on, so it is hidden rather than dropped.
   */
  opacity?: number
  /**
   * Off by default. Konva's perfect-draw buffers a shape to stop its stroke
   * bleeding into its fill, which only matters at shape-level opacity < 1 —
   * neither caller has that (the ghost's opacity is on its Group), so both pay
   * for the buffer and get nothing.
   */
  perfectDrawEnabled?: boolean
}

export function FootprintPartShape({
  part,
  style,
}: {
  part: FootprintPart
  style: FootprintPartStyle
}) {
  const common = {
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth ?? 1,
    dash: style.dash,
    opacity: style.opacity ?? 1,
    // screen-space stroke, so the hairline stays a hairline at every zoom
    strokeScaleEnabled: false,
    perfectDrawEnabled: style.perfectDrawEnabled ?? false,
  }

  if (part.kind === 'circle') {
    // A hole is a real hole: Konva's Ring strokes both edges and leaves the
    // centre unpainted, so the floor shows through the ⌀380's opening instead of
    // a second disc being painted over it in table colour.
    if (part.rInner && part.rInner > 0) {
      return <Ring innerRadius={part.rInner} outerRadius={part.r} {...common} />
    }
    return <Circle radius={part.r} {...common} />
  }

  if (part.kind === 'arc') {
    // Konva's Arc strokes the two radial closing edges as well as the curved
    // edges. A chain of tangent sectors would therefore show black seams across
    // the table at every join. Draw the same annular fill, then stroke only the
    // inner and outer curves so adjacent sectors read as one continuous band.
    const start = (part.startAngle * Math.PI) / 180
    const end = ((part.startAngle + part.sweep) * Math.PI) / 180
    return (
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath()
          ctx.arc(part.cx, part.cy, part.outerR, start, end, false)
          ctx.arc(part.cx, part.cy, part.innerR, end, start, true)
          ctx.closePath()
          ctx.fillShape(shape)

          ctx.beginPath()
          ctx.arc(part.cx, part.cy, part.outerR, start, end, false)
          ctx.moveTo(part.cx + Math.cos(start) * part.innerR, part.cy + Math.sin(start) * part.innerR)
          ctx.arc(part.cx, part.cy, part.innerR, start, end, false)
          ctx.strokeShape(shape)
        }}
        {...common}
      />
    )
  }

  return (
    <Rect
      x={part.cx ?? 0}
      y={part.cy ?? 0}
      offsetX={part.w / 2}
      offsetY={part.h / 2}
      width={part.w}
      height={part.h}
      cornerRadius={part.cornerRadius ?? 0}
      {...common}
    />
  )
}
