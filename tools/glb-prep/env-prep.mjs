/**
 * Environment/backdrop prep: turns the resort's golden-hour desert photo into
 * public/env/backdrop.webp — the 3D viewer's sky. It is BOTH the visible
 * background and (via scene.environment) the image-based fill that finally lets
 * the venue GLB's metalness-0.5 materials reflect something other than black.
 *
 * Lives here (not tools/) because sharp is installed under glb-prep/node_modules.
 * Run: node tools/glb-prep/env-prep.mjs
 *
 * WHY the mirror-wrap: the source is an ordinary 3:2 photo, not a 2:1
 * equirectangular panorama. Mapped straight onto the sphere it would smear one
 * ~60° view across all 360° and leave a hard seam where its left edge meets its
 * right. Instead we lay the photo and its mirror side by side: the join is a
 * reflection (continuous) and so is the u=0/1 wrap, so the horizon closes on
 * itself with no seam, and each copy spans 180° instead of 360° — half the
 * stretch. Sky/ground are extended by edge-stretch so the horizon still lands
 * near the equator, where the venue's open sides actually look out.
 */
import { mkdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SRC =
  process.argv[2] ??
  'D:\\משה פרוייקטים\\פיתוח אתרים\\GAMOS-DOCS\\תמונות גאמוס\\תמונות לחידוש באתר\\ריזורט\\1.jpg'
const OUT_DIR = fileURLToPath(new URL('../../public/env/', import.meta.url))
const OUT = `${OUT_DIR}backdrop.webp`

/** equirect canvas: 2:1 is what THREE's EquirectangularReflectionMapping expects */
const W = 2048
const H = 1024
/** the photo's horizon sits ~42% down; put it just above the equator */
const HORIZON_V = 0.46

const half = W / 2

// Each 180° half gets the photo, letterboxed so its horizon lands on HORIZON_V.
// Scaled to full height would crop badly, so we fit to width and pad by
// stretching the top/bottom rows — sky and dirt are near-flat there anyway.
const src = sharp(SRC)
const meta = await src.metadata()
const photoH = Math.round((half * meta.height) / meta.width)
const photoHorizon = 0.42 // where the horizon sits inside the source frame
const top = Math.round(H * HORIZON_V - photoH * photoHorizon)

const photo = await sharp(SRC).resize(half, photoH, { fit: 'fill' }).toBuffer()

// Edge-stretch bands: 1px slices of the photo's top/bottom rows blown up to fill
// the zenith/nadir. Blurred, else the row's horizontal variation reads as streaks.
const skyH = Math.max(top, 0)
const groundH = Math.max(H - top - photoH, 0)
const stretch = async (row, h) =>
  h === 0
    ? null
    : sharp(photo)
        .extract({ left: 0, top: row, width: half, height: 1 })
        .resize(half, h, { fit: 'fill' })
        .blur(24)
        .toBuffer()

const sky = await stretch(0, skyH)
const ground = await stretch(photoH - 1, groundH)

const bands = [
  ...(sky ? [{ input: sky, left: 0, top: 0 }] : []),
  { input: photo, left: 0, top: Math.max(top, 0) },
  ...(ground ? [{ input: ground, left: 0, top: top + photoH }] : []),
]

const leftHalf = await sharp({
  create: { width: half, height: H, channels: 3, background: '#000000' },
})
  .composite(bands)
  .png()
  .toBuffer()

const rightHalf = await sharp(leftHalf).flop().toBuffer()

await mkdir(OUT_DIR, { recursive: true })
await sharp({ create: { width: W, height: H, channels: 3, background: '#000000' } })
  .composite([
    { input: leftHalf, left: 0, top: 0 },
    { input: rightHalf, left: half, top: 0 },
  ])
  .webp({ quality: 82 })
  .toFile(OUT)

const { size } = await stat(OUT)
console.log(`backdrop.webp  ${W}×${H}  ${(size / 1024).toFixed(0)} KB`)
