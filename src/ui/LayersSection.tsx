/**
 * Category layers — an eye (show/hide) and a lock per catalog category.
 * Layer state lives in scene.settings.layers (persisted per project, undoable);
 * rows derive from the live catalog, so an emptied category disappears on its own.
 */
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { CATEGORY_ORDER, listByCategory } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { setLayerHidden, setLayerLocked } from '../state/actions'
import { categoryCounts, isLayerHidden, isLayerLocked } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { Section } from './fields'
import { strings } from './strings'

const T = strings.inspector
const CATEGORIES = CATEGORY_ORDER.filter((c) => listByCategory(c).length > 0)

function LayerRow({ category, count }: { category: Category; count: number }) {
  const hidden = useEditorStore((s) => isLayerHidden(s.scene, category))
  const locked = useEditorStore((s) => isLayerLocked(s.scene, category))
  const btn = (active: boolean) =>
    active
      ? 'rounded-md border border-accent bg-accent-tint p-1 text-accent'
      : 'rounded-md border border-line p-1 text-ink-soft hover:border-accent hover:text-accent'

  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[12px] ${hidden ? 'text-ink-soft/60' : 'text-ink'}`}>
        {strings.catalog.categories[category]}{' '}
        <span className="ltr-nums text-[11px] text-ink-soft">({count})</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title={hidden ? T.layerShow : T.layerHide}
          aria-pressed={hidden}
          className={btn(hidden)}
          onClick={() => setLayerHidden(category, !hidden)}
        >
          {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          type="button"
          title={locked ? T.layerUnlock : T.layerLock}
          aria-pressed={locked}
          className={btn(locked)}
          onClick={() => setLayerLocked(category, !locked)}
        >
          {locked ? <Lock size={14} /> : <LockOpen size={14} />}
        </button>
      </div>
    </div>
  )
}

export function LayersSection() {
  const counts = useEditorStore(useShallow((s) => categoryCounts(s.scene)))
  return (
    <Section title={T.layers}>
      {CATEGORIES.map((cat) => (
        <LayerRow key={cat} category={cat} count={counts[cat] ?? 0} />
      ))}
    </Section>
  )
}
