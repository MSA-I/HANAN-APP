#!/usr/bin/env node
/**
 * topdown-prep — orthographic top-down plan images for every furniture GLB.
 *
 * The 2D editor draws primitives (circle/rect/arc) from each catalog entry's
 * `footprint()`, so a round table reads as a flat disc while 3D shows a draped
 * cloth. This renders every prop from directly above into public/plan/, which
 * ObjectNode then draws over the vector shape.
 *
 * Why a software rasteriser instead of three.js: headless WebGL on this Windows
 * box needs `gl` (a native build) or a browser round-trip, and PLAN-06 calls the
 * headless route a known minefield. An orthographic view straight down is a
 * z-buffer over the plan axes and nothing more — that is the whole renderer
 * below, with no native toolchain to keep working. glb-prep/extract-zones.mjs
 * already rasterises GLB triangles this way to get the venue outline.
 *
 * Output is keyed by GLB path, not catalog id: several catalog entries share one
 * model, and a .mjs tool cannot import the TypeScript catalog to learn the ids.
 * `entry.model` is the key the app already holds. Sizes are stored in plan cm so
 * the drawing side never hardcodes a scale — see 06-topdown-manifest.md.
 *
 *   node tools/topdown-prep.mjs [--only <substring>] [--force]
 */
import { createRequire } from 'node:module'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// @gltf-transform and draco live in tools/glb-prep/node_modules — they are
// asset-prep deps, not app deps. Node's ESM resolver only walks UP from this
// file, so borrow them through that package instead of duplicating the install.
const req = createRequire(new URL('./glb-prep/package.json', import.meta.url))
const { NodeIO } = req('@gltf-transform/core')
const { KHRDracoMeshCompression } = req('@gltf-transform/extensions')
const draco3d = req('draco3dgltf')

const PROPS_DIR = fileURLToPath(new URL('../public/props/', import.meta.url))
const OUT_DIR = fileURLToPath(new URL('../public/plan/', import.meta.url))

/** Plan-cm → px at full size. A 380 cm table would be 1520 px, hence the cap. */
const PX_PER_CM = 4
/** Longest side of a written image. Keeps the whole folder in the low MB. */
const MAX_SIDE = 1024
/** Fraction of the footprint added around it, so nothing clips at the edge. */
const PAD = 0.02
/** Render scale; the box-filter downscale to 1× is the antialiasing. */
const SS = 2

/**
 * Sun direction (three axes, y up). Straight down flattens the model into a
 * silhouette — every top face gets identical light — so it is tilted enough to
 * shade the sides of a chair back and read as depth from above.
 */
const LIGHT = norm3(0.32, 1, -0.42)
const AMBIENT = 0.55

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

/** Decoded baseColorTexture as raw RGBA, cached per glTF Texture within a file. */
async function decodeTexture(texture, cache) {
  if (!texture) return null
  if (cache.has(texture)) return cache.get(texture)
  let out = null
  try {
    const image = texture.getImage()
    if (image) {
      const { data, info } = await sharp(Buffer.from(image))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      out = { data, w: info.width, h: info.height }
    }
  } catch {
    out = null // untouched baseColorFactor is a fine fallback for one bad texture
  }
  cache.set(texture, out)
  return out
}

/** Bilinear sample, glTF REPEAT wrap. glTF UV origin is top-left, like raw rows. */
function sampleTexture(tex, u, v, out) {
  const fx = (u - Math.floor(u)) * tex.w - 0.5
  const fy = (v - Math.floor(v)) * tex.h - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const xa = ((x0 % tex.w) + tex.w) % tex.w
  const xb = (xa + 1) % tex.w
  const ya = ((y0 % tex.h) + tex.h) % tex.h
  const yb = (ya + 1) % tex.h
  const i00 = (ya * tex.w + xa) * 4
  const i10 = (ya * tex.w + xb) * 4
  const i01 = (yb * tex.w + xa) * 4
  const i11 = (yb * tex.w + xb) * 4
  const d = tex.data
  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c] * (1 - tx) + d[i10 + c] * tx
    const bot = d[i01 + c] * (1 - tx) + d[i11 + c] * tx
    out[c] = (top * (1 - ty) + bot * ty) / 255
  }
}

/**
 * World-space triangles in plan cm: x/z become the image axes, y becomes depth.
 * Mirrors extract-zones.mjs's node walk, but keeps normals and UVs too.
 */
async function readTriangles(doc) {
  const texCache = new Map()
  const tris = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    // normals need the inverse-transpose in general; glb-prep only ever applies
    // uniform scale, yaw and translation, so the linear part rotates them fine
    // once renormalised per pixel.
    const wx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z + m[12]
    const wy = (x, y, z) => m[1] * x + m[5] * y + m[9] * z + m[13]
    const wz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z + m[14]
    const nx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z
    const ny = (x, y, z) => m[1] * x + m[5] * y + m[9] * z
    const nz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const nor = prim.getAttribute('NORMAL')
      const uvA = prim.getAttribute('TEXCOORD_0')
      const idx = prim.getIndices()
      const material = prim.getMaterial()
      const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1]
      const tex = await decodeTexture(material?.getBaseColorTexture(), texCache)

      const count = idx ? idx.getCount() : pos.getCount()
      const p = [0, 0, 0]
      const n = [0, 0, 0]
      const t = [0, 0]
      const vert = (i) => {
        const vi = idx ? idx.getScalar(i) : i
        pos.getElement(vi, p)
        const v = {
          // plan cm: metres → cm, three x/z are the image axes, y is depth
          x: wx(p[0], p[1], p[2]) * 100,
          d: wy(p[0], p[1], p[2]) * 100,
          y: wz(p[0], p[1], p[2]) * 100,
          nx: 0,
          ny: 1,
          nz: 0,
          u: 0,
          v: 0,
        }
        if (nor) {
          nor.getElement(vi, n)
          v.nx = nx(n[0], n[1], n[2])
          v.ny = ny(n[0], n[1], n[2])
          v.nz = nz(n[0], n[1], n[2])
        }
        if (uvA) {
          uvA.getElement(vi, t)
          v.u = t[0]
          v.v = t[1]
        }
        return v
      }
      for (let i = 0; i + 2 < count; i += 3) {
        tris.push({ a: vert(i), b: vert(i + 1), c: vert(i + 2), factor, tex })
      }
    }
  }
  return tris
}

/**
 * Frame symmetrically about the model origin rather than about the triangle
 * bbox centre: the object's origin is what ObjectNode positions and rotates
 * around, so the image centre has to be that same point or every placed item
 * sits slightly off its own footprint.
 */
function halfExtents(tris) {
  let hx = 0
  let hy = 0
  for (const t of tris) {
    for (const v of [t.a, t.b, t.c]) {
      if (Math.abs(v.x) > hx) hx = Math.abs(v.x)
      if (Math.abs(v.y) > hy) hy = Math.abs(v.y)
    }
  }
  return [hx * (1 + PAD), hy * (1 + PAD)]
}

function render(tris, halfW, halfD, pxPerCm) {
  const s = pxPerCm * SS
  const W = Math.max(1, Math.round(2 * halfW * s))
  const H = Math.max(1, Math.round(2 * halfD * s))
  const depth = new Float32Array(W * H).fill(-Infinity)
  const rgba = new Uint8ClampedArray(W * H * 4)
  const texel = [1, 1, 1, 1]

  for (const t of tris) {
    // pixel-centre convention: plan cm of pixel i is -halfW + (i + 0.5)/s
    const ax = (t.a.x + halfW) * s - 0.5
    const ay = (t.a.y + halfD) * s - 0.5
    const bx = (t.b.x + halfW) * s - 0.5
    const by = (t.b.y + halfD) * s - 0.5
    const cx = (t.c.x + halfW) * s - 0.5
    const cy = (t.c.y + halfD) * s - 0.5

    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (det === 0) continue

    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)))
    const i1 = Math.min(W - 1, Math.floor(Math.max(ax, bx, cx)))
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)))
    const j1 = Math.min(H - 1, Math.floor(Math.max(ay, by, cy)))
    if (i1 < i0 || j1 < j0) continue

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const la = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / det
        if (la < 0) continue
        const lb = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / det
        if (lb < 0) continue
        const lc = 1 - la - lb
        if (lc < 0) continue

        const d = la * t.a.d + lb * t.b.d + lc * t.c.d
        const at = i + j * W
        if (d <= depth[at]) continue
        depth[at] = d

        let r = t.factor[0]
        let g = t.factor[1]
        let b = t.factor[2]
        if (t.tex) {
          sampleTexture(
            t.tex,
            la * t.a.u + lb * t.b.u + lc * t.c.u,
            la * t.a.v + lb * t.b.v + lc * t.c.v,
            texel,
          )
          r *= texel[0]
          g *= texel[1]
          b *= texel[2]
        }

        const vnx = la * t.a.nx + lb * t.b.nx + lc * t.c.nx
        const vny = la * t.a.ny + lb * t.b.ny + lc * t.c.ny
        const vnz = la * t.a.nz + lb * t.b.nz + lc * t.c.nz
        const len = Math.hypot(vnx, vny, vnz) || 1
        // two-sided: a top-down z-buffer keeps whichever face is uppermost, and
        // on an open shell (a draped cloth) that face can be wound either way.
        const lambert = Math.abs((vnx * LIGHT[0] + vny * LIGHT[1] + vnz * LIGHT[2]) / len)
        const shade = AMBIENT + (1 - AMBIENT) * lambert

        const o = at * 4
        rgba[o] = r * shade * 255
        rgba[o + 1] = g * shade * 255
        rgba[o + 2] = b * shade * 255
        rgba[o + 3] = 255
      }
    }
  }
  return { rgba, W, H }
}

const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const force = args.includes('--force')

const files = (await readdir(PROPS_DIR))
  .filter((f) => f.endsWith('.glb'))
  .filter((f) => !only || f.includes(only))
  .sort()

if (!files.length) {
  console.error(`no GLBs matched in ${PROPS_DIR}`)
  process.exit(1)
}

await mkdir(OUT_DIR, { recursive: true })

const manifestPath = path.join(OUT_DIR, 'manifest.json')
let manifest = { pxPerCmMax: PX_PER_CM, maxSide: MAX_SIDE, items: {} }
if (!force) {
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.items ??= {}
  } catch {
    // first run
  }
}

const failed = []
let totalKb = 0

for (const file of files) {
  const name = path.basename(file, '.glb')
  const outFile = `${name}.webp`
  try {
    const doc = await io.read(path.join(PROPS_DIR, file))
    const tris = await readTriangles(doc)
    if (!tris.length) throw new Error('no triangles')

    const [halfW, halfD] = halfExtents(tris)
    if (!(halfW > 0 && halfD > 0)) throw new Error('degenerate footprint')

    const pxPerCm = Math.min(PX_PER_CM, MAX_SIDE / (2 * Math.max(halfW, halfD)))
    const { rgba, W, H } = render(tris, halfW, halfD, pxPerCm)

    const outW = Math.max(1, Math.round(W / SS))
    const outH = Math.max(1, Math.round(H / SS))
    await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length), {
      raw: { width: W, height: H, channels: 4 },
    })
      .resize(outW, outH, { fit: 'fill', kernel: 'lanczos3' })
      .webp({ quality: 80, alphaQuality: 90 })
      .toFile(path.join(OUT_DIR, outFile))

    const kb = Math.round((await stat(path.join(OUT_DIR, outFile))).size / 1024)
    totalKb += kb
    manifest.items[`/props/${file}`] = {
      file: outFile,
      // plan cm the image spans; ObjectNode scales this by size/defaultSize
      cmW: +(2 * halfW).toFixed(2),
      cmD: +(2 * halfD).toFixed(2),
      pxPerCm: +(outW / (2 * halfW)).toFixed(4),
      w: outW,
      h: outH,
    }
    console.log(
      `${name.padEnd(32)} ${String(Math.round(2 * halfW)).padStart(4)}×${String(Math.round(2 * halfD)).padEnd(4)} cm  ` +
        `-> ${outW}×${outH} (${kb} KB, ${tris.length} tris)`,
    )
  } catch (err) {
    failed.push({ file, error: err instanceof Error ? err.message : String(err) })
    console.error(`${name.padEnd(32)} FAILED: ${err instanceof Error ? err.message : err}`)
  }
}

manifest.pxPerCmMax = PX_PER_CM
manifest.maxSide = MAX_SIDE
manifest.failed = failed.map((f) => f.file)
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(
  `\n${files.length - failed.length}/${files.length} rendered, ${Math.round(totalKb / 1024)} MB total -> ${OUT_DIR}`,
)
if (failed.length) {
  console.error(`${failed.length} failed:`)
  for (const f of failed) console.error(`  - ${f.file}: ${f.error}`)
  process.exitCode = 1
}
