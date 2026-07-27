/**
 * Top-down plan images for the 2D editor — public/plan/, built by
 * tools/topdown-prep.mjs from the same GLBs the 3D viewer renders.
 *
 * The manifest is keyed by GLB path (`entry.model`) because several catalog
 * entries share one model, and it carries the plan-cm span of each image so the
 * drawing side never hardcodes a scale. See Plans/handoff/06-topdown-manifest.md.
 *
 * Caching mirrors `partCache` in viewer3d/propModel.ts: module-level, keyed by
 * everything that changes the pixels. A full hall is ~40 tables and ~480 chairs
 * off maybe a dozen distinct images, and Konva costs nothing extra for reusing
 * the same image object across nodes.
 */
import { useEffect, useReducer } from 'react'

export interface PlanImage {
  image: CanvasImageSource
  /** plan cm the image spans at the model's natural size (2% padding included) */
  cmW: number
  cmD: number
}

interface ManifestItem {
  file: string
  cmW: number
  cmD: number
}

const MANIFEST_URL = '/plan/manifest.json'

const cache = new Map<string, PlanImage>()
const inFlight = new Map<string, Promise<PlanImage | null>>()
/** Keys with no image — an entry whose GLB was never rendered, or a 404. */
const absent = new Set<string>()
let manifestRequest: Promise<Record<string, ManifestItem>> | null = null

function loadManifest(): Promise<Record<string, ManifestItem>> {
  manifestRequest ??= fetch(MANIFEST_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((m: { items?: Record<string, ManifestItem> } | null) => m?.items ?? {})
    .catch(() => ({}))
  return manifestRequest
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`plan image failed: ${url}`))
    img.src = url
  })
}

/**
 * Bake the appearance colour into a copy of the image, once per colour.
 *
 * This is the same operation 3D does — it sets `material.color`, and three
 * multiplies the base texture by it — so doing it any other way would make the
 * two views disagree, which is the whole point of these images.
 *
 * Baking beats Konva's alternatives: `Konva.Filters.RGB` replaces the colour
 * outright (flattening the render to a silhouette) and needs a per-node
 * `cache()`, and a `multiply` composite op would blend against everything
 * already drawn in the layer, not just this object. One canvas per colour, held
 * forever, costs nothing per frame.
 */
function tint(img: HTMLImageElement, color: string): CanvasImageSource {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return img
  ctx.drawImage(img, 0, 0)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // the fill also multiplied the transparent surround up to opaque; the source
  // alpha is the mask that puts the cut-out back
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(img, 0, 0)
  return canvas
}

async function build(model: string, color: string | null): Promise<PlanImage | null> {
  const item = (await loadManifest())[model]
  if (!item) return null
  const img = await loadImage(`/plan/${item.file}`)
  return { image: color ? tint(img, color) : img, cmW: item.cmW, cmD: item.cmD }
}

const keyOf = (model: string, color: string | null) => `${model}|${color ?? ''}`

/**
 * The plan image for a catalog entry's GLB, or null while it loads and for
 * every entry without one (`buffet.table`, `divider.screen`) — those keep the
 * vector footprint, which stays the fallback rather than being replaced.
 */
export function usePlanImage(model: string | undefined, color: string | null): PlanImage | null {
  const key = model ? keyOf(model, color) : null
  // read through the cache on every render, so a node that mounts after the
  // image has landed draws it on its first frame instead of one frame late
  const current = key ? (cache.get(key) ?? null) : null
  const [, redraw] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!model || !key || current || absent.has(key)) return
    let alive = true
    let request = inFlight.get(key)
    if (!request) {
      request = build(model, color)
      inFlight.set(key, request)
    }
    request
      .then((result) => {
        inFlight.delete(key)
        if (result) cache.set(key, result)
        else absent.add(key)
        if (alive) redraw()
      })
      .catch(() => {
        inFlight.delete(key)
        absent.add(key)
        if (alive) redraw()
      })
    return () => {
      alive = false
    }
  }, [model, key, color, current])

  return current
}
