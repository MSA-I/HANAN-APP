/**
 * Real furniture GLBs (Tripo → tools/glb-prep --mode prop) for catalog entries
 * that declare a `model`. glb-prep already normalised each file to real cm
 * dimensions, Y-up, base at y=0 and centred, so most models render at scale 1.
 *
 * The model is fitted to the object's STORED size, which is the one number the
 * plan footprint, the selection outline, snapping and the zone clamp all read —
 * so 2D and 3D can never disagree about how big a thing is. The ratio is taken
 * against `modelSize` (the file's own real size) where an entry declares one,
 * and against `defaultSize` otherwise, since for most entries they are the same.
 *
 * Fitting is NOT done against the loaded geometry's bounding box. glb-prep yaws
 * each model to the app's facing convention, and a chair yawed off a right angle
 * has an axis-aligned bbox noticeably larger than the chair (a 45cm seat at 74°
 * measures 55cm corner to corner). Scaling to that bbox would squash every
 * rotated model back down — the declared size is a measurement, the bbox is not.
 *
 * Materials are cached with the model. ObjectGroup clones them only when an
 * explicitly editable catalog slot has a color override, preserving maps and PBR
 * settings while keeping the cached originals untouched.
 */
import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getCatalogEntry } from '../core/catalog/registry'
import type { Size3D } from '../core/model/types'
import { LruCache } from './lru'

export interface ModelPart {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/**
 * Bounded by entry x size: 63 catalog entries, and a long session tries a
 * handful of sizes for each. 200 is roughly three sizes apiece — past that,
 * evicting the least recently used one costs a reload of geometry that is
 * already off screen.
 *
 * Only the GEOMETRY is disposed. The material belongs to the GLB scene that
 * drei's useGLTF cache still owns and other sizes of the same entry still point
 * at it; disposing it here would take out a model that is on screen.
 */
const partCache = new LruCache<ModelPart[]>(200, (parts) => {
  for (const part of parts) part.geometry.dispose()
})

function buildParts(scene: THREE.Object3D, catalogId: string, size: Size3D): ModelPart[] {
  const entry = getCatalogEntry(catalogId)
  const key = `${catalogId}|${size.width}x${size.depth}x${size.height}`
  const cached = partCache.get(key)
  if (cached) return cached

  // Bake each mesh's world matrix into a cloned geometry: the GLB's node tree is
  // flattened here so the parts can be instanced (chairs) with plain matrices.
  scene.updateWorldMatrix(true, true)
  const parts: ModelPart[] = []
  // Parts that share a material NAME are one part. For every model prepped to
  // date this collapses nothing — Tripo names each part after its own index, so
  // the names are unique and the loop below just walks past. It exists for the
  // one case where a prep step deliberately gives many parts the same name:
  // `tools/glb-prep/mark-glass.mjs` marks the 70 fragments Tripo shattered a
  // wine glass and a water glass into as `glass-tall` / `glass-short`, and
  // without this a single place setting would cost 81 draw calls where the
  // merged model it replaces cost 1. Merging here rather than in the file is
  // what keeps the marking to a rename: the fragments carry 76 DIFFERENT baked
  // textures, so a merge inside the GLB would need an atlas, while the material
  // these parts end up with is transmissive and has no texture at all.
  const merged = new Map<string, THREE.BufferGeometry[]>()
  const byName = new Map<string, THREE.Material>()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    const name = material.name
    if (!name) {
      parts.push({ key: `${parts.length}`, geometry, material })
      return
    }
    const bucket = merged.get(name)
    if (bucket) bucket.push(geometry)
    else {
      merged.set(name, [geometry])
      byName.set(name, material)
    }
  })
  for (const [name, geometries] of merged) {
    const material = byName.get(name)!
    if (geometries.length === 1) {
      parts.push({ key: name, geometry: geometries[0], material })
      continue
    }
    // mergeGeometries returns null when the attribute sets disagree; keeping the
    // pieces is the honest fallback — slower, but nothing disappears
    const one = mergeGeometries(geometries, false)
    if (one) {
      for (const g of geometries) g.dispose()
      parts.push({ key: name, geometry: one, material })
    } else {
      geometries.forEach((g, i) => parts.push({ key: `${name}-${i}`, geometry: g, material }))
    }
  }

  // The model's own real size, so the fit lands the geometry exactly on `size`.
  // Entries prepped at their catalog default (most of them) leave modelSize off.
  const def = entry.modelSize ?? entry.defaultSize
  const fit = new THREE.Matrix4().makeScale(
    size.width / def.width,
    size.height / def.height,
    size.depth / def.depth,
  )
  if (!fit.equals(new THREE.Matrix4())) {
    for (const p of parts) p.geometry.applyMatrix4(fit)
  }

  partCache.set(key, parts)
  return parts
}

/** Geometry+material parts of a catalog entry's GLB, fitted to `size`. Suspends. */
export function useModelParts(catalogId: string, url: string, size: Size3D): ModelPart[] {
  const { scene } = useGLTF(url, '/draco/')
  return useMemo(() => buildParts(scene, catalogId, size), [scene, catalogId, size])
}
