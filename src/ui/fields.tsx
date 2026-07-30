import { Minus, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { textureUrl } from '../core/catalog/textures'

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

/**
 * The venue's REAL linen, sampled from its three fabric sample charts
 * (HANAN-APP-DOCS/GPT/צבעי מפות ומפיות/, source doc §50) rather than chosen —
 * 22 solid velvet napkins, then 22 patterned table fabrics, then 10 folded
 * linens, in each chart's own reading order.
 *
 * Each hex is the PER-CHANNEL MEDIAN of a patch at the centre of one swatch.
 * Median, not mean: half of the second chart's fabrics carry a woven lattice or a
 * printed motif, and a mean would drag every one of them toward the motif. The
 * sampling script and the exact patch coordinates are in handoff/03-sizes.md, and
 * re-running it reproduces this list. Sampling is stable to ±8/255 per channel
 * across a wide range of patch sizes, so these are the fabrics' colours and not
 * an artefact of where the patch was put.
 *
 * 11 of the 54 swatches are dropped as perceptual duplicates of an earlier one
 * (redmean² ≤ 250 — the same metric core/prompts/fragments.ts uses). That is not
 * a preference: `ColorField` renders this array with `key={c}`, so two identical
 * hexes would be two identical React keys, and two circles a user cannot tell
 * apart are one control drawn twice. Which 11, and what they collided with, is in
 * handoff/03-sizes.md.
 *
 * ⚠ core/prompts/fragments.ts:38-51 opens with these twelve VERBATIM, so that a
 * palette pick becomes an exact English colour word for the image prompt. It no
 * longer matches — that file is PLAN-08's, and the mismatch is written up in
 * handoff/FOUND-03.md. Nothing breaks: `hexToColorName` falls through to
 * nearest-neighbour over its remaining 20 general names.
 */
export const EVENT_SWATCHES = [
  // chart 1 — solid velvet napkins (hf_20260728_115447), row 1
  '#e7e5e0',
  '#e3ca8d',
  '#a5601a',
  '#141312',
  '#18244d',
  '#c2060d',
  '#92bcdf',
  '#f05d08',
  '#ec3d60',
  '#f1c3bb',
  '#cece1b',
  // chart 1, row 2
  '#0890a5',
  '#94bb0c',
  '#27adbb',
  '#28134a',
  '#372a79',
  '#c3708c',
  '#d7070e',
  '#beb7b2',
  '#5c3a23',
  '#d5ae81',
  '#f5d00a',
  // chart 2 — patterned table fabrics (hf_20260728_115548)
  '#263759',
  '#b4b6ba',
  '#323e4b',
  '#c5cfd1',
  '#a8a4a1',
  '#b8aea7',
  '#e1dfda',
  '#cbc3bb',
  '#d5ccbd',
  '#d9c5a7',
  '#d2c3b0',
  '#dcd8d4',
  '#0e3779',
  '#8e928a',
  // chart 3 — folded linens (hf_20260728_115632)
  '#cbb09b',
  '#e6d7ca',
  '#435870',
  '#d0a26b',
  '#bd8879',
  '#81a4cb',
  '#746f60',
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
   * 57e15f9 deliberately narrowed this field to the event colours, and only the
   * slots that opt in via `MaterialSlotDef.allowCustomColor` (the three napkins)
   * may reopen it.
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

interface TextureFieldProps {
  label: string
  /** FABRIC_TEXTURE_IDS, in catalogue order */
  options: readonly string[]
  /** the id in force — the user's pick or the slot default — or null for "no texture" */
  value: string | null
  noneLabel: string
  onChange: (textureId: string | null) => void
}

/**
 * The fabric swatch picker, beside `ColorField` on any slot whose `EditableSlot`
 * says `texture: true` (round 4 §8: "in the previous round I asked to create a
 * texture of tablecloths, but now when I go in and pick a table I don't even have
 * the option to choose a texture — I only have the colours").
 *
 * The FIRST tile is "none", and it is not decoration: with 22 swatches and a
 * catalogue that gives the three napkins a default weave, "take it off" is a
 * choice the user has to be able to make, and it is a different answer from "I
 * have not chosen" (see `AppearanceOverrides`). A diagonal rule rather than an
 * icon, because the tile is 28px and any glyph at that size reads as a swatch.
 *
 * Same two border classes as `ColorField` so the two controls agree on what
 * "selected" looks like, and `type="button"` for the reason recorded there — the
 * inspector is not a form today, but the field is exported and the colour one is
 * already used inside one.
 *
 * RTL: `flex-wrap` + `gap` only. No `ml-`/`mr-`/`left-`/`right-` anywhere, so the
 * grid flows from the right in Hebrew without a mirrored stylesheet.
 */
export function TextureField({ label, options, value, noneLabel, onChange }: TextureFieldProps) {
  const tile = 'h-7 w-7 shrink-0 overflow-hidden rounded-md border transition-colors'
  const state = (on: boolean) => (on ? 'border-accent ring-1 ring-accent' : 'border-line')
  return (
    <div>
      <div className="mb-1.5 text-[14px] text-ink-soft">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title={noneLabel}
          aria-label={noneLabel}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
          className={`${tile} ${state(value === null)} relative bg-panel`}
        >
          {/* the rule is drawn corner to corner in the button's own box, so it
              scales with the tile instead of being a fixed-size glyph */}
          <span className="absolute inset-0" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-full w-full" preserveAspectRatio="none">
              <line x1="2" y1="22" x2="22" y2="2" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>
        </button>
        {options.map((id) => (
          <button
            key={id}
            type="button"
            title={id}
            aria-label={id}
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            className={`${tile} ${state(value === id)}`}
          >
            {/* 22 swatches at ~300KB each: `loading="lazy"` keeps the ones below
                the panel's fold off the wire until the section is scrolled to.
                `draggable={false}` because the canvas behind accepts drops and a
                dragged swatch image would land on it. */}
            <img
              src={textureUrl(id)}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full rounded-[5px] object-cover"
            />
          </button>
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
