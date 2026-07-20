import { ChevronsLeft, ChevronsRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CATEGORY_ORDER, getCatalogEntry, listByCategory } from '../core/catalog/registry'
import type { CatalogEntry } from '../core/catalog/types'
import { TABLE_PRESETS, type TablePreset } from '../core/presets'
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

/** Top-view vector thumbnail rendered straight from the catalog footprint. */
function VectorThumbnail({ entry }: { entry: CatalogEntry }) {
  const fp = entry.footprint(entry.defaultSize)
  const w = fp.outline.kind === 'circle' ? fp.outline.r * 2 : fp.outline.w
  const h = fp.outline.kind === 'circle' ? fp.outline.r * 2 : fp.outline.h
  const pad = Math.max(w, h) * 0.12
  const vb = `${-w / 2 - pad} ${-h / 2 - pad} ${w + pad * 2} ${h + pad * 2}`
  const fill = (slot: string) =>
    entry.materialSlots.find((s) => s.name === slot)?.defaultColor ?? '#ddd'
  return (
    <svg viewBox={vb} className="h-16 w-full" aria-hidden>
      {fp.parts.map((p, i) =>
        p.kind === 'circle' ? (
          <circle key={i} r={p.r} fill={fill(p.slot)} stroke="#57534e" strokeWidth={Math.max(w, h) / 60} />
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
            strokeWidth={Math.max(w, h) / 60}
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

function presetLabel(preset: TablePreset): string {
  return (
    strings.presets.items[preset.labelKey as keyof typeof strings.presets.items] ?? preset.id
  )
}

/**
 * Ready-made table+chairs units. First in the panel on purpose: dropping a laid
 * table is the common case, and a bare table is the advanced one. The thumbnail
 * is the table's own — a preset never introduces an asset of its own.
 */
function LibraryPresets({ query }: { query: string }) {
  const placingPreset = useOverlayStore((s) => s.placingPreset)
  const items = TABLE_PRESETS.filter((p) => !query || presetLabel(p).includes(query.trim()))
  if (!items.length) return null
  return (
    <div className="mb-3">
      <h3 className="mb-1.5 text-[11px] font-semibold text-ink-soft">{strings.presets.library}</h3>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((preset) => {
          const table = getCatalogEntry(preset.tableCatalogId)
          const armed = placingPreset === preset.id
          return (
            <button
              key={preset.id}
              title={strings.library.placeHint}
              onMouseDown={(e) => {
                e.preventDefault()
                overlay.setPlacingPreset(armed ? null : preset.id, preset.tableCatalogId)
              }}
              className={`select-none rounded-lg border p-1.5 text-center transition-colors ${
                armed ? 'border-accent bg-accent-tint' : 'border-line bg-panel hover:border-accent/50'
              }`}
            >
              <Thumbnail entry={table} />
              <div className="mt-1 truncate text-[11px] font-medium">{presetLabel(preset)}</div>
              <div className="ltr-nums text-[10px] text-ink-soft">
                {preset.seatCount} {strings.presets.seatsSuffix}
              </div>
            </button>
          )
        })}
      </div>
    </div>
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
        <LibraryPresets query={query} />
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
