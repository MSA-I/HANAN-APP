#!/usr/bin/env node
/**
 * Split the WAX from the HOLDER in a candle prop, so the renderer can recolour the
 * candles without touching the brass, the wood or the gilding.
 *
 * Unlike mark-glass.mjs and mark-fabric.mjs there is nothing here to rename. Every
 * one of the ten candle props is `1 mesh · 1 primitive · 1 material · 4 nodes` with
 * a single baked 2048² webp and `baseColorFactor = 1,1,1,1` — a tool that only
 * renames materials has no handle to grab. This one CUTS: it partitions the single
 * index buffer in two and emits a second primitive carrying a second material.
 *
 * ⚠ THE RULE RUNS ON A SINGLE CONNECTED COMPONENT, WHICH IS THE EXACT OPPOSITE OF
 * mark-glass.mjs. That tool's header commands clustering because Tripo shatters a
 * wine glass into thirty fragments and a fragment judged alone reads as cutlery.
 * Here clustering COLLAPSES: unioning components whose bboxes come within 0.4 cm on
 * all three axes takes each model down to 1–5 clusters, every one of which spans
 * from y=0 to the model's top — i.e. the candle is geometrically welded to its cup,
 * so a cluster cannot separate them, it can only merge them. Both tools are right,
 * on two kinds of file.
 *
 * WHY THERE IS NO CUTTING PLANE, and no split triangles either. Slicing at a height
 * would have to deal with triangles straddling the cut. It does not arise: a
 * connected component contains whole triangles by definition and two components
 * share no vertex, so nothing is re-tessellated and every UV survives byte for byte
 * — no vertex is created and none moves. The ten models carry 274 to 1,843
 * components each, so the candle is a few dozen of them, never one.
 *
 * WHY FRACTIONS OF THE MODEL'S OWN NUMBERS rather than centimetres and RGB
 * constants — mark-fabric.mjs:16-23 for the geometric half, and here the same
 * discipline extends to COLOUR: the saturation threshold is a fraction of the
 * model's own mean saturation and the brightness test is against its own mean luma,
 * so one rule reads a gold candelabrum, a wooden holder and a grey-cast one without
 * a per-file table.
 *
 * ── THREE THINGS THE PLAN SPECIFIED THAT MEASUREMENT OVERTURNED ────────────────
 * Plans/R5/PLAN-02 §3.3 specifies `isWax = highEnough && (lowSaturation || column)`
 * and gates on a worst-case saturation margin. Running it on all ten shipped files
 * says otherwise, and the numbers are reproducible with --measure:
 *
 * 1. THE BRIGHTNESS TERM IS NOT OPTIONAL. §3.3's rule drops the `luma > model luma`
 *    clause that §2.3's survey rule carried. Without it "unsaturated" also means
 *    BLACK: on decor-candlestick-brass the rule claimed 225 components including
 *    rgb(54,55,54) and rgb(38,38,36) — the dark rods — and dragged the measured wax
 *    mean from rgb(188,184,182) down to rgb(125,120,112), which would have been
 *    written into the default baseColorFactor. Restoring the clause takes brass to
 *    123 components and its separation from −0.125 to +0.100. Wax is pale by
 *    definition; the clause says so.
 *
 * 2. THE COLUMN BRANCH OF THE OR EARNS NOTHING AND COSTS SOMETHING. Audited per
 *    model, it adds: 0 components on candleholders-wood, 0 on candelabrum-gold
 *    (the very model §3.3 cites as needing it — colour already takes all 35), 0 on
 *    candelabrum-golden, 1 wooden sliver rgb(196,154,108) sat 0.451 on
 *    candlestick-wood, 1 brass sliver rgb(181,163,139) on candlestick-brass, and on
 *    decor-candlestick-gold — §3.3's other cited case — 239 components that take it
 *    from 1.5% to 14.6% of the model. Those 239 are not separable from the candle:
 *    the candle reads rgb(191,169,134) sat 0.305 and the stem slivers beside it
 *    read rgb(185,160,121) sat 0.343, rgb(190,165,124) sat 0.347, rgb(187,164,125)
 *    sat 0.332 — one warm ivory family at every slenderness from 3.1 to 14.5. The
 *    geometry cannot tell them apart and neither can the colour. ⇒ the shipped rule
 *    is COLOUR ONLY, which is exactly §2.3's surveyed rule and exactly what this
 *    tool must reproduce. The column signal is still computed and printed, so a
 *    future re-export can be re-checked instead of trusted.
 *
 * 3. THE GATE IS A GROUP SEPARATION, NOT A WORST-CASE MARGIN. §3.3's margin — the
 *    least saturated non-wax against the most saturated wax — measures how close
 *    one outlier component sits to the threshold, not whether the two groups are
 *    different colours. It rejects three of the six models the plan puts in scope
 *    (candelabrum-gold 0.021, candelabrum-golden 0.019) while candelabra-crystal,
 *    which must fail, scores 0.014 beside them: the statistic simply does not
 *    separate. Comparing the two group MEANS does, with room to spare:
 *
 *        candleholders-wood   0.392      candlestick-gold        0.088
 *        candelabrum-gold     0.375      candleholder-crystal-b  0.072
 *        candlestick-brass    0.358      candleholders-glass     0.052
 *        candlestick-wood     0.311      candelabra-crystal      0.051
 *        candelabrum-golden   0.306      candleholder-crystal-a  0.020
 *                        ── a 3.5× gap, and nothing lands inside it ──
 *
 *    The five on the left are the models whose wax and holder are different
 *    colours. The four crystal/glass ones on the right fail because their candle is
 *    the same white as their vessel — which is the whole point of the gate — and
 *    candlestick-gold falls with them because its ivory candle is the same warm
 *    tone as its gilt stem. The worst-case margin is still printed; it is the
 *    number §2.3 tabulates and it stays useful as a diagnostic.
 *
 * ⚠ NO BASE COLOUR TEXTURE on the new material, deliberately. The sampled wax is
 * flat — all wax components of decor-candlestick-wood average rgb(209,235,242) ± 2,
 * which is a swatch and not shading — and it is NOT near-white in four of the five
 * models (rgb(146,145,144) on the gold candelabrum). Keeping the map would multiply
 * the user's pick by 0.57 luma and by a 0.87 R/B cast, so #c62828 would render
 * ≈#712f2e. Dropping it costs no detail and makes the picked colour mean what it
 * says. The default factor is the measured wax mean, so an untouched candle looks
 * like it did before the split.
 *
 * ⚠ ONE MATERIAL NAME, `candle`, which is the opposite of mark-fabric.mjs's "UNIQUE
 * NAMES, SHARED PREFIX" rule — and for a measured reason. That rule exists because
 * propModel.buildParts merges primitives sharing a material name and keeps only the
 * FIRST material, which would dress seventeen pleats in pleat 0's baked texture.
 * Here every part of the candle gets the SAME new material, so "keep the first"
 * keeps exactly the right one; and the tool emits two primitives in total, so there
 * is nothing to merge in the first place.
 *
 * ⚠ RUN IT AFTER glb-prep, NEVER BEFORE — same as mark-glass/mark-fabric.
 * Re-prepping the source rewrites materials and primitives and erases the split.
 * Running it on the raw export instead would also read different components: every
 * threshold below was measured AFTER weld().
 *
 * Idempotent: a second run re-merges the two primitives, drops the `candle`
 * material and starts over, so it yields an equivalent file rather than a split of
 * a split.
 *
 *   node split-candles.mjs <in.glb> [--out <file>] [--measure] [--dry]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import sharp from 'sharp'
import { statSync } from 'node:fs'

const argv = process.argv.slice(2)
const inPath = argv[0]
if (!inPath || inPath.startsWith('--')) {
  console.error('usage: node split-candles.mjs <in.glb> [--out <file>] [--measure] [--dry]')
  process.exit(2)
}
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : inPath
const measure = argv.includes('--measure')
const dry = argv.includes('--dry') || measure

/** Fraction of the model's height below which there are no candles. Lowest measured base: 0.25 (candleholders-glass). */
const CUP_LINE = 0.25
/** Fraction of the model's OWN mean saturation. Below it, and brighter than the model's own mean luma: wax. */
const SAT_RATIO = 0.5
/** Past this the split swallowed the model, not the candles. candleholders-glass gives 30.2%. */
const MAX_WAX_FRACTION = 0.3
/**
 * Smallest acceptable distance between the two groups' mean saturation. Measured
 * across all ten props: the five separable ones score 0.306…0.392 and the five that
 * are not score 0.020…0.088, so anything in 0.09…0.30 splits them. 0.15 sits in the
 * middle of that empty band rather than against either edge.
 */
const MIN_SEPARATION = 0.15
/** Components smaller than this are specks; their mean is not worth anything. Kept out of both statistics. */
const STAT_MIN_TRIS = 30
/** Height / max(width, depth) above which a component is a column. DIAGNOSTIC ONLY — see note 2 in the header. */
const COLUMN_MIN = 3.0
/** The worst-case margin PLAN-02 §2.3 tabulates. Printed, never gated on — see note 3. */
const REPORT_MARGIN = true

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })

const sizeBefore = statSync(inPath).size
const doc = await io.read(inPath)
const root = doc.getRoot()

// ── the one mesh, and the node that positions it ────────────────────────────────
const meshNode = root.listNodes().find((n) => n.getMesh())
if (!meshNode) {
  console.error(`✗ ${inPath}: no node carries a mesh`)
  process.exit(1)
}
const mesh = meshNode.getMesh()
const world = meshNode.getWorldMatrix()

// ── idempotency: undo a previous split before doing anything else ───────────────
/** Widest index array the data needs. Built with a loop: Math.max(...idx) blows the stack at ~100k. */
const packIndices = (arr) => {
  let mx = 0
  for (const v of arr) if (v > mx) mx = v
  return mx > 65535 ? new Uint32Array(arr) : new Uint16Array(arr)
}

const prior = root.listMaterials().find((m) => m.getName() === 'candle')
if (prior) {
  const prims = mesh.listPrimitives()
  const base = prims.find((q) => q.getMaterial() !== prior) ?? prims[0]
  const semantics = base.listSemantics()
  // ⚠ AFTER A FILE ROUND-TRIP THE TWO PRIMITIVES NO LONGER SHARE VERTEX ACCESSORS.
  // The split writes them sharing one POSITION accessor, but the glTF writer (and
  // Draco, which encodes each primitive separately) hands each primitive its own
  // re-indexed copy on the way back in. Concatenating the raw index lists would
  // then point the candle's indices at the holder's vertex array — which silently
  // read as 2 components instead of 44. Detect which case we are in and offset.
  const shared = prims.every((q) => q.getAttribute('POSITION') === base.getAttribute('POSITION'))
  const idx = []
  if (shared) {
    for (const q of prims) {
      const qi = q.getIndices()
      if (qi) for (let i = 0; i < qi.getCount(); i++) idx.push(qi.getScalar(i))
    }
  } else {
    const parts = new Map(semantics.map((s) => [s, []]))
    let offset = 0
    for (const q of prims) {
      const qi = q.getIndices()
      if (qi) for (let i = 0; i < qi.getCount(); i++) idx.push(qi.getScalar(i) + offset)
      for (const sem of semantics) parts.get(sem).push(q.getAttribute(sem).getArray())
      offset += q.getAttribute('POSITION').getCount()
    }
    for (const sem of semantics) {
      const chunks = parts.get(sem)
      const out = new chunks[0].constructor(chunks.reduce((a, c) => a + c.length, 0))
      let o = 0
      for (const c of chunks) {
        out.set(c, o)
        o += c.length
      }
      base.getAttribute(sem).setArray(out)
    }
  }
  for (const q of prims) if (q !== base) { mesh.removePrimitive(q); q.dispose() }
  base.getIndices().setArray(packIndices(idx))
  prior.dispose()
  console.log(
    `  (re-run: merged ${prims.length} primitives back into one${shared ? '' : ' with vertex offsets'}, dropped the old 'candle' material)`,
  )
}

const prim = mesh.listPrimitives()[0]
const pos = prim.getAttribute('POSITION')
const uv = prim.getAttribute('TEXCOORD_0')
const indices = prim.getIndices()
if (!pos || !uv || !indices) {
  console.error(`✗ ${inPath}: needs POSITION, TEXCOORD_0 and indices on one primitive`)
  process.exit(1)
}
const vertCount = pos.getCount()
const triCount = indices.getCount() / 3

// ── the baked base-colour texture, decoded once ─────────────────────────────────
const baseTex = prim.getMaterial()?.getBaseColorTexture()
if (!baseTex) {
  console.error(`✗ ${inPath}: the material carries no base-colour texture to sample`)
  process.exit(1)
}
const { data: texData, info: texInfo } = await sharp(Buffer.from(baseTex.getImage()))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const TW = texInfo.width
const TH = texInfo.height
const TC = texInfo.channels

/** HSV saturation, and Rec.709 luma, of one 0-255 texel. */
const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b)
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx
}
const lumaOf = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

const vr = new Float32Array(vertCount)
const vg = new Float32Array(vertCount)
const vb = new Float32Array(vertCount)
const vsat = new Float32Array(vertCount)
const vluma = new Float32Array(vertCount)
const wxa = new Float32Array(vertCount)
const wya = new Float32Array(vertCount)
const wza = new Float32Array(vertCount)
const p = [0, 0, 0]
const t = [0, 0]
for (let i = 0; i < vertCount; i++) {
  pos.getElement(i, p)
  wxa[i] = world[0] * p[0] + world[4] * p[1] + world[8] * p[2] + world[12]
  wya[i] = world[1] * p[0] + world[5] * p[1] + world[9] * p[2] + world[13]
  wza[i] = world[2] * p[0] + world[6] * p[1] + world[10] * p[2] + world[14]
  uv.getElement(i, t)
  // glTF's UV origin is the image's TOP-left, so v maps straight onto the row.
  let px = Math.floor((t[0] - Math.floor(t[0])) * TW)
  let py = Math.floor((t[1] - Math.floor(t[1])) * TH)
  if (px >= TW) px = TW - 1
  if (py >= TH) py = TH - 1
  const o = (py * TW + px) * TC
  vr[i] = texData[o]
  vg[i] = texData[o + 1]
  vb[i] = texData[o + 2]
  vsat[i] = satOf(vr[i], vg[i], vb[i])
  vluma[i] = lumaOf(vr[i], vg[i], vb[i])
}

let modelSat = 0
let modelLuma = 0
let modelLoY = Infinity
let modelHiY = -Infinity
for (let i = 0; i < vertCount; i++) {
  modelSat += vsat[i]
  modelLuma += vluma[i]
  if (wya[i] < modelLoY) modelLoY = wya[i]
  if (wya[i] > modelHiY) modelHiY = wya[i]
}
modelSat /= vertCount
modelLuma /= vertCount
const modelH = modelHiY - modelLoY

// ── union-find over vertices joined by a triangle ───────────────────────────────
const parent = new Int32Array(vertCount)
for (let i = 0; i < vertCount; i++) parent[i] = i
const find = (i) => {
  let r = i
  while (parent[r] !== r) r = parent[r]
  while (parent[i] !== r) {
    const n = parent[i]
    parent[i] = r
    i = n
  }
  return r
}
// ⚠ Re-find BOTH roots inside every union. Reading all three roots up front and
// then linking them is the classic way to build a 2-cycle: with a triangle whose
// first and third vertices already share a root, `parent[a]=b` followed by
// `parent[b]=c` writes a→b and b→a, and the next find() spins forever.
const union = (x, y) => {
  const rx = find(x)
  const ry = find(y)
  if (rx !== ry) parent[rx] = ry
}
const tri = new Uint32Array(indices.getCount())
for (let i = 0; i < indices.getCount(); i++) tri[i] = indices.getScalar(i)
for (let i = 0; i < tri.length; i += 3) {
  union(tri[i], tri[i + 1])
  union(tri[i + 1], tri[i + 2])
}

// ── component statistics ────────────────────────────────────────────────────────
const comps = new Map()
for (let i = 0; i < vertCount; i++) {
  const r = find(i)
  let c = comps.get(r)
  if (!c) {
    c = { root: r, verts: 0, tris: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], r: 0, g: 0, b: 0, sat: 0, luma: 0 }
    comps.set(r, c)
  }
  c.verts++
  if (wxa[i] < c.lo[0]) c.lo[0] = wxa[i]
  if (wya[i] < c.lo[1]) c.lo[1] = wya[i]
  if (wza[i] < c.lo[2]) c.lo[2] = wza[i]
  if (wxa[i] > c.hi[0]) c.hi[0] = wxa[i]
  if (wya[i] > c.hi[1]) c.hi[1] = wya[i]
  if (wza[i] > c.hi[2]) c.hi[2] = wza[i]
  c.r += vr[i]
  c.g += vg[i]
  c.b += vb[i]
  c.sat += vsat[i]
  c.luma += vluma[i]
}
for (let i = 0; i < tri.length; i += 3) comps.get(find(tri[i])).tris++

const SAT_THRESHOLD = SAT_RATIO * modelSat
const list = [...comps.values()]
for (const c of list) {
  c.r /= c.verts
  c.g /= c.verts
  c.b /= c.verts
  c.sat /= c.verts
  c.luma /= c.verts
  c.w = c.hi[0] - c.lo[0]
  c.d = c.hi[2] - c.lo[2]
  c.h = c.hi[1] - c.lo[1]
  c.maxWD = Math.max(c.w, c.d)
  c.slender = c.maxWD > 0 ? c.h / c.maxWD : Infinity
  c.baseFrac = modelH > 0 ? (c.lo[1] - modelLoY) / modelH : 0
  c.high = c.baseFrac >= CUP_LINE
  c.bright = c.luma > modelLuma
  c.lowSat = c.sat < SAT_THRESHOLD
  /** DIAGNOSTIC ONLY. See note 2 in the header: it rescues nothing and contaminates. */
  c.column = c.slender >= COLUMN_MIN
  c.wax = c.high && c.bright && c.lowSat
}

const wax = list.filter((c) => c.wax)
const waxTris = wax.reduce((a, c) => a + c.tris, 0)
const waxFrac = waxTris / triCount

const weighted = (arr, f) =>
  arr.length ? arr.reduce((a, c) => a + f(c) * c.verts, 0) / arr.reduce((a, c) => a + c.verts, 0) : NaN

// Both statistics look only at components that are high, bright and big enough to
// carry a meaning­ful mean — the population the colour test actually decides over.
const pool = list.filter((c) => c.high && c.bright && c.tris >= STAT_MIN_TRIS)
const poolWax = pool.filter((c) => c.wax)
const poolRest = pool.filter((c) => !c.wax)
const separation = weighted(poolRest, (c) => c.sat) - weighted(poolWax, (c) => c.sat)
const waxiestNonWax = poolRest.length ? Math.min(...poolRest.map((c) => c.sat)) : NaN
const leastWaxyWax = poolWax.length ? Math.max(...poolWax.map((c) => c.sat)) : NaN
const margin = waxiestNonWax - leastWaxyWax

const waxR = weighted(wax, (c) => c.r)
const waxG = weighted(wax, (c) => c.g)
const waxB = weighted(wax, (c) => c.b)
const waxLo = [Infinity, Infinity, Infinity]
const waxHi = [-Infinity, -Infinity, -Infinity]
for (const c of wax) {
  for (let k = 0; k < 3; k++) {
    waxLo[k] = Math.min(waxLo[k], c.lo[k])
    waxHi[k] = Math.max(waxHi[k], c.hi[k])
  }
}

// ── report ──────────────────────────────────────────────────────────────────────
const cm = (v) => (v * 100).toFixed(1)
console.log(inPath)
console.log(`  tris ${triCount} · verts ${vertCount} · components ${comps.size} · height ${cm(modelH)} cm`)
console.log(
  `  model sat ${modelSat.toFixed(3)} / luma ${modelLuma.toFixed(3)} · sat threshold ${SAT_THRESHOLD.toFixed(3)} · cup line ${cm(CUP_LINE * modelH)} cm`,
)
console.log(
  `  WAX: ${wax.length} components · ${(waxFrac * 100).toFixed(1)}% of triangles · rgb(${Math.round(waxR)},${Math.round(waxG)},${Math.round(waxB)}) · sat ${weighted(wax, (c) => c.sat).toFixed(3)} · luma ${weighted(wax, (c) => c.luma).toFixed(3)}`,
)
if (wax.length)
  console.log(
    `  wax bbox ${cm(waxHi[0] - waxLo[0])} × ${cm(waxHi[2] - waxLo[2])} × ${cm(waxHi[1] - waxLo[1])} · y[${cm(waxLo[1])}, ${cm(waxHi[1])}]`,
  )
console.log(
  `  separation ${separation.toFixed(3)} (holder mean ${weighted(poolRest, (c) => c.sat).toFixed(3)} · wax mean ${weighted(poolWax, (c) => c.sat).toFixed(3)}) · threshold ${MIN_SEPARATION.toFixed(3)} · pool ${poolRest.length}/${poolWax.length}`,
)
if (REPORT_MARGIN)
  console.log(
    `  worst-case margin ${margin.toFixed(3)} (waxiest holder ${waxiestNonWax.toFixed(3)} · least-waxy wax ${leastWaxyWax.toFixed(3)}) — diagnostic, not gated`,
  )
const wouldAdd = list.filter((c) => c.high && c.bright && c.column && !c.wax)
console.log(
  `  column signal (diagnostic): would add ${wouldAdd.length} components · ${((wouldAdd.reduce((a, c) => a + c.tris, 0) / triCount) * 100).toFixed(1)}%` +
    (wouldAdd.length
      ? ` · rgb(${Math.round(weighted(wouldAdd, (c) => c.r))},${Math.round(weighted(wouldAdd, (c) => c.g))},${Math.round(weighted(wouldAdd, (c) => c.b))}) · sat ${weighted(wouldAdd, (c) => c.sat).toFixed(3)}`
      : ''),
)

if (measure) {
  console.log('  components above the cup line (tris · W×D×H cm · y[from,to] · base/H · H/maxWD · rgb · sat · luma · verdict):')
  const above = list.filter((c) => c.high).sort((a, b) => b.tris - a.tris)
  for (const c of above.slice(0, 40)) {
    console.log(
      `    ${String(c.tris).padStart(5)}  ${cm(c.w).padStart(5)} × ${cm(c.d).padStart(5)} × ${cm(c.h).padStart(5)}` +
        `  y[${cm(c.lo[1]).padStart(5)}, ${cm(c.hi[1]).padStart(5)}]  ${c.baseFrac.toFixed(3)}  ${c.slender.toFixed(2).padStart(6)}` +
        `  rgb(${String(Math.round(c.r)).padStart(3)},${String(Math.round(c.g)).padStart(3)},${String(Math.round(c.b)).padStart(3)})  ${c.sat.toFixed(3)}  ${c.luma.toFixed(3)}` +
        `  ${c.wax ? 'WAX' : c.column && c.bright ? '— (column only)' : '—'}`,
    )
  }
  if (above.length > 40) console.log(`    … ${above.length - 40} more`)
}

// ── the loud failure. The four crystal/glass models MUST land here. ─────────────
const failures = []
if (!wax.length) failures.push('no component qualifies as wax')
if (!poolWax.length)
  failures.push('no wax component is big enough to measure — there may be no candle in this model at all')
else if (!(separation >= MIN_SEPARATION))
  failures.push(`separation ${separation.toFixed(3)} < ${MIN_SEPARATION.toFixed(3)} — wax and holder are the same colour`)
if (waxFrac > MAX_WAX_FRACTION)
  failures.push(`wax is ${(waxFrac * 100).toFixed(1)}% of triangles, over the ${(MAX_WAX_FRACTION * 100).toFixed(0)}% ceiling`)
if (wax.length && waxLo[1] - modelLoY < CUP_LINE * modelH)
  failures.push(`wax reaches down to ${cm(waxLo[1])} cm, below the cup line ${cm(CUP_LINE * modelH)} cm`)

if (failures.length) {
  console.log('✗ the rule does NOT separate this model — do not ship this run')
  for (const f of failures) console.log(`    ${f}`)
  process.exit(1)
}

if (dry) {
  console.log(measure ? '  --measure: nothing written' : '  --dry: nothing written')
  process.exit(0)
}

// ── the split ───────────────────────────────────────────────────────────────────
const waxRoots = new Set(wax.map((c) => c.root))
const waxIdx = []
const restIdx = []
for (let i = 0; i < tri.length; i += 3) {
  const dst = waxRoots.has(find(tri[i])) ? waxIdx : restIdx
  dst.push(tri[i], tri[i + 1], tri[i + 2])
}

const srgbToLinear = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const src = prim.getMaterial()
const candleMat = doc
  .createMaterial('candle')
  .setBaseColorFactor([srgbToLinear(waxR), srgbToLinear(waxG), srgbToLinear(waxB), 1])
// ⚠ NO base-colour texture — that is the header's "NO BASE COLOUR TEXTURE" note, and
// it is the only map that would bias the colour the user picks.
//
// The OTHER maps are carried over, and that is measured rather than tidy. The first
// cut dropped all three and set a flat metallic 0 / roughness 0.6, which is
// invisible on four models but turned decor-candelabrum-gold's candles from warm
// bronze into flat grey: every one of these materials declares metallic 1 /
// roughness 1 modulated by a metallicRoughness map, and on that model the wax texels
// are marked metallic. metallicRoughness and normal carry no colour, so keeping them
// preserves the surface exactly while leaving the base colour a clean factor.
if (src) {
  candleMat.setMetallicFactor(src.getMetallicFactor()).setRoughnessFactor(src.getRoughnessFactor())
  const mr = src.getMetallicRoughnessTexture()
  if (mr) {
    candleMat.setMetallicRoughnessTexture(mr)
    const info = src.getMetallicRoughnessTextureInfo()
    if (info) candleMat.getMetallicRoughnessTextureInfo()?.copy(info)
  }
  const nrm = src.getNormalTexture()
  if (nrm) {
    candleMat.setNormalTexture(nrm).setNormalScale(src.getNormalScale())
    const info = src.getNormalTextureInfo()
    if (info) candleMat.getNormalTextureInfo()?.copy(info)
  }
}

const idxArray = (arr) => (vertCount > 65535 ? new Uint32Array(arr) : new Uint16Array(arr))
const buffer = indices.getBuffer() ?? root.listBuffers()[0]
const waxAcc = doc.createAccessor().setArray(idxArray(waxIdx)).setBuffer(buffer)
const waxPrim = doc.createPrimitive().setMode(prim.getMode()).setMaterial(candleMat).setIndices(waxAcc)
for (const sem of prim.listSemantics()) waxPrim.setAttribute(sem, prim.getAttribute(sem))
mesh.addPrimitive(waxPrim)
indices.setArray(idxArray(restIdx))

await io.write(outPath, doc)
const sizeAfter = statSync(outPath).size
console.log(
  `  → ${outPath} · ${(sizeBefore / 1e6).toFixed(3)} → ${(sizeAfter / 1e6).toFixed(3)} MB (${sizeAfter > sizeBefore ? '+' : ''}${(((sizeAfter - sizeBefore) / sizeBefore) * 100).toFixed(1)}%)`,
)
console.log(
  `  candle material baseColorFactor from measured wax rgb(${Math.round(waxR)},${Math.round(waxG)},${Math.round(waxB)}) — catalogue waxColor #${[waxR, waxG, waxB].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`,
)
