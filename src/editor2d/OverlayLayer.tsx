import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva'
import { getCatalogEntry } from '../core/catalog/registry'
import { slotColor } from '../core/catalog/types'
import { useEditorStore } from '../state/store'
import { useOverlayStore } from './overlayStore'
import { useViewportStore } from './viewportStore'

const ACCENT = '#3056d3'
const GUIDE = '#d64545'

function formatMeters(cm: number): string {
  return `${(cm / 100).toFixed(2)} מ'`
}

/** Translucent true-scale preview of the object being placed. */
function PlacingGhostShape() {
  const placing = useOverlayStore((s) => s.placing)
  const ghost = useOverlayStore((s) => s.ghost)
  if (!placing || !ghost) return null
  const entry = getCatalogEntry(placing)
  const footprint = entry.footprint(entry.defaultSize)
  const invalidTint = 'rgba(214,69,69,0.25)'
  return (
    <Group x={ghost.x} y={ghost.y} opacity={0.6} listening={false}>
      {footprint.parts.map((part, i) =>
        part.kind === 'circle' ? (
          <Circle
            key={i}
            radius={part.r}
            fill={ghost.valid ? slotColor(entry, {}, part.slot) : invalidTint}
            stroke={ghost.valid ? '#57534e' : '#d64545'}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        ) : (
          <Rect
            key={i}
            x={part.cx ?? 0}
            y={part.cy ?? 0}
            offsetX={part.w / 2}
            offsetY={part.h / 2}
            width={part.w}
            height={part.h}
            cornerRadius={part.cornerRadius ?? 0}
            fill={ghost.valid ? slotColor(entry, {}, part.slot) : invalidTint}
            stroke={ghost.valid ? '#57534e' : '#d64545'}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
        ),
      )}
    </Group>
  )
}

/** Snap guides, marquee rectangle and wall-distance indicators. */
export function OverlayLayer() {
  const { guides, dragBox, marquee } = useOverlayStore()
  const venue = useEditorStore((s) => s.scene.venue.size)
  const zoom = useViewportStore((s) => s.zoom)
  const px = 1 / zoom

  const wallIndicators: Array<{ points: number[]; label: string; lx: number; ly: number }> = []
  if (dragBox) {
    const cy = (dragBox.minY + dragBox.maxY) / 2
    const cx = (dragBox.minX + dragBox.maxX) / 2
    // horizontal: to nearer of left/right wall
    const leftD = dragBox.minX
    const rightD = venue.width - dragBox.maxX
    if (leftD >= 0 && (leftD <= rightD || rightD < 0)) {
      wallIndicators.push({
        points: [0, cy, dragBox.minX, cy],
        label: formatMeters(leftD),
        lx: dragBox.minX / 2,
        ly: cy - 14 * px,
      })
    } else if (rightD >= 0) {
      wallIndicators.push({
        points: [dragBox.maxX, cy, venue.width, cy],
        label: formatMeters(rightD),
        lx: dragBox.maxX + (venue.width - dragBox.maxX) / 2,
        ly: cy - 14 * px,
      })
    }
    const topD = dragBox.minY
    const bottomD = venue.depth - dragBox.maxY
    if (topD >= 0 && (topD <= bottomD || bottomD < 0)) {
      wallIndicators.push({
        points: [cx, 0, cx, dragBox.minY],
        label: formatMeters(topD),
        lx: cx + 6 * px,
        ly: dragBox.minY / 2,
      })
    } else if (bottomD >= 0) {
      wallIndicators.push({
        points: [cx, dragBox.maxY, cx, venue.depth],
        label: formatMeters(bottomD),
        lx: cx + 6 * px,
        ly: dragBox.maxY + (venue.depth - dragBox.maxY) / 2,
      })
    }
  }

  return (
    <Layer listening={false}>
      {guides.x !== null && (
        <Line
          points={[guides.x, -100000, guides.x, 100000]}
          stroke={GUIDE}
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4 * px, 4 * px]}
        />
      )}
      {guides.y !== null && (
        <Line
          points={[-100000, guides.y, 100000, guides.y]}
          stroke={GUIDE}
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[4 * px, 4 * px]}
        />
      )}
      {wallIndicators.map((w, i) => (
        <Line
          key={`wl${i}`}
          points={w.points}
          stroke={ACCENT}
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[6 * px, 3 * px]}
        />
      ))}
      {wallIndicators.map((w, i) => (
        <Text
          key={`wt${i}`}
          x={w.lx}
          y={w.ly}
          text={w.label}
          fontSize={12 * px}
          fontFamily="IBM Plex Mono, monospace"
          fill={ACCENT}
          offsetX={20 * px}
        />
      ))}
      {marquee && (
        <Rect
          x={Math.min(marquee.x1, marquee.x2)}
          y={Math.min(marquee.y1, marquee.y2)}
          width={Math.abs(marquee.x2 - marquee.x1)}
          height={Math.abs(marquee.y2 - marquee.y1)}
          fill="rgba(48,86,211,0.08)"
          stroke={ACCENT}
          strokeWidth={1}
          strokeScaleEnabled={false}
        />
      )}
      <PlacingGhostShape />
    </Layer>
  )
}
