/**
 * Turns catalog mesh recipes into three.js geometry/material, with module-level
 * caches so the 50-tables-×-10-chairs target stays cheap:
 *
 * - Geometry is built once per (catalogId + size) and MERGED into one geometry
 *   per material slot, so a whole object draws in ≤ (slot count) calls.
 * - Materials are shared per color hex. Selected objects get a parallel emissive
 *   variant (also cached per color) — never mutate a shared material in place.
 *
 * All dimensions arrive in cm (the model unit) and are converted to meters via
 * core/space.cmToM — the ONLY unit authority. Part offsets are already in three
 * convention ([x, elevation, z] with z = plan y), so they translate directly.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getCatalogEntry } from '../core/catalog/registry'
import type { MeshPart } from '../core/catalog/types'
import type { Size3D } from '../core/model/types'
import { cmToM } from '../core/space'

export interface SlotGeometry {
  slot: string
  geometry: THREE.BufferGeometry
}

const RADIAL = 28

function partGeometry(part: MeshPart): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry
  if (part.shape === 'box') {
    const [w, h, d] = part.dims
    geo = new THREE.BoxGeometry(cmToM(w), cmToM(h), cmToM(d))
  } else if (part.shape === 'cylinder') {
    const [rTop, rBottom, h] = part.dims
    geo = new THREE.CylinderGeometry(cmToM(rTop), cmToM(rBottom), cmToM(h), RADIAL)
  } else {
    const [r] = part.dims
    geo = new THREE.SphereGeometry(cmToM(r), RADIAL, Math.round(RADIAL / 2))
  }
  geo.translate(cmToM(part.offset[0]), cmToM(part.offset[1]), cmToM(part.offset[2]))
  return geo
}

const geometryCache = new Map<string, SlotGeometry[]>()

/** Merged geometry per material slot (meters), cached by catalog id + size. */
export function objectSlotGeometries(catalogId: string, size: Size3D): SlotGeometry[] {
  const key = `${catalogId}|${size.width}x${size.depth}x${size.height}`
  const cached = geometryCache.get(key)
  if (cached) return cached

  const parts = getCatalogEntry(catalogId).buildMesh(size)
  const bySlot = new Map<string, THREE.BufferGeometry[]>()
  for (const part of parts) {
    const geo = partGeometry(part)
    const arr = bySlot.get(part.slot)
    if (arr) arr.push(geo)
    else bySlot.set(part.slot, [geo])
  }

  const result: SlotGeometry[] = []
  for (const [slot, geos] of bySlot) {
    let geometry: THREE.BufferGeometry
    if (geos.length === 1) {
      geometry = geos[0]
    } else {
      geometry = mergeGeometries(geos, false) ?? geos[0]
      for (const g of geos) if (g !== geometry) g.dispose()
    }
    result.push({ slot, geometry })
  }
  geometryCache.set(key, result)
  return result
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>()

/** Shared matte material for a color (do not mutate — it is shared). */
export function slotMaterial(colorHex: string): THREE.MeshStandardMaterial {
  let m = materialCache.get(colorHex)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.82, metalness: 0 })
    materialCache.set(colorHex, m)
  }
  return m
}

export const SELECT_TINT = '#3056d3'
const SELECT_EMISSIVE = new THREE.Color(SELECT_TINT)
const selectedMaterialCache = new Map<string, THREE.MeshStandardMaterial>()

/** Emissive-tinted variant of a color, cached — used while an object is selected. */
export function selectedSlotMaterial(colorHex: string): THREE.MeshStandardMaterial {
  let m = selectedMaterialCache.get(colorHex)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: 0.82,
      metalness: 0,
      emissive: SELECT_EMISSIVE,
      emissiveIntensity: 0.18,
    })
    selectedMaterialCache.set(colorHex, m)
  }
  return m
}

let instancedBase: THREE.MeshStandardMaterial | null = null

/** White base for instanced chairs so per-instance colors show through 1:1. */
export function instancedChairMaterial(): THREE.MeshStandardMaterial {
  if (!instancedBase) {
    instancedBase = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0 })
  }
  return instancedBase
}
