import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

export type MenuEntry = MenuItem | 'separator'

interface Props {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 220)
  const top = Math.min(y, window.innerHeight - items.length * 32 - 16)

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-52 rounded-lg border border-line bg-panel py-1 shadow-lg"
      style={{ left, top }}
      role="menu"
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 border-t border-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-start text-[13px] ${
              item.disabled
                ? 'cursor-default text-ink-soft/50'
                : item.danger
                  ? 'text-danger hover:bg-danger/10'
                  : 'text-ink hover:bg-accent-tint'
            }`}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onClick()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="ltr-nums text-[11px] text-ink-soft">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  )
}
