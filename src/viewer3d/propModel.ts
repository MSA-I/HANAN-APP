/**
 * Real furniture GLBs (Tripo → tools/glb-prep --mode prop) for catalog entries
 * that declare a `model`. glb-prep already normalised each file to real cm
 * dimensions, Y-up, base at y=0 and centred. Most render at scale 1; catalog
 * entries may declare a uniform `modelScale` when the real asset needs to render
 * larger while preserving its measured proportions.
 *
 * Fitting is done against the catalog's `defaultSize` — NOT the loaded geometry's
 * bounding box. glb-prep yaws each model to the app's facing convention, and a
 * chair yawed off a right angle has an axis-aligned bbox noticeably larger than the
 * chair (a 45cm seat at 74° measures 55cm corner to corner). Scaling to that bbox
 * would squash every rotated model back down.
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
  const modelScale = entry.modelScale ?? 1
  const key = `${catalogId}|${size.width}x${size.depth}x${size.height}|${modelScale}`
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

  // Stored size is relative to the current catalog default; modelScale handles
  // assets whose desired real-world default differs from their prepped GLB size.
  const def = entry.defaultSize
  const fit = new THREE.Matrix4().makeScale(
    (size.width / def.width) * modelScale,
    (size.height / def.height) * modelScale,
    (size.depth / def.depth) * modelScale,
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
