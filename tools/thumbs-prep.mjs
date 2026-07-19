/**
 * Library thumbnail prep: converts the catalog's source product shots
 * (HANAN-APP-DOCS/GPT) into square 512×512 webp thumbnails under public/thumbs/.
 * Idempotent — run `npm run thumbs` after adding or changing a mapping row.
 * Optional argv[2] overrides the source directory.
 */
import { constants } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const SRC_DIR = process.argv[2] ?? 'A:\\פיתוח אתרים\\HANAN-APP-DOCS\\GPT'
const OUT_DIR = fileURLToPath(new URL('../public/thumbs/', import.meta.url))
const SIZE = 512

/** entry id → source PNG. Alternates that were considered stay as comments. */
const MAPPING = [
  { id: 'chair.x-white', src: 'ChatGPT Image Jul 15, 2026, 04_15_59 PM.png' },
  // "…04_18_36 PM.png" is a REAR view of the same oak chair — do not use
  { id: 'chair.x-wood', src: 'ChatGPT Image Jul 15, 2026, 04_19_43 PM.png' },
  { id: 'chair.gold-white', src: 'ChatGPT Image Jul 15, 2026, 04_26_09 PM.png' },
  { id: 'chair.gold-black', src: 'ChatGPT Image Jul 15, 2026, 04_27_26 PM.png' },
  { id: 'chair.brown', src: 'ChatGPT Image Jul 15, 2026, 04_22_19 PM.png' },
  { id: 'chair.black', src: 'ChatGPT Image Jul 15, 2026, 04_21_37 PM.png' },
  // draped (tablecloth) versions match the cloth-baked table GLBs.
  // bare alt: "ChatGPT Image Jul 15, 2026, 05_43_20 PM.png"
  { id: 'table.round', src: 'hf_20260716_114455_f8458859-55ce-41e3-bbdf-715d4735e95a.png' },
  // bare alt: "ChatGPT Image Jul 15, 2026, 05_53_27 PM.png"
  { id: 'table.round-large', src: 'hf_20260716_114402_534b553e-f2a0-4c76-a4f1-d860c6170183.png' },
  // bare alt: "c42e06ff-321d-4c5a-9323-ac414c9df384.png".
  // NOTE: "hf_…114502_bb05c43d…" is the SERPENTINE table — easy to confuse, wrong.
  { id: 'table.square', src: 'hf_20260716_114511_6d5a069c-3b5f-4383-bc51-e2e6f65f621d.png' },
  // bare alt: "ChatGPT Image Jul 15, 2026, 05_00_21 PM.png"
  { id: 'table.banquet', src: 'hf_20260716_113730_42d2df90-a847-41b5-b76f-8f6de67211a5.png' },
  // the double-counter station WITH its display wall (user-confirmed).
  // NOT "…05_36_28 PM.png" — that green-marble bar is the HALL's built-in bar.
  { id: 'bar.straight', src: 'hf_20260716_135125_47b47fe3-7f8f-4c59-9400-3df6bda50128.png' },
  { id: 'dj.booth', src: 'ChatGPT Image Jul 15, 2026, 06_13_32 PM.png' },
  // table decor — product shots from עיצובי בסיס ריזורט, matched by rendering
  // every GLB next to every candidate photo (2026-07-19; several models are a
  // different item than their filename suggests). Two photos are NOT mapped:
  // the pendant lamp (…125631_0fe6cb28 — hanging, not in the catalog) and
  // ComfyUI-upscaled_00001_ (a duplicate place-setting shot).
  { id: 'decor.goblet-crystal', src: 'עיצובי בסיס ריזורט/hf_20260716_122823_c73fc112-5ff5-42ee-b536-4966ccb6e758.png' },
  { id: 'decor.vases-decorative', src: 'עיצובי בסיס ריזורט/hf_20260716_124840_a3254af3-82ee-4bb8-9df6-3359f6f7182a.png' },
  { id: 'decor.vase-striped', src: 'עיצובי בסיס ריזורט/hf_20260716_125432_a8a9dc28-5463-4d9a-b9fd-8327b1ca57af.png' },
  { id: 'decor.vase-pampas', src: 'עיצובי בסיס ריזורט/hf_20260716_122932_4d9d8cb9-a303-41b5-8180-70e8e4180fcc.png' },
  { id: 'decor.topiary-green', src: 'עיצובי בסיס ריזורט/hf_20260716_123015_ec8130d9-4464-4970-acfb-9d12296cbb70.png' },
  { id: 'decor.vase-flowers-a', src: 'עיצובי בסיס ריזורט/hf_20260716_124718_b324f447-fe27-437e-a062-bec0a1a9f7a9.png' },
  { id: 'decor.candelabra-crystal', src: 'עיצובי בסיס ריזורט/hf_20260716_123109_fa8e033d-c3fb-486c-b11e-02390b11e80e.png' },
  { id: 'decor.candleholder-crystal-a', src: 'עיצובי בסיס ריזורט/hf_20260716_123132_cf3d4bbc-dce5-46fd-b3c6-938fca0e88e2.png' },
  { id: 'decor.fabric-folded', src: 'עיצובי בסיס ריזורט/hf_20260716_124107_36b88365-2079-4ab0-96f2-caa848e950c8.png' },
  { id: 'decor.candlestick-gold', src: 'עיצובי בסיס ריזורט/hf_20260716_123521_23aa46f0-dfb4-4227-ba82-9a066fa73782.png' },
  { id: 'decor.candelabrum-golden', src: 'עיצובי בסיס ריזורט/hf_20260716_123631_31e6d27a-f639-49f9-abf2-cecd0a367f2a.png' },
  { id: 'decor.bouquet-roses', src: 'עיצובי בסיס ריזורט/hf_20260716_123745_0c336fc0-25d1-49c0-afff-7acc62ffcc19.png' },
  { id: 'decor.candlestick-wood', src: 'עיצובי בסיס ריזורט/hf_20260716_123824_5240d190-3bf4-4eea-8b59-5a2a8c06703f.png' },
  { id: 'decor.place-setting', src: 'עיצובי בסיס ריזורט/hf_20260716_123951_f84f3de5-a3bd-4e04-af84-fc779d79c219.png' },
  { id: 'decor.napkin-folded', src: 'עיצובי בסיס ריזורט/hf_20260716_123325_37b71ca4-a482-4d35-a334-c68a2a0aeb60.png' },
  { id: 'decor.candleholders-wood', src: 'עיצובי בסיס ריזורט/hf_20260716_124137_3bf1b1c5-be65-483d-bbf8-07d5515d3786.png' },
  { id: 'decor.candlestick-brass', src: 'עיצובי בסיס ריזורט/hf_20260716_124244_adac55a0-1675-4823-8dba-8693b66afd02.png' },
  { id: 'decor.candelabrum-gold', src: 'עיצובי בסיס ריזורט/hf_20260716_124621_ac0a61ea-0466-4e23-b1ee-8ad0e94e525a.png' },
  { id: 'decor.candleholder-crystal-b', src: 'עיצובי בסיס ריזורט/hf_20260716_122956_ceb837d9-bea5-4bca-97de-49bbf2fcc2b6.png' },
  { id: 'decor.tulips-pink', src: 'עיצובי בסיס ריזורט/hf_20260716_124819_1b8f9d5b-337b-4698-9ad3-8fd8f5919ccb.png' },
  { id: 'decor.vases-white-ceramic', src: 'עיצובי בסיס ריזורט/hf_20260716_123043_5b99719c-e970-4fea-8a6a-c764e073f3ed.png' },
  { id: 'decor.vase-flowers-b', src: 'עיצובי בסיס ריזורט/hf_20260716_125050_25ba58ab-3d65-40a2-8579-6c96e856837f.png' },
  { id: 'decor.vases-rose-gold', src: 'עיצובי בסיס ריזורט/hf_20260716_125113_f7eecbe5-3d92-414a-950d-6b97c08a5ca0.png' },
  { id: 'decor.candleholders-glass', src: 'עיצובי בסיס ריזורט/hf_20260716_125157_ac621ef5-3d44-4554-abb8-7ebd926ad26b.png' },
  { id: 'decor.vase-ceramic', src: 'עיצובי בסיס ריזורט/hf_20260716_122858_882530a0-ba2c-4a22-acde-d2666810c62f.png' },
  { id: 'decor.vases-gold-striped', src: 'עיצובי בסיס ריזורט/hf_20260716_125507_e70d4a39-bdff-4edd-9f08-2b42c0dde0eb.png' },
  { id: 'decor.napkin-white', src: 'עיצובי בסיס ריזורט/hf_20260716_131110_596d4696-c6a0-443f-a3ed-af247b835d59.png' },
]

const outName = (id) => `${id.replaceAll('.', '-')}.webp`

const missing = []
for (const { src } of MAPPING) {
  try {
    await access(path.join(SRC_DIR, src), constants.R_OK)
  } catch {
    missing.push(src)
  }
}

if (missing.length) {
  console.error(`missing ${missing.length} source file(s) in ${SRC_DIR}:`)
  for (const m of missing) console.error(`  - ${m}`)
  process.exitCode = 1
} else {
  await mkdir(OUT_DIR, { recursive: true })
  for (const { id, src } of MAPPING) {
    const out = path.join(OUT_DIR, outName(id))
    // .rotate() honors EXIF orientation; sharp re-encoding also drops metadata
    await sharp(path.join(SRC_DIR, src))
      .rotate()
      .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 80 })
      .toFile(out)
    const kb = Math.round((await stat(out)).size / 1024)
    console.log(`${id.padEnd(18)} <- ${src}  ->  ${outName(id)} (${kb} KB)`)
  }
  console.log(`\n${MAPPING.length} thumbnails written to ${OUT_DIR}`)
}
