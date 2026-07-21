import { ChevronsLeft, ChevronsRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CATEGORY_ORDER, listByCategory } from '../core/catalog/registry'
import type { CatalogEntry, FootprintPart } from '../core/catalog/types'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { strings } from './strings'

function itemLabel(entry: CatalogEntry): string {
  return strings.catalog.items[entry.labelKey as keyof typeof strings.catalog.items] ?? entry.id
}

function formatFootprint(entry: CatalogEntry): string {
  const { width, depth } = entry.defaultSize
  const m = (v: number) => (v / 100).toFixed(v % 100 === 0 ? 0 : 1)
  return entry.linkWidthDepth ? `Ø ${m(width)} מ'` : `${m(width)} × ${m(depth)} מ'`
}

/**
 * An 'arc' footprint part as an SVG path: out along the outer radius, back along
 * the inner one. SVG has no arc primitive, so unlike Konva this cannot reuse the
 * catalog fields directly. `large-arc` must be set past 180° or the renderer
 * silently takes the short way round and draws the complement of the band.
 */
function arcPath(p: Extract<FootprintPart, { kind: 'arc' }>): string {
  const at = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return [p.cx + Math.cos(a) * r, p.cy + Math.sin(a) * r] as const
  }
  const end = p.startAngle + p.sweep
  const large = Math.abs(p.sweep) > 180 ? 1 : 0
  const [ox0, oy0] = at(p.outerR, p.startAngle)
  const [ox1, oy1] = at(p.outerR, end)
  const [ix1, iy1] = at(p.innerR, end)
  const [ix0, iy0] = at(p.innerR, p.startAngle)
  // sweep-flag 1 = increasing angle, which is clockwise in this y-down space
  return (
    `M ${ox0} ${oy0} A ${p.outerR} ${p.outerR} 0 ${large} 1 ${ox1} ${oy1} ` +
    `L ${ix1} ${iy1} A ${p.innerR} ${p.innerR} 0 ${large} 0 ${ix0} ${iy0} Z`
  )
}

/** Curved edges only — omitting the two radial closures prevents join seams. */
function arcEdgePath(p: Extract<FootprintPart, { kind: 'arc' }>): string {
  const at = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return [p.cx + Math.cos(a) * r, p.cy + Math.sin(a) * r] as const
  }
  const end = p.startAngle + p.sweep
  const large = Math.abs(p.sweep) > 180 ? 1 : 0
  const [ox0, oy0] = at(p.outerR, p.startAngle)
  const [ox1, oy1] = at(p.outerR, end)
  const [ix0, iy0] = at(p.innerR, p.startAngle)
  const [ix1, iy1] = at(p.innerR, end)
  return `M ${ox0} ${oy0} A ${p.outerR} ${p.outerR} 0 ${large} 1 ${ox1} ${oy1} M ${ix0} ${iy0} A ${p.innerR} ${p.innerR} 0 ${large} 1 ${ix1} ${iy1}`
}

/** Top-view vector thumbnail rendered straight from the catalog footprint. */
function VectorThumbnail({ entry }: { entry: CatalogEntry }) {
  const fp = entry.footprint(entry.defaultSize)
  const w = fp.outline.kind === 'circle' ? fp.outline.r * 2 : fp.outline.w
  const h = fp.outline.kind === 'circle' ? fp.outline.r * 2 : fp.outline.h
  const pad = Math.max(w, h) * 0.12
  const vb = `${-w / 2 - pad} ${-h / 2 - pad} ${w + pad * 2} ${h + pad * 2}`
  const fill = (slot: string) =>
    entry.materialSlots.find((s) => s.name === slot)?.defaultColor ?? '#ddd'
  const stroke = Math.max(w, h) / 60
  return (
    <svg viewBox={vb} className="h-16 w-full" aria-hidden>
      {fp.parts.map((p, i) =>
        p.kind === 'circle' ? (
          <circle key={i} r={p.r} fill={fill(p.slot)} stroke="#57534e" strokeWidth={stroke} />
        ) : p.kind === 'arc' ? (
          <g key={i}>
            <path d={arcPath(p)} fill={fill(p.slot)} />
            <path d={arcEdgePath(p)} fill="none" stroke="#57534e" strokeWidth={stroke} />
          </g>
        ) : (
          <rect
            key={i}
            x={(p.cx ?? 0) - p.w / 2}
            y={(p.cy ?? 0) - p.h / 2}
            width={p.w}
            height={p.h}
            rx={p.cornerRadius ?? 0}
            fill={fill(p.slot)}
            stroke="#57534e"
            strokeWidth={stroke}
          />
        ),
      )}
    </svg>
  )
}

/** Photo thumbnail when the entry has one; the vector top-view otherwise / on error. */
function Thumbnail({ entry }: { entry: CatalogEntry }) {
  const [broken, setBroken] = useState(false)
  if (!entry.thumbnail || broken) return <VectorThumbnail entry={entry} />
  return (
    <img
      src={entry.thumbnail}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setBroken(true)}
      className="h-16 w-full rounded object-cover"
    />
  )
}

export function LibraryPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const placing = useOverlayStore((s) => s.placing)

  const categories = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        cat,
        label: strings.catalog.categories[cat],
        items: listByCategory(cat).filter(
          (e) => !query || itemLabel(e).includes(query.trim()),
        ),
      })).filter((c) => c.items.length > 0),
    [query],
  )

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-s border-line bg-panel py-2">
        <button
          title={strings.library.expand}
          className="rounded-md p-1.5 text-ink-soft hover:bg-accent-tint hover:text-ink"
          onClick={() => setCollapsed(false)}
        >
          <ChevronsLeft size={16} className="rtl:-scale-x-100" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-s border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="flex-1 text-[13px] font-semibold">{strings.library.title}</h2>
        <button
          title={strings.library.collapse}
          className="rounded-md p-1 text-ink-soft hover:bg-accent-tint hover:text-ink"
          onClick={() => setCollapsed(true)}
        >
          <ChevronsRight size={16} className="rtl:-scale-x-100" />
        </button>
      </div>
      <div className="border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 focus-within:border-accent">
          <Search size={14} className="text-ink-soft" />
          <input
            className="w-full bg-transparent text-[12px] focus:outline-none"
            placeholder={strings.library.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {categories.length === 0 && (
          <div className="py-6 text-center text-[12px] text-ink-soft">
            <p>
              {strings.library.noResults} "{query}"
            </p>
            <button className="mt-2 text-accent hover:underline" onClick={() => setQuery('')}>
              {strings.library.clearSearch}
            </button>
          </div>
        )}
        {categories.map(({ cat, label, items }) => (
          <div key={cat} className="mb-3">
            <h3 className="mb-1.5 text-[11px] font-semibold text-ink-soft">{label}</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((entry) => (
                <button
                  key={entry.id}
                  title={strings.library.placeHint}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    overlay.setPlacing(placing === entry.id ? null : entry.id)
                  }}
                  className={`select-none rounded-lg border p-1.5 text-center transition-colors ${
                    placing === entry.id
                      ? 'border-accent bg-accent-tint'
                      : 'border-line bg-panel hover:border-accent/50'
                  }`}
                >
                  <Thumbnail entry={entry} />
                  <div className="mt-1 truncate text-[11px] font-medium">{itemLabel(entry)}</div>
                  <div className="ltr-nums text-[10px] text-ink-soft">{formatFootprint(entry)}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
