/**
 * Loading the fabric textures a slot wears — and nothing else any more.
 *
 * ⚠ `SLOT_TEXTURES` AND `slotTextureUrl` ARE GONE, and their deletion is round 4
 * §8. That map hard-wired nine `catalogId|slot` keys to a file, so a freshly
 * dropped table arrived already wearing `fabric-06`: "it also loads a tablecloth
 * texture automatically, when it should load on white by default". Which texture a
 * slot wears is catalogue data and a user choice, so it moved to where both live —
 * `EditableSlot.defaultTexture` (`core/catalog/types.ts`) and
 * `appearance[slot].textureId`. This file's own header used to say that moving the
 * map into the slot definition was a mechanical change waiting for a catalog owner
 * to want it. The six tables now declare NO default, which is what makes them
 * render their own baked white drape; the three napkins carry the exact ids this
 * map held, so they are unchanged.
 *
 * What survives is the loader, and it went PLURAL. A hook cannot be called in a
 * loop over a variable-length array, and an entry may now declare several editable
 * slots — so one call takes every URL an object needs at once.
 *
 * Caching: textures are shared per URL (they are immutable once loaded), but the
 * MATERIAL that carries one is always a per-object clone, never the cached entry in
 * `propModel.partCache`. Re-verified 2026-07-30 against `ObjectGroup.ModelParts`,
 * which clones before writing `map`. That is why no cache key changes here
 * (BRIEF §1.8) — anything that wrote a map onto `parts[i].material` directly would
 * leak across every instance and would need a new cache key.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

const textureCache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

/**
 * Loads N slot textures at once, shared per URL. Entry `i` is null until the URL at
 * `urls[i]` arrives — and stays null for an absent URL and for one that fails to
 * load, so the object renders untextured for a frame instead of suspending the
 * whole model. A missing or broken texture must never blank out the furniture.
 *
 * `urls` is a fresh array on every render, so the effect and the returned memo key
 * on its CONTENTS via `join('|')`. A texture path never contains '|', so equal keys
 * mean equal arrays; the ref carries the array itself past that key. Returning a
 * memo rather than a new array matters — `ModelParts` has it in a dependency list
 * that disposes and rebuilds materials when it changes.
 */
export function useSlotTextures(urls: (string | undefined)[]): (THREE.Texture | null)[] {
  const key = urls.join('|')
  const latest = useRef(urls)
  latest.current = urls
  // A counter, not the textures: `textureCache` is the source of truth and is
  // shared across every object, so this state exists only to ask for the render
  // that reads it once a load lands.
  const [loads, setLoads] = useState(0)

  useEffect(() => {
    let live = true
    for (const url of latest.current) {
      if (!url || textureCache.has(url)) continue
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
          if (live) setLoads((n) => n + 1)
        },
        undefined,
        // a broken file leaves the entry null forever, which is the untextured
        // render — retrying on every frame would be worse than the missing map
        () => {},
      )
    }
    return () => {
      live = false
    }
  }, [key])

  // `key` stands for `latest.current`; `loads` is what re-runs it when one arrives
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => latest.current.map((u) => (u && textureCache.get(u)) || null), [key, loads])
}
