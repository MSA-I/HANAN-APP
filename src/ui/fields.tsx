import { Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3.5">
      <h3 className="mb-3 text-[16px] font-semibold text-ink">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[14px] text-ink-soft">{label}</span>
      {children}
    </label>
  )
}

type Unit = 'm' | 'cm' | 'deg' | 'int'

const toDisplay = (v: number, unit: Unit) =>
  unit === 'm' ? String(Math.round(v) / 100) : String(Math.round(v))
const fromDisplay = (v: number, unit: Unit) => (unit === 'm' ? v * 100 : v)

interface NumberFieldProps {
  label: string
  /** model value — cm for m/cm units, degrees for deg */
  value: number
  unit?: Unit
  step?: number
  min?: number
  max?: number
  onCommit: (modelValue: number) => void
}

/** Numeric input: LTR digits inside RTL layout, commit on Enter/blur. */
export function NumberField({ label, value, unit = 'm', step, min, max, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(() => toDisplay(value, unit))

  useEffect(() => {
    setText(toDisplay(value, unit))
  }, [value, unit])

  const commit = () => {
    const parsed = parseFloat(text)
    if (Number.isNaN(parsed)) {
      setText(toDisplay(value, unit))
      return
    }
    let model = fromDisplay(parsed, unit)
    if (min !== undefined) model = Math.max(min, model)
    if (max !== undefined) model = Math.min(max, model)
    onCommit(model)
    setText(toDisplay(model, unit))
  }

  return (
    <FieldRow label={label}>
      <input
        dir="ltr"
        type="number"
        step={step ?? (unit === 'm' ? 0.1 : 1)}
        className="min-h-9 w-24 rounded-md border border-line bg-panel px-2 py-1.5 text-end font-mono text-[14px] focus:border-accent focus:outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          e.stopPropagation()
        }}
      />
    </FieldRow>
  )
}

export const EVENT_SWATCHES = [
  '#ffffff',
  '#f5f0e8',
  '#eddcc5',
  '#e8c4c4',
  '#c98d8d',
  '#b96a4b',
  '#c9a86a',
  '#a8b5a0',
  '#708c5f',
  '#33518f',
  '#7a2e3f',
  '#3a3633',
]

/** Rainbow rim on the free-picker control — reads as "any colour" without a label. */
const SPECTRUM =
  'conic-gradient(#ef4444,#f59e0b,#eab308,#22c55e,#06b6d4,#3b82f6,#8b5cf6,#ec4899,#ef4444)'

const HEX6 = /^#[0-9a-f]{6}$/i

interface ColorFieldProps {
  label: string
  value: string
  onChange: (color: string) => void
  /**
   * Adds a native picker next to the fixed palette. Off by default: commit
   * 57e15f9 deliberately narrowed this field to the twelve event colours, and
   * only the slots that opt in via `MaterialSlotDef.allowCustomColor` (the two
   * napkins) may reopen it.
   */
  allowCustom?: boolean
}

export function ColorField({ label, value, onChange, allowCustom }: ColorFieldProps) {
  const current = value.toLowerCase()
  const offPalette = !EVENT_SWATCHES.includes(current)
  return (
    <div>
      <div className="mb-1.5 text-[14px] text-ink-soft">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {EVENT_SWATCHES.map((c) => (
          <button
            key={c}
            // explicit type — inside a form (new-project dialog) a default
            // submit-button swatch would submit on pick
            type="button"
            className={`h-6 w-6 rounded-full border ${
              current === c ? 'border-accent ring-1 ring-accent' : 'border-line'
            }`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
            aria-pressed={current === c}
          />
        ))}
        {allowCustom && (
          // the input covers the whole control (opacity-0 rather than hidden, so
          // it stays keyboard-reachable); focus-within carries the focus ring
          <label
            title={label}
            className={`relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border focus-within:ring-2 focus-within:ring-accent ${
              offPalette ? 'border-accent ring-1 ring-accent' : 'border-line'
            }`}
            style={{ background: SPECTRUM }}
          >
            <span
              className="h-3 w-3 rounded-full border border-white/70"
              style={{ background: value }}
            />
            <input
              type="color"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              value={HEX6.test(current) ? current : '#ffffff'}
              onChange={(e) => onChange(e.target.value)}
              aria-label={label}
            />
          </label>
        )}
      </div>
    </div>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** shown after the value, e.g. '°' */
  unit?: string
  onChange: (v: number) => void
}

/** Range slider: LTR track inside RTL layout, live value readout. */
export function SliderField({ label, value, min, max, step = 1, unit = '', onChange }: SliderFieldProps) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[14px] text-ink-soft">{label}</span>
        <span className="ltr-nums text-[14px] font-medium text-ink">
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
      <input
        dir="ltr"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
        aria-label={label}
      />
    </div>
  )
}

interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  hint?: string
  onChange: (v: number) => void
}

export function Stepper({ label, value, min, max, hint, onChange }: StepperProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-ink-soft">{label}</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded-md border border-line p-1.5 hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={value <= min}
            onClick={() => onChange(value - 1)}
            aria-label="-"
          >
            <Minus size={15} />
          </button>
          <span className="ltr-nums w-8 text-center text-[14px] font-semibold">{value}</span>
          <button
            className="rounded-md border border-line p-1.5 hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={value >= max}
            onClick={() => onChange(value + 1)}
            aria-label="+"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      {hint && <p className="mt-1 text-[13px] text-ink-soft">{hint}</p>}
    </div>
  )
}
