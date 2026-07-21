import { Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <h3 className="mb-2.5 text-[11px] font-semibold text-ink-soft">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-ink-soft">{label}</span>
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
        className="w-24 rounded-md border border-line bg-panel px-2 py-1 text-end font-mono text-[12px] focus:border-accent focus:outline-none"
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

interface ColorFieldProps {
  label: string
  value: string
  onChange: (color: string) => void
}

export function ColorField({ label, value, onChange }: ColorFieldProps) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-ink-soft">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {EVENT_SWATCHES.map((c) => (
          <button
            key={c}
            // explicit type — inside a form (new-project dialog) a default
            // submit-button swatch would submit on pick
            type="button"
            className={`h-5 w-5 rounded-full border ${
              value.toLowerCase() === c ? 'border-accent ring-1 ring-accent' : 'border-line'
            }`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
            aria-pressed={value.toLowerCase() === c}
          />
        ))}
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
        <span className="text-[12px] text-ink-soft">{label}</span>
        <span className="ltr-nums text-[12px] font-medium text-ink">
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
        <span className="text-[12px] text-ink-soft">{label}</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded-md border border-line p-1 hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={value <= min}
            onClick={() => onChange(value - 1)}
            aria-label="-"
          >
            <Minus size={13} />
          </button>
          <span className="ltr-nums w-8 text-center text-[13px] font-semibold">{value}</span>
          <button
            className="rounded-md border border-line p-1 hover:border-accent hover:text-accent disabled:opacity-40"
            disabled={value >= max}
            onClick={() => onChange(value + 1)}
            aria-label="+"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      {hint && <p className="mt-1 text-[11px] text-ink-soft">{hint}</p>}
    </div>
  )
}
