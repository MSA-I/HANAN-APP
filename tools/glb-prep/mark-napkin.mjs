#!/usr/bin/env node
/**
 * Name the NAPKIN of a place-setting cover, so the renderer can let the user
 * recolour the linen without touching the charger, the cutlery or the glasses.
 *
 * ── WHY THIS IS A `mark-`, NOT THE `split-napkin.mjs` R5 PLAN-01 §3.7 SPECIFIES ──
 * §3.7 assumes the napkin is baked into the cover as part of one Tripo material and
 * plans a generalisation of split-candles.mjs to cut it out. MEASUREMENT SAYS
 * OTHERWISE on four of the five files: Tripo already segmented the napkin into its
 * OWN primitive with its OWN material and its OWN baked texture.
 *
 *   file          primitives  the napkin                       tris
 *   diagonal          9       Material_tripo_part_2            27,014
 *   vertical          9       Material_tripo_part_3            16,313
 *   folded           11       Material_tripo_part_3            21,942
 *   tied             20       parts 2,4,6,13,14,15,16,17,19    56,613
 *   horizontal       11       WELDED INTO THE CHARGER — none
 *
 * A tool that cuts index buffers has nothing to cut on those four, and cutting
 * where a boundary already exists would re-encode geometry for no gain (splitting a
 * file that is already split cost 11–40% of its size in round 5 — split-candles'
 * own lesson). So this joins mark-glass.mjs and mark-fabric.mjs: it RENAMES.
 *
 * `horizontal` is the one file where §3.7's premise holds, and it is REFUSED rather
 * than guessed — see "THE LOUD FAILURE" below.
 *
 * ── THE RULE, AND WHY IT IS GEOMETRIC BEFORE IT IS COLOURED ────────────────────
 * Nothing in a Tripo export says "napkin": all twenty parts of the tied cover are
 * called `Material_tripo_part_<n>` and every one declares metallic 1 / roughness 1.
 * §3.7 warns in as many words that the bbox table alone is NOT enough — a wide flat
 * part can be a spread napkin or a placemat. Two independent signals therefore have
 * to agree, and a third (a render) confirms before anything ships:
 *
 *   1. THE CHARGER IS THE ANCHOR. It is the part with the largest PLAN footprint in
 *      every one of the five files, by 1.4× (diagonal) to 5.3× (tied).
 *   2. A NAPKIN LIES ON THE CHARGER. Its plan footprint sits over the charger's and
 *      it rises above the charger's top. The FOOTPRINT half does nearly all the
 *      work and the margin is the whole interval: across the four files that pass,
 *      every napkin part covers 0.95…1.00 of its own area with the charger, and
 *      EVERY other part — all twenty-nine of them, cutlery and glasses alike —
 *      scores 0.02 or less. That is what keeps the glasses out even where
 *      mark-glass has not named them (the tied cover, see entries/tableDecor.ts):
 *      both vessels stand clear of the charger's rectangle, the nearer by 1.05 cm.
 *      The height half only says "on top of, not under": lifts run +0.32…+4.37 cm
 *      for napkin parts and −1.05 cm or less for everything else that is not a
 *      glass, so the threshold has 0.32 cm of room below it and 1.05 above.
 *   3. COLOUR IS THE SECOND SIGNAL, AND IT IS PER PART. Each candidate's mean baked
 *      texel must differ from the charger's by MIN_COLOUR_DISTANCE. Measured, the
 *      closest twelve: 0.241 (folded, olive on beige) · 0.261 (vertical) · 0.331
 *      (diagonal) · 0.409…0.800 (the tied cover's nine copper parts) — every one at
 *      least twice the gate, while the cutlery it must reject scores 0.13. This is
 *      what §3.7 demands and it is what would catch the day a re-export raises the
 *      charger's own rim above its well.
 *
 * A rule of the model's OWN numbers rather than centimetres, for mark-fabric.mjs's
 * reason (:16-23): it then reads a raw export and a prepped file alike.
 *
 * ── ⚠ UNIQUE NAMES, SHARED PREFIX ─────────────────────────────────────────────
 * `napkin-00`, `napkin-01`, … and never one name for all nine. propModel.buildParts
 * MERGES primitives that share a material name and keeps only the FIRST material,
 * which would dress the tied cover's nine napkin parts in part 2's metallicRoughness
 * and normal maps over eight other UV layouts. The catalog matches on the PREFIX
 * (`editableSlots[].match = 'napkin'`, `material.name.startsWith`), exactly as
 * mark-fabric.mjs's curtain does. Draw calls are unchanged: these were already
 * separate primitives.
 *
 * ── ⚠ THE BASE-COLOUR TEXTURE COMES OFF; NOTHING ELSE DOES ────────────────────
 * The renderer tints by writing `color` onto a clone of the baked material, which
 * MULTIPLIES the pick by the bake (ObjectGroup.ModelParts). Keeping the map would
 * make the picker lie, and not subtly: the folded cover's napkin bakes to
 * rgb(121,125,108), so picking pure #ffffff would still render olive, and the tied
 * cover's rgb(127,94,75) would turn #1a237e into rgb(13,13,38) — black. The map is
 * replaced by `baseColorFactor` = the mean texel THIS tool measured on THIS part, so
 * an untouched napkin keeps the colour it had.
 *
 * metallicRoughness and normal are CARRIED OVER, and that is measured rather than
 * tidy — it is split-candles.mjs's hardest-won line (:486-495). Every one of these
 * materials declares metallic 1 / roughness 1 modulated by an MR map; dropping them
 * for a flat metallic 0 turned that tool's first cut from warm bronze into grey.
 * Those two maps carry no colour, so keeping them preserves the surface exactly
 * while leaving the base colour a clean factor.
 *
 * The factor is per PART, not per group: the tied cover's knot bakes darker
 * (rgb(110,78,59)) than its body (rgb(129,96,76)), and one group mean would flatten
 * that. The catalogue's `defaultColor` is the triangle-weighted group mean, which
 * this tool prints.
 *
 * ⚠ THE FACTOR IS LINEAR, AND `tools/model-elevation.mjs` CANNOT READ IT. glTF
 * defines `baseColorFactor` in linear space (three.js: `setRGB(…, LinearSRGB)`),
 * which is why this converts through `srgbToLinear` exactly as split-candles.mjs
 * does. The offline rasteriser multiplies the factor into the texel in BYTE space
 * and writes the result straight out with no encode, so a marked file renders there
 * far too dark — a 0.475 sRGB olive comes out at 0.19. That is the tool, not the
 * file. Judge a marked cover in the app, never in an elevation PNG; the elevation
 * is still exact for TELLING THE PARTS APART, which is what it is used for here.
 *
 * ── THE LOUD FAILURE ──────────────────────────────────────────────────────────
 * Exit 1, and `decor-place-setting-horizontal.glb` MUST land there: in that file
 * Tripo welded the napkin and the charger into one 46,162-triangle primitive, so
 * there is no part above the charger to name and the rule finds nothing. Its
 * components ARE bimodal by colour (a white family at sat 0.012 against a woven one
 * at sat 0.146) but they interleave — sixteen intermediate components read
 * sat 0.077…0.137 — and PLAN-01 §3.7 forbids writing `match:'napkin'` on a reading
 * that thin. It ships with no slot, which entries/tableDecor.ts records with the
 * reason. Hand-written part indices are exactly what this family of tools exists to
 * avoid.
 *
 * ⚠ RUN IT AFTER glb-prep, NEVER BEFORE, and after mark-glass — same as its two
 * siblings. Re-prepping the source rewrites every material and erases these names.
 *
 * Idempotent: a second run re-selects the same parts, re-numbers them and rewrites
 * the same factors, so it yields an equivalent file. It refuses if a part that
 * carries the name no longer classifies, because at that point the file and the
 * marking disagree and only a re-prep can settle it.
 *
 *   node mark-napkin.mjs <in.glb> [--out <file>] [--measure] [--dry]
 */
import { NodeIO } from '@gltf-transform/core'
import { KHRDracoMeshCompression } from '@gltf-transform/extensions'
import draco3d from 'draco3dgltf'
import sharp from 'sharp'
import { statSync } from 'node:fs'

const argv = process.argv.slice(2)
const inPath = argv[0]
if (!inPath || inPath.startsWith('--')) {
  console.error('usage: node mark-napkin.mjs <in.glb> [--out <file>] [--measure] [--dry]')
  process.exit(2)
}
const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : inPath
const measure = argv.includes('--measure')
const dry = argv.includes('--dry') || measure

/** The prefix the catalog's `editableSlots[].match` names. */
const PREFIX = 'napkin'
/**
 * How far above the charger's top a part must reach, as a fraction of the model's
 * height. It says "resting ON, not tucked UNDER" and nothing more — the footprint
 * test and the colour test are what actually decide. Measured: the LOWEST napkin
 * part is the tied cover's smallest knot fragment at +0.32 cm (0.017 of height) and
 * the highest non-napkin that clears the footprint test at all is a fork at
 * −1.05 cm, so anything in 0.000…0.017 separates. 0.005 (0.09 cm) sits inside it
 * with room on both sides; 0.02 does NOT — it drops that 353-triangle knot.
 */
const LIFT_MIN = 0.005
/**
 * Fraction of a part's OWN plan area that must lie over the charger's. Measured:
 * every napkin part scores 0.95…1.00 and every one of the twenty-nine other parts
 * scores 0.02 or less, so the band is very nearly the whole interval. 0.5 is its
 * middle.
 */
const OVERLAP_MIN = 0.5
/**
 * Smallest acceptable RGB distance (0…1, Euclidean over 0-255 channels ÷ 255)
 * between a candidate's mean baked texel and the charger's. Measured over the
 * twelve napkin parts: 0.241…0.800, closest first 0.241 · 0.261 · 0.331 · 0.409.
 * The gate is half the closest of them, and the cutlery it must reject sits at 0.13.
 */
const MIN_COLOUR_DISTANCE = 0.12
/** Past this the rule swallowed the cover, not the napkin. Measured high: 0.29 (tied). */
const MAX_NAPKIN_FRACTION = 0.45
/** Below this it found a crumb. Measured low: 0.09 (vertical). */
const MIN_NAPKIN_FRACTION = 0.02

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  })

const sizeBefore = statSync(inPath).size
const doc = await io.read(inPath)
const root = doc.getRoot()

const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b)
  return mx === 0 ? 0 : (mx - Math.min(r, g, b)) / mx
}
const srgbToLinear = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

const texCache = new Map()
const decode = async (tex) => {
  if (!tex) return null
  if (texCache.has(tex)) return texCache.get(tex)
  const { data, info } = await sharp(Buffer.from(tex.getImage()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const v = { data, w: info.width, h: info.height, c: info.channels }
  texCache.set(tex, v)
  return v
}

// ── every primitive, with its world bbox in cm and its mean baked texel ─────────
const parts = []
for (const node of root.listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const uv = prim.getAttribute('TEXCOORD_0')
    const idx = prim.getIndices()
    const mat = prim.getMaterial()
    if (!pos || !idx || !mat) {
      console.error(`✗ ${inPath}: a primitive has no POSITION, indices or material`)
      process.exit(1)
    }
    const tex = await decode(mat.getBaseColorTexture())
    const n = pos.getCount()
    const lo = [Infinity, Infinity, Infinity]
    const hi = [-Infinity, -Infinity, -Infinity]
    let R = 0
    let G = 0
    let B = 0
    const p = [0, 0, 0]
    const t = [0, 0]
    for (let i = 0; i < n; i++) {
      pos.getElement(i, p)
      const w = [
        (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) * 100,
        (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) * 100,
        (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) * 100,
      ]
      for (let a = 0; a < 3; a++) {
        if (w[a] < lo[a]) lo[a] = w[a]
        if (w[a] > hi[a]) hi[a] = w[a]
      }
      if (tex && uv) {
        // glTF's UV origin is the image's TOP-left, so v maps straight onto the row.
        uv.getElement(i, t)
        let px = Math.floor((t[0] - Math.floor(t[0])) * tex.w)
        let py = Math.floor((t[1] - Math.floor(t[1])) * tex.h)
        if (px >= tex.w) px = tex.w - 1
        if (py >= tex.h) py = tex.h - 1
        const o = (py * tex.w + px) * tex.c
        R += tex.data[o]
        G += tex.data[o + 1]
        B += tex.data[o + 2]
      }
    }
    // A part this tool has ALREADY marked has no base-colour map left to sample;
    // its measured mean is the factor the previous run wrote. That is what makes a
    // second run see the same colours as the first.
    const f = mat.getBaseColorFactor()
    const rgb = tex && uv ? [R / n, G / n, B / n] : [linearToSrgb(f[0]), linearToSrgb(f[1]), linearToSrgb(f[2])]
    parts.push({
      prim,
      mat,
      name: mat.getName(),
      sampled: Boolean(tex && uv),
      tris: idx.getCount() / 3,
      lo,
      hi,
      w: hi[0] - lo[0],
      d: hi[2] - lo[2],
      h: hi[1] - lo[1],
      area: (hi[0] - lo[0]) * (hi[2] - lo[2]),
      rgb,
      sat: satOf(rgb[0], rgb[1], rgb[2]),
    })
  }
}
if (!parts.length) {
  console.error(`✗ ${inPath}: no primitives`)
  process.exit(1)
}

const triCount = parts.reduce((a, c) => a + c.tris, 0)
const modelLoY = Math.min(...parts.map((c) => c.lo[1]))
const modelHiY = Math.max(...parts.map((c) => c.hi[1]))
const modelH = modelHiY - modelLoY

// ── the charger: the largest plan footprint that is not a marked glass ─────────
const isGlass = (c) => c.name.startsWith('glass')
const platePool = parts.filter((c) => !isGlass(c))
const plate = platePool.reduce((a, c) => (c.area > a.area ? c : a), platePool[0])
const runnerUp = platePool.filter((c) => c !== plate).reduce((a, c) => (a && a.area > c.area ? a : c), null)

/** Fraction of `c`'s plan rectangle that lies inside the charger's. */
const overlapOf = (c) => {
  const ox = Math.max(0, Math.min(c.hi[0], plate.hi[0]) - Math.max(c.lo[0], plate.lo[0]))
  const oz = Math.max(0, Math.min(c.hi[2], plate.hi[2]) - Math.max(c.lo[2], plate.lo[2]))
  return c.area > 0 ? (ox * oz) / c.area : 0
}
const LIFT = LIFT_MIN * modelH
/** RGB distance from the charger, 0…1 — the second signal, applied to each part. */
const distanceOf = (c) => Math.hypot(...[0, 1, 2].map((k) => c.rgb[k] - plate.rgb[k])) / 255
for (const c of parts) {
  c.lift = c.hi[1] - plate.hi[1]
  c.overlap = overlapOf(c)
  c.distance = distanceOf(c)
  /** geometry alone: lying on the charger. What colour then has to confirm. */
  c.onPlate = c !== plate && !isGlass(c) && c.lift > LIFT && c.overlap >= OVERLAP_MIN
  c.napkin = c.onPlate && c.distance >= MIN_COLOUR_DISTANCE
}

const napkin = parts.filter((c) => c.napkin)
const napkinTris = napkin.reduce((a, c) => a + c.tris, 0)
const napkinFrac = napkinTris / triCount
const weighted = (arr, f) =>
  arr.length ? arr.reduce((a, c) => a + f(c) * c.tris, 0) / arr.reduce((a, c) => a + c.tris, 0) : NaN
const meanRgb = (arr) => [0, 1, 2].map((k) => weighted(arr, (c) => c.rgb[k]))
const nRgb = meanRgb(napkin)
const distance = napkin.length
  ? Math.hypot(nRgb[0] - plate.rgb[0], nRgb[1] - plate.rgb[1], nRgb[2] - plate.rgb[2]) / 255
  : NaN
const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

// ── report ─────────────────────────────────────────────────────────────────────
const f1 = (v) => v.toFixed(1).padStart(5)
console.log(inPath)
console.log(
  `  ${parts.length} primitives · ${Math.round(triCount)} tris · height ${modelH.toFixed(1)} cm · lift threshold ${LIFT.toFixed(2)} cm`,
)
console.log(
  `  CHARGER ${plate.name} · ${f1(plate.w)} × ${f1(plate.d)} cm = ${Math.round(plate.area)} cm² · top ${plate.hi[1].toFixed(1)} cm · rgb(${plate.rgb.map((v) => Math.round(v)).join(',')})` +
    (runnerUp ? ` · next largest ${runnerUp.name} ${Math.round(runnerUp.area)} cm² (${(plate.area / runnerUp.area).toFixed(2)}×)` : ''),
)
console.log(
  `  NAPKIN: ${napkin.length} parts · ${Math.round(napkinTris)} tris · ${(napkinFrac * 100).toFixed(1)}% of the model · rgb(${nRgb.map((v) => Math.round(v)).join(',')}) ${hex(nRgb)} · sat ${satOf(...nRgb).toFixed(3)}`,
)
console.log(
  `  group colour distance from the charger ${distance.toFixed(3)} · per-part threshold ${MIN_COLOUR_DISTANCE.toFixed(3)}`,
)
if (napkin.length) {
  const rest = parts.filter((c) => c !== plate && !isGlass(c) && !c.napkin)
  const overPlate = rest.filter((c) => c.overlap >= OVERLAP_MIN)
  console.log(
    `  margins — lowest napkin: lift +${Math.min(...napkin.map((c) => c.lift)).toFixed(2)} cm · overlap ${Math.min(...napkin.map((c) => c.overlap)).toFixed(2)} · colour ${Math.min(...napkin.map((c) => c.distance)).toFixed(3)}`,
  )
  console.log(
    `  margins — nearest reject: overlap ${rest.length ? Math.max(...rest.map((c) => c.overlap)).toFixed(2) : 'n/a'} · ` +
      `highest lift over the charger ${overPlate.length ? `${Math.max(...overPlate.map((c) => c.lift)).toFixed(2)} cm` : 'none clears the footprint test'} · ` +
      `colour ${rest.length ? Math.max(...rest.map((c) => c.distance)).toFixed(3) : 'n/a'}`,
  )
}
if (measure) {
  console.log('  every primitive (tris · W×D×H cm · y[from,to] · lift · overlap · Δcolour · rgb · sat · verdict):')
  for (const c of [...parts].sort((a, b) => b.tris - a.tris)) {
    console.log(
      `    ${String(Math.round(c.tris)).padStart(6)}  ${f1(c.w)} × ${f1(c.d)} × ${f1(c.h)}  y[${f1(c.lo[1])},${f1(c.hi[1])}]  ` +
        `lift ${c.lift.toFixed(2).padStart(6)}  ovl ${c.overlap.toFixed(2)}  Δ ${c.distance.toFixed(3)}  ` +
        `rgb(${c.rgb.map((v) => String(Math.round(v)).padStart(3)).join(',')})  ${c.sat.toFixed(3)}  ` +
        `${c === plate ? 'CHARGER' : c.napkin ? 'NAPKIN' : isGlass(c) ? '— glass' : c.onPlate ? '— on the charger but its colour' : '—'}  ${c.name}${c.sampled ? '' : ' (from factor)'}`,
    )
  }
}

// ── the loud failure. `horizontal` MUST land here. ─────────────────────────────
const failures = []
if (!napkin.length) {
  const onPlate = parts.filter((c) => c.onPlate)
  failures.push(
    onPlate.length
      ? `the ${onPlate.length} part(s) lying on the charger are its own colour (Δ ${onPlate.map((c) => c.distance.toFixed(3)).join(', ')} < ${MIN_COLOUR_DISTANCE.toFixed(3)})`
      : 'no part lies on the charger — the napkin is welded into another primitive',
  )
} else {
  if (napkinFrac > MAX_NAPKIN_FRACTION)
    failures.push(
      `the napkin is ${(napkinFrac * 100).toFixed(1)}% of the model, over the ${(MAX_NAPKIN_FRACTION * 100).toFixed(0)}% ceiling`,
    )
  if (napkinFrac < MIN_NAPKIN_FRACTION)
    failures.push(
      `the napkin is ${(napkinFrac * 100).toFixed(1)}% of the model, under the ${(MIN_NAPKIN_FRACTION * 100).toFixed(0)}% floor`,
    )
}
// a name this tool wrote on a part the rule no longer picks: the file and the
// marking disagree, and only a re-prep from the source can settle which is right
const stale = parts.filter((c) => c.name.startsWith(PREFIX) && !c.napkin)
if (stale.length) failures.push(`already marked but no longer classifies: ${stale.map((c) => c.name).join(', ')}`)

if (failures.length) {
  console.log('✗ the rule does NOT find a napkin in this model — do not ship this run')
  for (const f of failures) console.log(`    ${f}`)
  process.exit(1)
}

if (dry) {
  console.log(measure ? '  --measure: nothing written' : '  --dry: nothing written')
  process.exit(0)
}

// ── the marking ────────────────────────────────────────────────────────────────
const remarked = napkin.filter((c) => c.name.startsWith(PREFIX)).length
napkin.sort((a, b) => b.tris - a.tris)
napkin.forEach((c, i) => {
  c.mat.setName(`${PREFIX}-${String(i).padStart(2, '0')}`)
  c.mat.setBaseColorTexture(null)
  c.mat.setBaseColorFactor([srgbToLinear(c.rgb[0]), srgbToLinear(c.rgb[1]), srgbToLinear(c.rgb[2]), 1])
})
// the maps the dropped base colour left behind are nobody's now
for (const tex of root.listTextures()) if (!tex.listParents().some((p) => p.propertyType === 'Material')) tex.dispose()

await io.write(outPath, doc)
const sizeAfter = statSync(outPath).size
console.log(
  `  → ${outPath} · ${(sizeBefore / 1e6).toFixed(3)} → ${(sizeAfter / 1e6).toFixed(3)} MB (${sizeAfter > sizeBefore ? '+' : ''}${(((sizeAfter - sizeBefore) / sizeBefore) * 100).toFixed(1)}%)` +
    (remarked ? ` · re-run: ${remarked} of ${napkin.length} parts were already marked` : ''),
)
console.log(`  renamed ${napkin.map((c) => c.mat.getName()).join(', ')}`)
console.log(`  catalogue defaultColor ${hex(nRgb)} — the triangle-weighted mean of the parts above`)
