/**
 * Top-view SVG schematic of a hall layout — the picker thumbnail. Pure
 * derivation from the SAME data the apply action consumes (venue pack shape +
 * layout placements), so it can never drift from what clicking will produce.
 * Plan space is y-down like SVG, so coordinates map through directly.
 */
import { getCatalogEntry } from '../core/catalog/registry'
import type { HallLayout } from '../core/hallLayouts'
import { getTablePreset } from '../core/presets'
import { getVenuePack } from '../core/venuePacks'

export function LayoutThumbnail({ layout }: { layout: HallLayout }) {
  const pack = getVenuePack(layout.venuePackId)
  if (!pack) return null
  const { width, depth } = pack.size
  const pad = Math.max(width, depth) * 0.02
  const hairline = Math.max(width, depth) / 400

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`}
      className="w-full rounded bg-canvas"
      aria-hidden
    >
      <rect x={0} y={0} width={width} height={depth} fill="#faf9f7" stroke="#d6d3d1" strokeWidth={hairline * 2} />
      {pack.floorAreas?.map((poly, i) => (
        <polygon key={i} points={poly.map(([x, y]) => `${x},${y}`).join(' ')} fill="#eef0e6" />
      ))}
      {pack.restricted?.map((zone, i) => (
        <rect key={i} x={zone.x} y={zone.y} width={zone.width} height={zone.depth} fill="#dde7f2" />
      ))}
      {layout.placements.map((p, i) => {
        const preset = getTablePreset(p.presetId)
        if (!preset) return null
        const entry = getCatalogEntry(preset.tableCatalogId)
        // outline, not parts: at mini-map scale one shape per table reads best
        const o = entry.footprint(entry.defaultSize).outline
        const fill = entry.materialSlots[0]?.defaultColor ?? '#ddd'
        return (
          <g key={i} transform={`translate(${p.x} ${p.y}) rotate(${p.rotation ?? 0})`}>
            {o.kind === 'circle' ? (
              <circle r={o.r} fill={fill} stroke="#78716c" strokeWidth={hairline} />
            ) : (
              <rect
                x={-o.w / 2}
                y={-o.h / 2}
                width={o.w}
                height={o.h}
                fill={fill}
                stroke="#78716c"
                strokeWidth={hairline}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
