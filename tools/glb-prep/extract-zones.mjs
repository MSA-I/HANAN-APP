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

// gather world-space plan triangles plus their surface height per ZONE_* material.
// `byNode` keeps the source face identity: one material may be painted on several
// separate faces (two DJ booths, a chuppah in the hall AND one on the deck), and
// bounding them together would invent one giant rectangle spanning the gap.
const zones = new Map() // name -> { tris: […], minY, maxY, byNode: Map<node, {tris, maxY}> }
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  const nodeName = node.getName() || '(unnamed)'
  const wx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z + m[12]
  const wy = (x, y, z) => m[1] * x + m[5] * y + m[9] * z + m[13]
  const wz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z + m[14]
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial()
    const name = mat ? mat.getName() : ''
    if (!name.startsWith('ZONE_')) continue
    const pos = prim.getAttribute('POSITION')
    const idx = prim.getIndices()
    if (!pos) continue
    let z = zones.get(name)
    if (!z) { z = { tris: [], minY: Infinity, maxY: -Infinity, byNode: new Map() }; zones.set(name, z) }
    let face = z.byNode.get(nodeName)
    if (!face) { face = { tris: [], maxY: -Infinity }; z.byNode.set(nodeName, face) }
    const count = idx ? idx.getCount() : pos.getCount()
    const el = [0, 0, 0]
    const get = (i) => {
      pos.getElement(idx ? idx.getScalar(i) : i, el)
      const y = wy(...el)
      z.minY = Math.min(z.minY, y)
      z.maxY = Math.max(z.maxY, y)
      face.maxY = Math.max(face.maxY, y)
      return [wx(...el), wz(...el)]
    }
    for (let i = 0; i + 2 < count + 1 && i + 2 < count; i += 3) {
      const a = get(i), b = get(i + 1), c = get(i + 2)
      z.tris.push([...a, ...b, ...c])
      face.tris.push([...a, ...b, ...c])
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
  // Label solid cells (4-connectivity) BEFORE tracing, and trace each blob alone.
  // Two blobs that meet only at a corner — the east strip and the new area under
  // the passage do exactly that — make one lattice corner carry two outgoing
  // edges. A one-edge-per-corner map keeps whichever was written last, and the
  // walk then hops between blobs and closes a loop that cuts across the room.
  // 4-connectivity puts them in different blobs, so no corner is ever ambiguous.
  const label = new Int32Array(W * H).fill(-1)
  let blobs = 0
  for (let sj = 0; sj < H; sj++) for (let si = 0; si < W; si++) {
    if (!solid(si, sj) || label[si + sj * W] >= 0) continue
    const id = blobs++
    const st = [si + sj * W]; label[st[0]] = id
    while (st.length) {
      const idx = st.pop(); const i = idx % W, j = (idx / W) | 0
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj
        if (!solid(ni, nj)) continue
        const n = ni + nj * W
        if (label[n] < 0) { label[n] = id; st.push(n) }
      }
    }
  }
  const ek = (x, y) => x + y * (W + 1)
  const corner = (k) => [gx0 + (k % (W + 1) - 1) * R, gz0 + (Math.floor(k / (W + 1)) - 1) * R]
  const polys = []
  for (let id = 0; id < blobs; id++) {
    const mine = (i, j) => i >= 0 && j >= 0 && i < W && j < H && label[i + j * W] === id
    const em = new Map()
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!mine(i, j)) continue
      if (!mine(i, j - 1)) em.set(ek(i, j), ek(i + 1, j))
      if (!mine(i + 1, j)) em.set(ek(i + 1, j), ek(i + 1, j + 1))
      if (!mine(i, j + 1)) em.set(ek(i + 1, j + 1), ek(i, j + 1))
      if (!mine(i - 1, j)) em.set(ek(i, j + 1), ek(i, j))
    }
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
  }
  return polys.sort((a, b) => shoelaceCm(b) - shoelaceCm(a))
}

const outline = contours([...zones.values()].flatMap((z) => z.tris))[0] ?? [] // room rectangle
const floorAreas = contours(floor.tris) // green placeable pieces (disconnected)

// --- restricted zone rects ---
// One rect per marker FACE, then merge only faces that actually overlap. A
// material painted on two separate faces means two markers (two DJ positions, a
// chuppah in the hall and one on the deck); bounding them together would produce
// a rectangle covering the empty gap between them and silently exile furniture.
// Overlapping/nested faces (the pool water inside its surround) do merge — that
// is one marker drawn in pieces.
const faceRect = (face) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const t of face.tris) for (let k = 0; k < 6; k += 2) {
    x0 = Math.min(x0, t[k]); x1 = Math.max(x1, t[k])
    z0 = Math.min(z0, t[k + 1]); z1 = Math.max(z1, t[k + 1])
  }
  const [px0, py0] = toPlan(x0, z0)
  const [px1, py1] = toPlan(x1, z1)
  return {
    x: Math.min(px0, px1), y: Math.min(py0, py1),
    width: Math.abs(px1 - px0), depth: Math.abs(py1 - py0),
    elevation: Math.round(face.maxY * 100),
  }
}
const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.depth && b.y < a.y + a.depth
const rects = {} // name -> rects, largest first (usually one; more = more markers)
for (const [name, z] of zones) {
  if (name === 'ZONE_FLOOR') continue
  const merged = []
  for (const face of z.byNode.values()) {
    const r = faceRect(face)
    const target = merged.find((m) => overlaps(m, r))
    if (!target) { merged.push(r); continue }
    const x1 = Math.max(target.x + target.width, r.x + r.width)
    const y1 = Math.max(target.y + target.depth, r.y + r.depth)
    target.x = Math.min(target.x, r.x); target.y = Math.min(target.y, r.y)
    target.width = x1 - target.x; target.depth = y1 - target.y
    target.elevation = Math.max(target.elevation, r.elevation)
  }
  rects[name] = merged.sort((a, b) => b.width * b.depth - a.width * a.depth)
}

// ZONE_HUPA is this model's spelling of legacy ZONE_CHUPPAH. Collapse only the
// faces that are genuinely the same marker; any HUPA face with no CHUPPAH twin
// is a DIFFERENT chuppah location and is reported as its own rect rather than
// merged, dropped, or unioned into a rectangle spanning both.
if (rects.ZONE_HUPA) {
  // A HUPA face keeps the CHUPPAH twin's footprint but its own elevation (the
  // hall marker is drawn at floor level under a HUPA face raised to the podium).
  const canonical = rects.ZONE_CHUPPAH ?? []
  for (const h of rects.ZONE_HUPA) {
    const twin = canonical.find((c) => overlaps(c, h))
    if (twin) twin.elevation = Math.max(twin.elevation, h.elevation)
    else canonical.push(h)
  }
  rects.ZONE_CHUPPAH = canonical.sort((a, b) => b.width * b.depth - a.width * a.depth)
  delete rects.ZONE_HUPA
}

// `kind` is the stable id the app matches against (RestrictedZone.kind and
// CatalogEntry.zoneKind compare as STRINGS — a typo exiles the object instead of
// freeing it), `label` is the Hebrew overlay text. ZONE_CORRIDOR keeps its
// SketchUp marker name but is 'passage'/'מעבר' in the app (source doc §29).
const zoneMeta = {
  ZONE_POOL: { kind: 'pool', label: 'בריכה' },
  // Added 2026-07-28: the user split the single wide pool marker into POOL (the
  // water plus its left apron) and SAVIV (the band around it). Their union is
  // exactly the old pool rectangle, so the no-go footprint did not change — the
  // point of the split is that SAVIV can carry its own rules (vegetation).
  ZONE_SAVIV: { kind: 'saviv', label: 'סביב הבריכה' },
  ZONE_DJ: { kind: 'dj', label: 'עמדת DJ' },
  ZONE_BAR: { kind: 'bar', label: 'בר' },
  ZONE_DANCEFLOOR: { kind: 'dancefloor', label: 'רחבת ריקודים' },
  ZONE_CHUPPAH: { kind: 'chuppah', label: 'חופה' },
  ZONE_CORRIDOR: { kind: 'passage', label: 'מעבר' },
  ZONE_KABALAT_PANIM: { kind: 'kabalatPanim', label: 'קבלת פנים' },
  // Source doc §20, "a flooring ZONE belonging only to the reception". The user
  // named the material ZONE_FLOR — ONE 'O'. ⚠ ZONE_FLOOR, two 'O's, is the floor
  // OUTLINE that establishes the plan origin and is skipped below; these two are
  // one keystroke apart and mean entirely different things. Do not "fix" either
  // spelling. Painted on TWO faces (the user's own count), which is supported:
  // the clamp filters by kind and snaps to the nearest centre.
  ZONE_FLOR: { kind: 'flooring', label: 'ריצוף' },
}

console.log('=== plan origin (raw ZONE_FLOOR min corner) ===')
console.log(`offset (metres): [${(-fx).toFixed(3)}, 0, ${(-fz).toFixed(3)}]`)
console.log(`floor bbox (cm): width ${Math.round((fxMax - fx) * 100)}, depth ${Math.round((fzMax - fz) * 100)}`)
console.log('\n=== outline (room, plan cm) ===')
console.log(JSON.stringify(outline))
console.log(`\n=== floorAreas (green placeable, ${floorAreas.length} pieces, plan cm) ===`)
console.log(JSON.stringify(floorAreas))
console.log('\n=== restricted (plan cm) ===')
const multi = []
const unmapped = []
for (const [name, list] of Object.entries(rects)) {
  const meta = zoneMeta[name]
  if (!meta) unmapped.push(name)
  if (list.length > 1) multi.push([name, list.length])
  for (const r of list) {
    const elevation = r.elevation ? `elevation: ${r.elevation}, ` : ''
    console.log(`{ x: ${r.x}, y: ${r.y}, width: ${r.width}, depth: ${r.depth}, ${elevation}label: '${meta?.label ?? name}', kind: '${meta?.kind ?? name}' },`)
  }
}

// Several rects under one `kind` ARE supported, and this warning used to say the
// opposite — which is why the second DJ pad and the deck chuppah sat in
// manifest.json as `notImported` for a whole round. The clamp does
// `zones.filter(z => z.kind === zoneKind)` and snaps to the NEAREST CENTRE
// (actions.ts:380-391), and collision tests membership with `.some()`. `saviv`
// has been four rectangles all along. So this is information, not an error —
// paste them all. What it is still worth saying out loud is that they must not be
// UNIONED: the bounding box of two markers covers the empty gap between them.
if (multi.length) {
  console.warn('\n! MORE THAN ONE MARKER FACE PER ZONE — separate, non-overlapping rectangles:')
  for (const [name, n] of multi) console.warn(`!   ${name}: ${n} rects (listed above, largest first)`)
  console.warn('! This is supported — paste every one. The clamp filters by kind and picks the')
  console.warn('! nearest centre. Do NOT union them into one rectangle: that claims the gap.')
}

// A ZONE_* material the extractor has no mapping for is the silent failure mode
// of this whole pipeline: it is simply absent from the output above, with no
// error, and nobody notices the zone never reached the app. Say it last and say
// it loudly.
if (unmapped.length) {
  console.warn('\n! UNMAPPED ZONE MARKERS — painted in the model, NOT emitted above:')
  for (const name of unmapped) console.warn(`!   ${name}`)
  console.warn('! Add each to `zoneMeta` with its kind and Hebrew label, then re-run.')
}
