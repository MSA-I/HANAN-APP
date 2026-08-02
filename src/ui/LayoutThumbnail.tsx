/**
 * Top-view SVG schematic of a hall layout — the picker thumbnail. Pure
 * derivation from the SAME data the apply action consumes (venue pack shape +
 * layout placements), so it can never drift from what clicking will produce.
 * Plan space is y-down like SVG, so coordinates map through directly.
 */
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { slotColor } from '../core/catalog/types'
import type { HallLayout } from '../core/hallLayouts'
import { getTablePreset } from '../core/presets'
import type { SavedLayout } from '../core/savedLayouts'
import { chuppahLocationOf, zonesFor } from '../core/layout/venueZones'
import { getVenuePack } from '../core/venuePacks'
import { useEditorStore } from '../state/store'

function ThumbnailFrame({
  width,
  depth,
  floorAreas,
  restricted,
  children,
}: {
  width: number
  depth: number
  floorAreas?: [number, number][][]
  restricted?: readonly { x: number; y: number; width: number; depth: number }[]
  children: (hairline: number) => React.ReactNode
}) {
  const pad = Math.max(width, depth) * 0.02
  const hairline = Math.max(width, depth) / 400
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`}
      className="w-full rounded bg-canvas"
      aria-hidden
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={depth}
        fill="#faf9f7"
        stroke="#d6d3d1"
        strokeWidth={hairline * 2}
      />
      {floorAreas?.map((poly, i) => (
        <polygon key={i} points={poly.map(([x, y]) => `${x},${y}`).join(' ')} fill="#eef0e6" />
      ))}
      {restricted?.map((zone, i) => (
        <rect key={i} x={zone.x} y={zone.y} width={zone.width} height={zone.depth} fill="#dde7f2" />
      ))}
      {children(hairline)}
    </svg>
  )
}

export function LayoutThumbnail({ layout }: { layout: HallLayout }) {
  // The switch is a property of the OPEN project, and this mini-map draws the
  // venue the layout would be applied into — so it shows the pad that is live
  // now, exactly as the plan behind it does.
  const location = useEditorStore((s) => chuppahLocationOf(s.scene))
  const pack = getVenuePack(layout.venuePackId)
  if (!pack) return null
  const { width, depth } = pack.size

  return (
    <ThumbnailFrame
      width={width}
      depth={depth}
      floorAreas={pack.floorAreas}
      restricted={zonesFor(layout.venuePackId, location)}
    >
      {(hairline) => (
        <>
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
        </>
      )}
    </ThumbnailFrame>
  )
}

/** Vector preview for a user-saved selection, derived from the same snapshot
 * that will be instantiated. */
export function SavedLayoutThumbnail({ layout }: { layout: SavedLayout }) {
  // same reasoning as `LayoutThumbnail` above
  const location = useEditorStore((s) => chuppahLocationOf(s.scene))
  const pack = layout.venue.kind === 'pack' ? getVenuePack(layout.venue.venuePackId) : undefined
  if (layout.venue.kind === 'pack' && !pack) return null
  const size = pack?.size ?? (layout.venue.kind === 'manual' ? layout.venue : null)
  if (!size) return null
  return (
    <ThumbnailFrame
      width={size.width}
      depth={size.depth}
      floorAreas={pack?.floorAreas}
      restricted={pack && zonesFor(pack.id, location)}
    >
      {(hairline) => (
        <>
          {layout.subtrees.map(({ root }, i) => {
            // a snapshot may name an item the catalog no longer has — skip it
            // rather than let getCatalogEntry throw through the whole panel
            if (!hasCatalogEntry(root.catalogId)) return null
            const entry = getCatalogEntry(root.catalogId)
            const outline = entry.footprint(root.size).outline
            const firstSlot = entry.materialSlots[0]?.name
            const fill = firstSlot ? slotColor(entry, root.appearance, firstSlot) : '#d6d3d1'
            return (
              <g
                key={i}
                transform={`translate(${root.transform.position.x} ${root.transform.position.y}) rotate(${root.transform.rotation})`}
              >
                {outline.kind === 'circle' ? (
                  <circle r={outline.r} fill={fill} stroke="#57534e" strokeWidth={hairline} />
                ) : (
                  <rect
                    x={-outline.w / 2}
                    y={-outline.h / 2}
                    width={outline.w}
                    height={outline.h}
                    fill={fill}
                    stroke="#57534e"
                    strokeWidth={hairline}
                  />
                )}
              </g>
            )
          })}
        </>
      )}
    </ThumbnailFrame>
  )
}
