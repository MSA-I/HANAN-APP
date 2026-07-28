/**
 * Colour maths for the architectural plan look (Plans/R2/handoff/04-plan-style.md).
 *
 * On a plan the building is the dark thing and its contents are the light thing:
 * furniture reads as a thin outline, not as a filled shape. The catalog colour is
 * still what tells a brown chair from a white one, so it is washed most of the way
 * to white rather than dropped — the hue survives, the block of colour does not.
 */

/** Fraction of the way to white a furniture fill is pushed on the plan. */
export const PLAN_FILL_WHITEN = 0.82

interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * `#rgb` / `#rrggbb` / `#rrggbbff`, or null for anything else.
 *
 * Returning null for a translucent colour is deliberate, not a gap: a fill that
 * is already see-through is carrying a meaning of its own (the placing ghost
 * paints `rgba(214,69,69,0.25)` when the drop is illegal), and washing that out
 * would erase the warning. Named colours and gradients get the same treatment —
 * they cannot be read reliably, and mangling them is worse than leaving them.
 */
function parseOpaque(color: string): Rgb | null {
  const hex = color.trim().toLowerCase()
  if (hex.startsWith('#')) {
    const body = hex.slice(1)
    if (/^[0-9a-f]{3}$/.test(body)) {
      return {
        r: parseInt(body[0] + body[0], 16),
        g: parseInt(body[1] + body[1], 16),
        b: parseInt(body[2] + body[2], 16),
      }
    }
    if (/^[0-9a-f]{6}(ff)?$/.test(body)) {
      return {
        r: parseInt(body.slice(0, 2), 16),
        g: parseInt(body.slice(2, 4), 16),
        b: parseInt(body.slice(4, 6), 16),
      }
    }
    return null
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(hex)
  if (!fn) return null
  const parts = fn[1].split(/[,/\s]+/).filter(Boolean).map(Number)
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null
  if (parts.length > 3 && parts[3] < 1) return null
  return { r: parts[0], g: parts[1], b: parts[2] }
}

function toHex(v: number): string {
  return Math.round(Math.min(255, Math.max(0, v)))
    .toString(16)
    .padStart(2, '0')
}

/**
 * A catalog colour as the plan draws it: mixed `amount` of the way to white.
 *
 * Colours this cannot read opaquely come back untouched — see `parseOpaque`.
 */
export function planFill(color: string, amount: number = PLAN_FILL_WHITEN): string {
  const rgb = parseOpaque(color)
  if (!rgb) return color
  const t = Math.min(1, Math.max(0, amount))
  const wash = (c: number) => toHex(c + (255 - c) * t)
  return `#${wash(rgb.r)}${wash(rgb.g)}${wash(rgb.b)}`
}
