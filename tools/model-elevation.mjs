#!/usr/bin/env node
/**
 * model-elevation — an orthographic ELEVATION of a prepped prop GLB, as raw RGBA.
 *
 * Why this exists: tools/thumbs-prep.mjs turns a PRODUCT PHOTO into a library
 * thumbnail, and every catalog entry until now had one. The human figure does
 * not — the user supplied the model and said in as many words that no photo was
 * needed (source doc §17) — so its library tile has to be rendered from the file
 * itself. topdown-prep.mjs already renders every prop, but from directly ABOVE,
 * and a person seen from above is a disc of hair: fine as the 2D plan symbol,
 * useless as the thing you pick out of a list. This is the same renderer looking
 * at the model from the FRONT instead.
 *
 * It is deliberately the same software rasteriser as topdown-prep rather than a
 * three.js/headless-WebGL round trip, for the reason stated there: an orthographic
 * view down one axis is a z-buffer and nothing more, and it keeps working without
 * a native toolchain on this Windows box.
 *
 *   node tools/model-elevation.mjs <in.glb> <out.png> [--view front|side|top]
 *
 * ponytail: no camera model, no shadows — one directional light plus ambient.
 *           Upgrade path is topdown-prep's, not a new engine.
 */
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

/** Fraction of the model's extent added around it, so nothing clips at the edge. */
const PAD = 0.03
/** Render scale; the box-filter downscale afterwards is the antialiasing. */
const SS = 2
/** Longest rendered side before supersampling, in px. */
const MAX_SIDE = 768
const AMBIENT = 0.5

/**
 * The three axis mappings, in glTF world axes (x right, y up, z toward the
 * viewer of a front view). `u`/`v` pick the image axes, `d` picks depth — larger
 * is nearer the camera, because the z-buffer keeps the maximum.
 *
 * glb-prep faces a prop's FRONT at −Z ("a chair's backrest must end up at +Z"),
 * so the front camera sits on −Z and looks toward +Z, which makes −z the depth.
 */
const VIEWS = {
  front: { u: (x) => x[0], v: (x) => x[1], d: (x) => -x[2], symmetricV: false },
  side: { u: (x) => -x[2], v: (x) => x[1], d: (x) => -x[0], symmetricV: false },
  top: { u: (x) => x[0], v: (x) => -x[2], d: (x) => x[1], symmetricV: true },
}

/** Sun direction per view, in the same world axes. Tilted off-axis so flat faces shade. */
const LIGHTS = {
  front: norm3(-0.35, 0.55, -0.76),
  side: norm3(0.76, 0.55, 0.35),
  top: norm3(0.32, 1, -0.42),
}

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1
  return [x / l, y / l, z / l]
}

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
    out = null // an untouched baseColorFactor is a fine fallback for one bad texture
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
 * World-space triangles projected into the chosen view, in cm.
 *
 * @gltf-transform and draco live in tools/glb-prep/node_modules — asset-prep
 * deps, not app deps — and are required HERE rather than at module scope so that
 * `npm run thumbs` keeps working on a checkout where glb-prep was never
 * installed, as long as no mapping row asks for a render.
 */
async function readTriangles(glbPath, view) {
  const req = createRequire(new URL('./glb-prep/package.json', import.meta.url))
  const { NodeIO } = req('@gltf-transform/core')
  const { KHRDracoMeshCompression } = req('@gltf-transform/extensions')
  const draco3d = req('draco3dgltf')
  const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })
  const doc = await io.read(glbPath)

  const texCache = new Map()
  const tris = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    // glb-prep only ever applies uniform scale, yaw and translation, so the
    // linear part rotates normals correctly once renormalised per pixel.
    const world = (x, y, z) => [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]
    const dir = (x, y, z) => [
      m[0] * x + m[4] * y + m[8] * z,
      m[1] * x + m[5] * y + m[9] * z,
      m[2] * x + m[6] * y + m[10] * z,
    ]

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
        const w = world(p[0], p[1], p[2]).map((c) => c * 100) // metres → cm
        const v = { u: view.u(w), v: view.v(w), d: view.d(w), nx: 0, ny: 1, nz: 0, tu: 0, tv: 0 }
        if (nor) {
          nor.getElement(vi, n)
          const wn = dir(n[0], n[1], n[2])
          v.nx = wn[0]
          v.ny = wn[1]
          v.nz = wn[2]
        }
        if (uvA) {
          uvA.getElement(vi, t)
          v.tu = t[0]
          v.tv = t[1]
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
 * The window the image covers, in cm.
 *
 * Horizontally it is symmetric about the origin, because glb-prep centres a prop
 * on X/Z and that origin is what the app positions and rotates around. Vertically
 * an elevation is NOT symmetric: glb-prep drops the base to y=0, so framing about
 * the origin would spend half the image below the floor. A top view is symmetric
 * on both axes, which is what `symmetricV` says.
 */
function frame(tris, view) {
  let hu = 0
  let v0 = Infinity
  let v1 = -Infinity
  for (const t of tris) {
    for (const p of [t.a, t.b, t.c]) {
      if (Math.abs(p.u) > hu) hu = Math.abs(p.u)
      if (p.v < v0) v0 = p.v
      if (p.v > v1) v1 = p.v
    }
  }
  if (view.symmetricV) {
    const hv = Math.max(Math.abs(v0), Math.abs(v1))
    v0 = -hv
    v1 = hv
  }
  const padU = hu * PAD
  const padV = (v1 - v0) * PAD
  return { u0: -hu - padU, u1: hu + padU, v0: v0 - padV, v1: v1 + padV }
}

function render(tris, box, light) {
  const spanU = box.u1 - box.u0
  const spanV = box.v1 - box.v0
  const s = (SS * MAX_SIDE) / Math.max(spanU, spanV)
  const W = Math.max(1, Math.round(spanU * s))
  const H = Math.max(1, Math.round(spanV * s))
  const depth = new Float32Array(W * H).fill(-Infinity)
  const rgba = new Uint8ClampedArray(W * H * 4)
  const texel = [1, 1, 1, 1]

  // image row 0 is the TOP, and v grows upward, so the row index flips v
  const px = (p) => (p.u - box.u0) * s - 0.5
  const py = (p) => (box.v1 - p.v) * s - 0.5

  for (const t of tris) {
    const ax = px(t.a)
    const ay = py(t.a)
    const bx = px(t.b)
    const by = py(t.b)
    const cx = px(t.c)
    const cy = py(t.c)

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
            la * t.a.tu + lb * t.b.tu + lc * t.c.tu,
            la * t.a.tv + lb * t.b.tv + lc * t.c.tv,
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
        // two-sided, as topdown-prep is: a z-buffer keeps whichever face is
        // nearest, and on an open shell that face can be wound either way
        const lambert = Math.abs((vnx * light[0] + vny * light[1] + vnz * light[2]) / len)
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

/**
 * Render one view of a GLB. Returns a sharp instance at 1× (the supersampled
 * buffer is box-filtered down), on a fully transparent background, so the caller
 * decides the output size and format.
 */
export async function renderElevation(glbPath, viewName = 'front') {
  const view = VIEWS[viewName]
  if (!view) throw new Error(`unknown view ${viewName} (front|side|top)`)
  const tris = await readTriangles(glbPath, view)
  if (!tris.length) throw new Error(`no triangles in ${glbPath}`)
  const box = frame(tris, view)
  const { rgba, W, H } = render(tris, box, LIGHTS[viewName])
  return {
    image: sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length), {
      raw: { width: W, height: H, channels: 4 },
    }).resize(Math.max(1, Math.round(W / SS)), Math.max(1, Math.round(H / SS)), {
      fit: 'fill',
      kernel: 'lanczos3',
    }),
    cmW: +(box.u1 - box.u0).toFixed(2),
    cmH: +(box.v1 - box.v0).toFixed(2),
    tris: tris.length,
  }
}

// CLI — used to inspect a model before deciding how to catalogue it.
// `pathToFileURL`, not string concatenation: this repo lives under a Hebrew path,
// and import.meta.url percent-encodes it while argv[1] does not.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const viewName = args.includes('--view') ? args[args.indexOf('--view') + 1] : 'front'
  const [input, output] = args.filter((a) => !a.startsWith('--') && a !== viewName)
  if (!input || !output) {
    console.error('usage: node tools/model-elevation.mjs <in.glb> <out.png> [--view front|side|top]')
    process.exit(1)
  }
  const { image, cmW, cmH, tris } = await renderElevation(input, viewName)
  await writeFile(output, await image.png().toBuffer())
  console.log(`${viewName}: ${cmW}×${cmH} cm, ${tris} tris -> ${output}`)
}
