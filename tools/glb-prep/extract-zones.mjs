#!/usr/bin/env node
/**
 * Extract ZONE_* markers from a marked venue GLB into plan-coord data for a
 * VenuePack: the floor outline polygon (from ZONE_FLOOR) and restricted-zone
 * rectangles (ZONE_POOL, ZONE_DJ, …). The user paints flat marker faces in
 * SketchUp with uniquely-named ZONE_* materials; this reads them back.
 *
 * Coordinate mapping: ZONE_FLOOR's min corner → plan origin. planX=(rawX-fx)*100,
 * planY=(rawZ-fz)*100 (cm). Prints ready-to-paste pack fields.
 *
 *   node extract-zones.mjs <marked.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'

const inPath = process.argv[2]
if (!inPath) { console.error('usage: node extract-zones.mjs <marked.glb>'); process.exit(2) }

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

const doc = await io.read(inPath)

// gather world-space triangles (x,z only — markers are flat) per ZONE_* material
const zones = new Map() // name -> { tris: [[ax,az,bx,bz,cx,cz], …] }
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  const wx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z + m[12]
  const wz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z + m[14]
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial()
    const name = mat ? mat.getName() : ''
    if (!name.startsWith('ZONE_')) continue
    const pos = prim.getAttribute('POSITION')
    const idx = prim.getIndices()
    if (!pos) continue
    let z = zones.get(name)
    if (!z) { z = { tris: [] }; zones.set(name, z) }
    const count = idx ? idx.getCount() : pos.getCount()
    const el = [0, 0, 0]
    const get = (i) => { pos.getElement(idx ? idx.getScalar(i) : i, el); return [wx(...el), wz(...el)] }
    for (let i = 0; i + 2 < count + 1 && i + 2 < count; i += 3) {
      const a = get(i), b = get(i + 1), c = get(i + 2)
      z.tris.push([...a, ...b, ...c])
    }
  }
}

const floor = zones.get('ZONE_FLOOR')
if (!floor) { console.error('no ZONE_FLOOR found — cannot establish plan origin'); process.exit(1) }

// plan origin = min corner of ZONE_FLOOR
let fx = Infinity, fz = Infinity, fxMax = -Infinity, fzMax = -Infinity
for (const t of floor.tris) for (let k = 0; k < 6; k += 2) {
  fx = Math.min(fx, t[k]); fxMax = Math.max(fxMax, t[k])
  fz = Math.min(fz, t[k + 1]); fzMax = Math.max(fzMax, t[k + 1])
}
const toPlan = (x, z) => [Math.round((x - fx) * 100), Math.round((z - fz) * 100)]

// --- polygon extraction (rasterize → fill interior holes → trace boundaries) ---
// Marker faces can be split into pieces and holed. Rasterizing a triangle set,
// filling interior holes, and tracing every boundary loop yields clean plan
// polygons regardless of the source mesh mess. Returns loops, largest first.
const shoelaceCm = (poly) => {
  let a = 0
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1] }
  return Math.abs(a) / 2
}
function contours(tris) {
  if (!tris.length) return []
  const R = 0.1
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity
  for (const t of tris) for (let k = 0; k < 6; k += 2) {
    gx0 = Math.min(gx0, t[k]); gx1 = Math.max(gx1, t[k])
    gz0 = Math.min(gz0, t[k + 1]); gz1 = Math.max(gz1, t[k + 1])
  }
  const W = Math.ceil((gx1 - gx0) / R) + 3, H = Math.ceil((gz1 - gz0) / R) + 3
  const occ = new Uint8Array(W * H)
  const pit = (px, pz, ax, az, bx, bz, cx, cz) => {
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (d === 0) return false
    const a = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
    const b = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
    return a >= -1e-6 && b >= -1e-6 && a + b <= 1 + 1e-6
  }
  for (const t of tris) {
    const xs = [t[0], t[2], t[4]], zs = [t[1], t[3], t[5]]
    const i0 = Math.floor((Math.min(...xs) - gx0) / R) + 1, i1 = Math.floor((Math.max(...xs) - gx0) / R) + 1
    const j0 = Math.floor((Math.min(...zs) - gz0) / R) + 1, j1 = Math.floor((Math.max(...zs) - gz0) / R) + 1
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = gx0 + (i - 1 + 0.5) * R, pz = gz0 + (j - 1 + 0.5) * R
      if (pit(px, pz, t[0], t[1], t[2], t[3], t[4], t[5])) occ[i + j * W] = 1
    }
  }
  const outside = new Uint8Array(W * H)
  const stack = [0]; outside[0] = 1
  while (stack.length) {
    const idx = stack.pop(); const i = idx % W, j = (idx / W) | 0
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue
      const n = ni + nj * W
      if (!outside[n] && !occ[n]) { outside[n] = 1; stack.push(n) }
    }
  }
  const solid = (i, j) => i >= 0 && j >= 0 && i < W && j < H && (occ[i + j * W] || !outside[i + j * W])
  const em = new Map()
  const ek = (x, y) => x + y * (W + 1)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!solid(i, j)) continue
    if (!solid(i, j - 1)) em.set(ek(i, j), ek(i + 1, j))
    if (!solid(i + 1, j)) em.set(ek(i + 1, j), ek(i + 1, j + 1))
    if (!solid(i, j + 1)) em.set(ek(i + 1, j + 1), ek(i, j + 1))
    if (!solid(i - 1, j)) em.set(ek(i, j + 1), ek(i, j))
  }
  const corner = (k) => [gx0 + (k % (W + 1) - 1) * R, gz0 + (Math.floor(k / (W + 1)) - 1) * R]
  const polys = []
  const visited = new Set()
  for (const s of em.keys()) {
    if (visited.has(s)) continue
    const loop = []; let cur = s, guard = em.size + 2
    while (cur != null && !visited.has(cur) && guard-- > 0) { visited.add(cur); loop.push(corner(cur)); cur = em.get(cur) }
    let poly = loop.map((p) => toPlan(...p))
    poly = poly.filter((p, i) => {
      const a = poly[(i - 1 + poly.length) % poly.length], c = poly[(i + 1) % poly.length]
      return Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) > 50
    })
    if (poly.length >= 3 && shoelaceCm(poly) > 10000) polys.push(poly) // ≥1 m²
  }
  return polys.sort((a, b) => shoelaceCm(b) - shoelaceCm(a))
}

const outline = contours([...zones.values()].flatMap((z) => z.tris))[0] ?? [] // room rectangle
const floorAreas = contours(floor.tris) // green placeable pieces (disconnected)

// --- restricted zone rects ---
const rects = {}
for (const [name, z] of zones) {
  if (name === 'ZONE_FLOOR') continue
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const t of z.tris) for (let k = 0; k < 6; k += 2) {
    x0 = Math.min(x0, t[k]); x1 = Math.max(x1, t[k])
    z0 = Math.min(z0, t[k + 1]); z1 = Math.max(z1, t[k + 1])
  }
  const [px0, py0] = toPlan(x0, z0)
  const [px1, py1] = toPlan(x1, z1)
  rects[name] = { x: Math.min(px0, px1), y: Math.min(py0, py1), width: Math.abs(px1 - px0), depth: Math.abs(py1 - py0) }
}

// ZONE_HUPA is the current model's spelling of legacy ZONE_CHUPPAH. Some SKPs
// contain both aliases; emit one canonical rectangle, and stop if they ever
// diverge instead of silently creating two home zones or unioning their bounds.
if (rects.ZONE_HUPA) {
  if (rects.ZONE_CHUPPAH) {
    const keys = ['x', 'y', 'width', 'depth']
    if (keys.some((key) => rects.ZONE_HUPA[key] !== rects.ZONE_CHUPPAH[key])) {
      throw new Error('ZONE_HUPA and ZONE_CHUPPAH disagree — keep one marker or align them before export')
    }
  }
  rects.ZONE_CHUPPAH = rects.ZONE_HUPA
  delete rects.ZONE_HUPA
}

const label = { ZONE_POOL: 'בריכה', ZONE_DJ: 'עמדת DJ', ZONE_BAR: 'בר', ZONE_DANCEFLOOR: 'רחבת ריקודים', ZONE_CHUPPAH: 'חופה', ZONE_CORRIDOR: 'מסדרון' }

console.log('=== plan origin (raw ZONE_FLOOR min corner) ===')
console.log(`offset (metres): [${(-fx).toFixed(3)}, 0, ${(-fz).toFixed(3)}]`)
console.log(`floor bbox (cm): width ${Math.round((fxMax - fx) * 100)}, depth ${Math.round((fzMax - fz) * 100)}`)
console.log('\n=== outline (room, plan cm) ===')
console.log(JSON.stringify(outline))
console.log(`\n=== floorAreas (green placeable, ${floorAreas.length} pieces, plan cm) ===`)
console.log(JSON.stringify(floorAreas))
console.log('\n=== restricted (plan cm) ===')
for (const [name, r] of Object.entries(rects)) {
  console.log(`{ x: ${r.x}, y: ${r.y}, width: ${r.width}, depth: ${r.depth}, label: '${label[name] ?? name}' },  // ${name}`)
}
