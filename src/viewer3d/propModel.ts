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
import { getCatalogEntry } from '../core/catalog/registry'
import type { Size3D } from '../core/model/types'

export interface ModelPart {
  key: string
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

const partCache = new Map<string, ModelPart[]>()

function buildParts(scene: THREE.Object3D, catalogId: string, size: Size3D): ModelPart[] {
  const entry = getCatalogEntry(catalogId)
  const key = `${catalogId}|${size.width}x${size.depth}x${size.height}`
  const cached = partCache.get(key)
  if (cached) return cached

  // Bake each mesh's world matrix into a cloned geometry: the GLB's node tree is
  // flattened here so the parts can be instanced (chairs) with plain matrices.
  // ponytail: no merge by material — Tripo emits one material per part already,
  // so merging would collapse nothing and cost a pass.
  scene.updateWorldMatrix(true, true)
  const parts: ModelPart[] = []
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    parts.push({ key: `${parts.length}`, geometry, material })
  })

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
