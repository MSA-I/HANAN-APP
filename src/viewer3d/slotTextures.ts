/**
 * Optional texture maps for a catalog slot — the missing half of GLB appearance.
 *
 * The only path that recolours a real model (`ObjectGroup.ModelParts`) clones the
 * material and sets `color`. That is a TINT and nothing more: even if the 22
 * tablecloth/napkin images existed on disk today, nothing in the app would load
 * them. This module is the contract that closes that gap, and it deliberately
 * ships EMPTY — with no registration the renderer keeps tinting and behaves
 * exactly as before.
 *
 * Where the paths will come from: PLAN-03/A2 mapped 22 fabric rectangles in pixel
 * coordinates (Plans/R2/handoff/BLOCKED-03-A2.md) out of the Higgsfield sheets.
 * When those are cut, they land under `public/textures/` and each gets one line in
 * `SLOT_TEXTURES` below. Nothing else has to change.
 *
 * Ownership note: `core/catalog/**` and `core/model/types.ts` belong to other
 * plans this wave, so the registry lives here in `viewer3d/` rather than as a
 * `textureUrl` field on `MaterialSlotDef`. When a catalog owner wants it, moving
 * this map into the slot definition is a mechanical change — `slotTextureUrl` is
 * the only reader.
 *
 * Caching: textures are shared per URL (they are immutable once loaded), but the
 * MATERIAL that carries one is always a per-object clone, never the cached entry
 * in `propModel.partCache`. That is why no cache key changes here (BRIEF §1.8) —
 * verify that still holds before applying a map anywhere other than a clone.
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'

/**
 * `${catalogId}|${slot}` → URL under `public/`.
 *
 * Empty on purpose. A slot with no entry is tinted only, which is the behaviour
 * every entry has today.
 */
const SLOT_TEXTURES: Record<string, string> = {}

/** The map registered for a catalog slot, or undefined — the normal case. */
export function slotTextureUrl(catalogId: string, slot: string | undefined): string | undefined {
  return slot ? SLOT_TEXTURES[`${catalogId}|${slot}`] : undefined
}

const textureCache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

/**
 * Loads a slot texture once per URL and shares it. Returns null until it arrives,
 * so the object renders tinted-only for a frame instead of suspending the whole
 * model — a missing or broken texture must never blank out the furniture.
 */
export function useSlotTexture(url: string | undefined): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(
    () => (url && textureCache.get(url)) || null,
  )

  useEffect(() => {
    if (!url) {
      setTexture(null)
      return
    }
    const cached = textureCache.get(url)
    if (cached) {
      setTexture(cached)
      return
    }
    let live = true
    loader.load(
      url,
      (loaded) => {
        // colour data, so sRGB; and flipY off because these sit on glTF UVs,
        // which GLTFLoader itself loads that way
        loaded.colorSpace = THREE.SRGBColorSpace
        loaded.flipY = false
        loaded.wrapS = THREE.RepeatWrapping
        loaded.wrapT = THREE.RepeatWrapping
        textureCache.set(url, loaded)
        if (live) setTexture(loaded)
      },
      undefined,
      () => {
        if (live) setTexture(null)
      },
    )
    return () => {
      live = false
    }
  }, [url])

  return texture
}
