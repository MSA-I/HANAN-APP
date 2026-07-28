#!/usr/bin/env node
/**
 * Cut a horizontal PLAN SECTION through a prepped venue GLB — the thing an
 * architect draws: walls in poché with the door and window openings actually
 * missing, columns, glazing, the pool edge.
 *
 * Why this exists. The 2D view used to fake the building by stroking a 20 cm
 * band around `venueOutline`, a single closed polygon of the floor. That polygon
 * knows nothing about a door, so the plan had no openings and every wall was the
 * same invented thickness. The building IS in the GLB as real geometry — several
 * of its materials span floor to roof — so slicing it at cut height gives the
 * true wall cross-sections for free, and an opening is simply where no geometry
 * crosses the plane.
 *
 * Coordinate mapping is the same one extract-zones.mjs uses, so the output lands
 * in the same plan space as the zones: ZONE_FLOOR's min corner is the origin,
 * planX = (rawX - fx) * 100, planY = (rawZ - fz) * 100, in cm.
 *
 *   node extract-section.mjs <venue.glb> [options]
 *
 * Options:
 *   --out <file>        output JSON. default: <glb dir>/section.json
 *   --cut <spec>        repeatable. `<metres>` or `<metres>@<planX0>..<planX1>`,
 *                       the range limiting that cut to a slice of the plan. The
 *                       resort needs two: the hall floor is at 0 and the
 *                       reception deck at +4.70 m, so one plane cannot catch
 *                       both. default: `1@0..4423` and `5.7@4432..6051`
 *   --snap <cm>         endpoint quantisation before joining. default 2
 *   --min-length <cm>   drop a finished polyline shorter than this. default 25
 *   --keep-material <s> only cut materials whose name contains <s> (repeatable)
 *   --drop-material <s> never cut materials whose name contains <s> (repeatable)
 *   --clip <x0,y0,x1,y1>  plan cm. Drop any polyline lying ENTIRELY outside this
 *                       rectangle — the venue model carries the rest of the
 *                       building and a desert backdrop, and the app's world is
 *                       the pack rectangle. Whole polylines, never partial: a
 *                       clipped wall loop would stop being a loop and would draw
 *                       as a line instead of poché.
 *
 * The output is polylines, not triangles: `{ closed, pts: [[x,y], …] }`. A slice
 * through a wall closes on itself and is drawn filled (that is the poché); a
 * slice through a sheet of glazing does not and is drawn as a line. Deciding
 * that here rather than in the renderer keeps the drawing code dumb.
 *
 * ponytail: no per-material line weights. Everything comes back as one class and
 * the renderer decides. If the plan ever needs "glazing thinner than wall", the
 * honest fix is to emit the material name per polyline, not to guess by size.
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const argv = process.argv.slice(2)
const inPath = argv[0]
if (!inPath || inPath.startsWith('--')) {
  console.error('usage: node extract-section.mjs <venue.glb> [--cut 1@0..4423] [--out section.json]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}
const flagAll = (name) =>
  argv.reduce((acc, a, i) => (a === name ? [...acc, argv[i + 1]] : acc), [])

const OUT = flag('--out', join(dirname(inPath), 'section.json'))
const SNAP = Number(flag('--snap', 2))
const MIN_LENGTH = Number(flag('--min-length', 25))
const KEEP = flagAll('--keep-material')
const DROP = flagAll('--drop-material')

/** `1@0..4423` → { y: 1, x0: 0, x1: 4423 }; a bare `1` spans everything. */
function parseCut(spec) {
  const [h, range] = spec.split('@')
  const cut = { y: Number(h), x0: -Infinity, x1: Infinity }
  if (range) {
    const [a, b] = range.split('..').map(Number)
    cut.x0 = a
    cut.x1 = b
  }
  if (!Number.isFinite(cut.y)) throw new Error(`bad --cut ${spec}`)
  return cut
}
const cuts = (flagAll('--cut').length ? flagAll('--cut') : ['1@0..4423', '5.7@4432..6051']).map(parseCut)

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

const doc = await io.read(inPath)

// --- plan origin, exactly as extract-zones.mjs establishes it -----------------
let fx = Infinity
let fz = Infinity
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()?.getName() !== 'ZONE_FLOOR') continue
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const arr = pos.getArray()
    for (let i = 0; i < arr.length; i += 3) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2]
      fx = Math.min(fx, m[0] * x + m[4] * y + m[8] * z + m[12])
      fz = Math.min(fz, m[2] * x + m[6] * y + m[10] * z + m[14])
    }
  }
}
// A PREPPED venue GLB has no ZONE_* faces — glb-prep strips the markers, which
// is why extract-zones.mjs is pointed at the raw export. Cutting the prepped file
// is deliberate here: it is the one the app actually renders, so the plan section
// and the 3D model cannot drift apart. Its origin is recovered from the pack's
// own `offset`, which is exactly what the viewer adds to the loaded model.
const offsetArg = flag('--offset', null)
if (!Number.isFinite(fx)) {
  if (!offsetArg) {
    console.error('no ZONE_FLOOR in this GLB (it is prepped). Pass --offset <ox>,<oz>')
    console.error('  — the same pair as VenuePack.offset, e.g. --offset 0,24.861')
    process.exit(1)
  }
  const [ox, oz] = offsetArg.split(',').map(Number)
  if (!Number.isFinite(ox) || !Number.isFinite(oz)) {
    console.error(`bad --offset ${offsetArg}`)
    process.exit(1)
  }
  fx = -ox
  fz = -oz
  console.log(`origin from --offset: fx=${fx} fz=${fz}`)
} else {
  console.log(`origin from ZONE_FLOOR: fx=${fx.toFixed(3)} fz=${fz.toFixed(3)}`)
}
const planX = (x) => (x - fx) * 100
const planY = (z) => (z - fz) * 100

// --- slice -------------------------------------------------------------------
// One segment per triangle that straddles the plane. The two crossing edges are
// found by sign of (vertexY - cutY); a triangle with a vertex exactly ON the
// plane is nudged off it rather than special-cased, because the alternative is
// three degenerate branches for a case that produces a zero-length segment.
const EPS = 1e-9
const segments = cuts.map(() => [])
const contributors = new Map()

for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? ''
    // ZONE_* faces are flat paint markers lying on the floor, not building fabric
    if (name.startsWith('ZONE_')) continue
    if (KEEP.length && !KEEP.some((k) => name.includes(k))) continue
    if (DROP.some((d) => name.includes(d))) continue

    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const p = pos.getArray()
    const idx = prim.getIndices()?.getArray()
    const count = idx ? idx.length : p.length / 3

    // world transform, inlined: this runs a few million times
    const wx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z + m[12]
    const wy = (x, y, z) => m[1] * x + m[5] * y + m[9] * z + m[13]
    const wz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z + m[14]
    const vx = [0, 0, 0]
    const vy = [0, 0, 0]
    const vz = [0, 0, 0]

    for (let t = 0; t + 2 < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const v = (idx ? idx[t + k] : t + k) * 3
        const x = p[v], y = p[v + 1], z = p[v + 2]
        vx[k] = wx(x, y, z)
        vy[k] = wy(x, y, z)
        vz[k] = wz(x, y, z)
      }
      for (let c = 0; c < cuts.length; c++) {
        const h = cuts[c].y
        const d0 = vy[0] - h, d1 = vy[1] - h, d2 = vy[2] - h
        if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue
        const hits = []
        for (let e = 0; e < 3; e++) {
          const a = e, b = (e + 1) % 3
          const da = vy[a] - h, db = vy[b] - h
          if ((da > 0 && db > 0) || (da < 0 && db < 0)) continue
          const denom = da - db
          if (Math.abs(denom) < EPS) continue
          const s = da / denom
          hits.push([
            planX(vx[a] + (vx[b] - vx[a]) * s),
            planY(vz[a] + (vz[b] - vz[a]) * s),
          ])
        }
        if (hits.length < 2) continue
        const [a, b] = hits
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) continue
        const { x0, x1 } = cuts[c]
        if (a[0] < x0 && b[0] < x0) continue
        if (a[0] > x1 && b[0] > x1) continue
        segments[c].push([a[0], a[1], b[0], b[1]])
        contributors.set(name, (contributors.get(name) ?? 0) + 1)
      }
    }
  }
}

// --- join segments into polylines --------------------------------------------
// Endpoints are quantised first: a mesh slice produces coincident points that
// differ in the last float digits, and without snapping every segment stays its
// own polyline. SNAP is in cm and is the one number that trades "walls join up"
// against "two walls 2 cm apart merge into one".
const key = (x, y) => `${Math.round(x / SNAP)},${Math.round(y / SNAP)}`

function chain(segs) {
  const ends = new Map()
  const used = new Array(segs.length).fill(false)
  segs.forEach(([ax, ay, bx, by], i) => {
    for (const k of [key(ax, ay), key(bx, by)]) {
      if (!ends.has(k)) ends.set(k, [])
      ends.get(k).push(i)
    }
  })

  const polylines = []
  const take = (from, i) => {
    const [ax, ay, bx, by] = segs[i]
    return key(ax, ay) === from ? [bx, by] : [ax, ay]
  }

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = true
    const [ax, ay, bx, by] = segs[i]
    const pts = [[ax, ay], [bx, by]]

    // grow from the tail, then from the head, so a chain found from its middle
    // still comes out as one polyline
    for (const dir of [0, 1]) {
      for (;;) {
        const tip = dir === 0 ? pts[pts.length - 1] : pts[0]
        const k = key(tip[0], tip[1])
        const next = (ends.get(k) ?? []).find((j) => !used[j])
        if (next === undefined) break
        used[next] = true
        const pt = take(k, next)
        if (dir === 0) pts.push(pt)
        else pts.unshift(pt)
      }
    }
    polylines.push(pts)
  }
  return polylines
}

/** collinear runs collapse to their endpoints — a mesh slice emits one segment
 *  per triangle, so a straight wall arrives as dozens of them. */
function simplify(pts, tol = 0.5) {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1]
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    const len = Math.hypot(c[0] - a[0], c[1] - a[1])
    if (len > 0 && Math.abs(cross) / len < tol) continue
    out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

const length = (pts) => {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return d
}

const clipArg = flag('--clip', null)
const clip = clipArg ? clipArg.split(',').map(Number) : null
if (clip && (clip.length !== 4 || clip.some((n) => !Number.isFinite(n)))) {
  console.error(`bad --clip ${clipArg}`)
  process.exit(1)
}
/** true when the polyline's bbox meets the clip rect at all */
const touchesClip = (pts) => {
  if (!clip) return true
  const [cx0, cy0, cx1, cy1] = clip
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x)
    y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  return x1 >= cx0 && x0 <= cx1 && y1 >= cy0 && y0 <= cy1
}

const lines = []
let dropped = 0
segments.forEach((segs, c) => {
  const joined = chain(segs)
    .map((pts) => simplify(pts))
    .filter((pts) => length(pts) >= MIN_LENGTH)
    .filter((pts) => {
      if (touchesClip(pts)) return true
      dropped++
      return false
    })
  for (const pts of joined) {
    const closed = pts.length > 3 && key(pts[0][0], pts[0][1]) === key(pts[pts.length - 1][0], pts[pts.length - 1][1])
    lines.push({
      closed,
      pts: (closed ? pts.slice(0, -1) : pts).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
    })
  }
  console.log(`cut ${cuts[c].y}m: ${segs.length} segments → ${joined.length} polylines`)
})

const payload = {
  source: inPath,
  cuts: cuts.map((c) => ({ height: c.y, x0: c.x0 === -Infinity ? null : c.x0, x1: c.x1 === Infinity ? null : c.x1 })),
  snap: SNAP,
  minLength: MIN_LENGTH,
  lines,
}
writeFileSync(OUT, JSON.stringify(payload))

const top = [...contributors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log('\nmaterials that crossed a cut plane (top 12):')
for (const [name, n] of top) console.log(`  ${String(n).padStart(7)}  ${name}`)
if (clip) console.log(`\nclip ${clipArg}: dropped ${dropped} polylines lying wholly outside`)
console.log(`\n${lines.length} polylines (${lines.filter((l) => l.closed).length} closed) → ${OUT}`)
