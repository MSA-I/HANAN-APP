/**
 * Category layers — an eye (show/hide) and a lock per catalog category.
 * Layer state lives in scene.settings.layers (persisted per project, undoable).
 *
 * Rows derive from the SCENE, not the catalog: a category with nothing placed in
 * it has no row, so a brand-new project shows an empty panel instead of nine
 * `(0)` rows that read as "something is already on the board". The one exception
 * is a category that still carries a hidden/locked flag — dropping its row while
 * it is hidden would strand the objects with no way to bring them back.
 */
import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { CATEGORY_ORDER } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { setLayerHidden, setLayerLocked } from '../state/actions'
import { categoryCounts, isLayerHidden, isLayerLocked } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { Section } from './fields'
import { strings } from './strings'

const T = strings.inspector

function LayerRow({ category, count }: { category: Category; count: number }) {
  const hidden = useEditorStore((s) => isLayerHidden(s.scene, category))
  const locked = useEditorStore((s) => isLayerLocked(s.scene, category))
  const btn = (active: boolean) =>
    active
      ? 'rounded-md border border-accent bg-accent-tint p-1.5 text-accent'
      : 'rounded-md border border-line p-1.5 text-ink-soft hover:border-accent hover:text-accent'

  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[14px] ${hidden ? 'text-ink-soft/60' : 'text-ink'}`}>
        {strings.catalog.categories[category]}{' '}
        <span className="ltr-nums text-[13px] text-ink-soft">({count})</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          title={hidden ? T.layerShow : T.layerHide}
          aria-pressed={hidden}
          className={btn(hidden)}
          onClick={() => setLayerHidden(category, !hidden)}
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          title={locked ? T.layerUnlock : T.layerLock}
          aria-pressed={locked}
          className={btn(locked)}
          onClick={() => setLayerLocked(category, !locked)}
        >
          {locked ? <Lock size={16} /> : <LockOpen size={16} />}
        </button>
      </div>
    </div>
  )
}

export function LayersSection() {
  const counts = useEditorStore(useShallow((s) => categoryCounts(s.scene)))
  // setLayerFlag drops all-default records, so a surviving flag is the only way
  // an empty category can still need a row (to be un-hidden / un-locked again)
  const flagged = useEditorStore(
    useShallow((s) =>
      CATEGORY_ORDER.filter((c) => isLayerHidden(s.scene, c) || isLayerLocked(s.scene, c)),
    ),
  )
  const rows = CATEGORY_ORDER.filter((c) => (counts[c] ?? 0) > 0 || flagged.includes(c))
  return (
    <Section title={T.layers}>
      {rows.map((cat) => (
        <LayerRow key={cat} category={cat} count={counts[cat] ?? 0} />
      ))}
    </Section>
  )
}
