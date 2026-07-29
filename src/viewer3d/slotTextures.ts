/**
 * Optional texture maps for a catalog slot — the missing half of GLB appearance.
 *
 * The only path that recolours a real model (`ObjectGroup.ModelParts`) clones the
 * material and sets `color`. On its own that is a TINT and nothing more. This
 * module supplies the other half: a `map` for the same clone.
 *
 * The map is no longer empty. `public/textures/fabric-01..22.webp` are 22 seamless
 * fabric textures generated through the Higgsfield MCP, one per rectangle of the
 * source swatch sheet, cut by `tools/textures-prep.mjs`. The nine registrations
 * below are LIVE — those objects render textured, not tinted.
 * Provenance, the 22-row measurement table and the numbering rule:
 * `Plans/R3/handoff/05-textures.md`.
 *
 * The other 18 textures stay on disk as the available palette. Nothing reads them
 * yet: a per-object picker would live in `ui/InspectorPanel.tsx` (see FOUND-05).
 *
 * ⚠ The key's slot is whatever `ObjectGroup` passes down, which is
 * `entry.editableColorSlot` (`ObjectGroup.tsx:721`) — `cloth` for tables, `body`
 * for napkins. A key naming any other slot is dead: nothing will ever look it up.
 *
 * Ownership note: `core/catalog/**` and `core/model/types.ts` belong to other
 * plans this wave, so the registry lives here in `viewer3d/` rather than as a
 * `textureUrl` field on `MaterialSlotDef`. When a catalog owner wants it, moving
 * this map into the slot definition is a mechanical change — `slotTextureUrl` is
 * the only reader.
 *
 * Caching: textures are shared per URL (they are immutable once loaded), but the
 * MATERIAL that carries one is always a per-object clone, never the cached entry
 * in `propModel.partCache`. Re-verified 2026-07-29 against `ObjectGroup.tsx:765`,
 * which clones before writing `map`. That is why no cache key changes here
 * (BRIEF §1.8) — anything that writes a map onto `parts[i].material` directly
 * would leak across every instance and would need a new cache key.
 */
import { useEffect, useState } from 'react'
import * as THREE from 'three'

/**
 * `${catalogId}|${slot}` → URL under `public/`.
 *
 * A slot with no entry is tinted only, which stays the behaviour for every entry
 * not named here.
 *
 * Why these files, chosen after looking at all 22 rendered swatches:
 *
 * - The six tables share ONE cloth. That is the real-inventory principle
 *   (`core/presets.ts:7-9`): a hall stocks a tablecloth, not six different ones.
 *   `fabric-06` is the cream damask trellis — a credible banquet cloth, and being
 *   patterned it also makes "this is a texture, not a tint" obvious on sight,
 *   which is what the visual check has to prove.
 * - The three napkins get three DIFFERENT light weaves so they stay
 *   distinguishable from each other and from the cloth under them:
 *   `fabric-13` mottled cream, `fabric-14` plain warm ivory, `fabric-19` the
 *   whitest and finest bouclé — which is the one the id `napkin-white` promises.
 */
export const SLOT_TEXTURES: Record<string, string> = {
  // napkins — slot is `body` (set by tableDecor.napkin(), :106)
  'decor.fabric-folded|body': '/textures/fabric-13.webp',
  'decor.napkin-folded|body': '/textures/fabric-14.webp',
  'decor.napkin-white|body': '/textures/fabric-19.webp',

  // tables — slot is `cloth` (editableColorSlot on all six entries)
  'table.round|cloth': '/textures/fabric-06.webp',
  'table.round-large|cloth': '/textures/fabric-06.webp',
  'table.square|cloth': '/textures/fabric-06.webp',
  'table.banquet|cloth': '/textures/fabric-06.webp',
  'table.knights-480|cloth': '/textures/fabric-06.webp',
  'table.serpentine|cloth': '/textures/fabric-06.webp',
}

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
