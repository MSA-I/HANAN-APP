/**
 * Library thumbnail prep: converts the catalog's source product shots
 * (HANAN-APP-DOCS/GPT) into square 512×512 webp thumbnails under public/thumbs/.
 * Idempotent — run `npm run thumbs` after adding or changing a mapping row.
 * Optional argv[2] overrides the source directory; `--only <substring>` limits
 * the run to the matching ids.
 *
 * A row is EITHER `{ id, src }` — a product photo, which is all of them but one —
 * or `{ id, glb, view }`, which renders the prepped model itself through
 * tools/model-elevation.mjs. The second form exists because one catalog item
 * arrived as a model with no photo and none coming; see the `figure.woman` row.
 *
 * The shot is FITTED inside the square (`contain`), not centre-cropped: a cover
 * crop of a portrait product shot cut the top off tall items — chandeliers lost
 * their canopy, a chuppah lost its canopy corner. The letterbox is left fully
 * transparent so the library card's own background shows through and the CSS,
 * not this file, decides what a thumbnail sits on.
 *
 * ⚠ Some MAPPING notes below argue for a shot because it survived the SQUARE
 * CENTRE-CROP ("near-square", "centres the shade"). Those reasons predate the
 * switch to `contain` and no longer apply; the choices themselves still stand —
 * they are kept as the record of which alternates were rejected and why.
 */
import { constants } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { renderElevation } from './model-elevation.mjs'

const DEFAULT_SRC_DIR = fileURLToPath(new URL('../../HANAN-APP-DOCS/GPT/', import.meta.url))
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const SRC_DIR = args.find((a) => !a.startsWith('--') && a !== only) ?? DEFAULT_SRC_DIR
const OUT_DIR = fileURLToPath(new URL('../public/thumbs/', import.meta.url))
const PROPS_DIR = fileURLToPath(new URL('../public/props/', import.meta.url))
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
  // the bridal seat is a curved two-seater SETTEE, not a chair, which is why this
  // shot sat unmapped among the chandeliers: matched to כסא כלה.glb by rendering
  // the model (Plans/handoff/01-bridal-chair-front.png) against it — same seven
  // channel-tufted back cushions inset from the ends, same kidney-shaped seat with
  // its double welt, same splayed tapered metal legs
  { id: 'chair.bridal', src: 'ChatGPT Image Jul 15, 2026, 06_33_50 PM.png' },
  // The user's own product shot, already sitting in this folder under the same
  // naming convention as מחיצה.png and בופה ריזורט.png. A clear "ghost" chair:
  // oval medallion back, dished seat, four square tapering legs.
  { id: 'chair.chuppah-guest', src: 'כסא אורחים חופה.png' },
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
  // the shot the table.square note above warns about: it is the SERPENTINE, and
  // here it belongs. Square already, so the centre-crop takes the whole frame.
  { id: 'table.serpentine', src: 'שולחן נחש.png' },
  // the DOUBLE (two butted banquets) knights table with its cloth — matches table-knights-480.glb
  { id: 'table.knights-480', src: 'שולחן אבירים.png' },
  // `bar.straight` is GONE — retired 2026-07-28 (BLOCKED-1B, answered). Its row
  // was briefly restored onto בר2.png when that question was still open; it is
  // deleted rather than commented out this time, because the entry it named no
  // longer exists and a row for a dead id is not a decision anyone can revisit.
  // The two halves below are the same bar it used to be, which is why they take
  // the photo it was pointed at.
  // NOT "…05_36_28 PM.png" — that green-marble bar is the HALL's built-in bar.
  //
  // One product, two hands: both halves take the same shot. Nothing in this script
  // mirrors an image, and a mirrored photo of a bar is not more truthful than the
  // photo itself.
  { id: 'bar.resort-left', src: 'בר2.png' },
  { id: 'bar.resort-right', src: 'בר2.png' },
  // the ANKO shelving unit that stands behind the counters
  { id: 'bar.back-wall', src: 'קיר מאחורי הבר.png' },
  // §36 of the corrections document: the user replaced the DJ reference. DJ2.png of
  // the four DJ*.png at the GPT root is the one they named. Only the SOURCE moves —
  // the output is still dj-booth.webp, so `djBooth.thumbnail` in entries/bars.ts
  // needs no edit. (Named, not numbered: that pointer said ":70" and the field has
  // since moved twice.)
  { id: 'dj.booth', src: 'DJ2.png' },
  { id: 'plant.potted', src: 'צמחייה 1.png' },
  { id: 'plant.potted-2', src: 'צמחייה 2.png' },
  // table decor — product shots from עיצובי בסיס ריזורט, matched by rendering
  // every GLB next to every candidate photo (2026-07-19; several models are a
  // different item than their filename suggests). One photo is NOT mapped:
  // ComfyUI-upscaled_00001_ (a duplicate place-setting shot).
  // …125631_0fe6cb28 was also skipped here; it is mapped under lighting, below.
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
  // lighting — each verified by rendering the GLB against the candidate photos
  // (2026-07-20), because two of the three filenames are wrong.
  // This photo was previously skipped as "the pendant lamp, hanging". It is
  // neither: it is decor-chandelier-crystal.glb, and that model is neither a
  // chandelier nor hanging — same arched brass stand, weighted disc base and
  // crystal-basket shade. A floor object (entries/decor.ts).
  { id: 'lamp.arc-crystal', src: 'עיצובי בסיס ריזורט/hf_20260716_125631_0fe6cb28-d852-42f0-86c7-8ec9ef904edf.png' },
  // same lamp with its ceiling canopy in frame: "hf_20260716_141517_cfe913d7…",
  // but its cord is so long that the square centre-crop cuts the shade in half —
  // this shot centres the shade
  { id: 'lamp.pendant', src: 'hf_20260716_140916_5a8d6bcf-3f19-4ae7-8744-aa5e7dacc366.png' },
  // four staggered drums — matches the model's four cords exactly, which is why
  // "decor-pendant-geometric.glb" is 42.6 deep for an 18.1-wide lamp
  { id: 'lamp.pendant-cluster', src: 'hf_20260716_135210_c4d84f0e-04d6-4dc0-a1ab-3dd31273756f.png' },
  // chandeliers: the source folder holds 7 GLBs but only THREE products, and the
  // photos say so too — each product below was shot 2–3 times, and Tripo was run
  // on every shot. Alternates are listed so nobody re-adds them as new items.
  // diamond alts: "…02_05_32 PM.png" and "c81d8b72-47c9-4531…" are both tall
  // crops whose square centre-cut slices the fixture — this shot is near-square
  { id: 'lamp.chandelier-diamond', src: 'ChatGPT Image Jul 15, 2026, 06_37_54 PM.png' },
  // basket alt: "…06_34_57 PM.png" — same fixture, longer cord in frame
  { id: 'lamp.chandelier-basket', src: 'ChatGPT Image Jul 15, 2026, 06_34_18 PM.png' },
  // candelabra alt: "…02_12_05 PM.png" — same fixture, slightly narrower framing
  { id: 'lamp.chandelier-candelabra', src: 'ChatGPT Image Jul 16, 2026, 02_11_58 PM.png' },
  // chuppot — 9 shots, 9 GLBs, but NOT the same nine: each pairing below was made
  // by rendering the model and matching it to a shot (the filenames mislead), and
  // two items are left over on purpose. Unmapped shot: "…06_11_07 PM.png", a peach
  // four-post chuppah with dried florals that no model reproduces. Unmapped model:
  // classical+gazebo (a masonry rotunda) — no shot, so no thumbnail and no entry.
  { id: 'chuppah.draped-white', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_07_04 PM.png' },
  // the knotted top corner is what tells this apart from "…06_11_07 PM.png"
  { id: 'chuppah.draped-blush', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_14_15 PM.png' },
  { id: 'chuppah.ruched-ivory', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_18_33 PM.png' },
  // the shot that proves "clear+acrylic+podium+3d+model.glb" is a chuppah
  { id: 'chuppah.acrylic', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_17_47 PM.png' },
  // ditto for "metal+table+frame+3d+model.glb" — same chrome frame, no top surface
  { id: 'chuppah.frame-chrome', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_21_57 PM.png' },
  { id: 'chuppah.round-white', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_21_08 PM.png' },
  { id: 'chuppah.round-beige', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_09_40 PM.png' },
  // the lattice ARCH, not a canopy — see entries/chuppah.ts
  { id: 'chuppah.arch-lattice', src: 'חופות/ChatGPT Image Jul 15, 2026, 06_08_49 PM.png' },

  // ── round 2 additions ──────────────────────────────────────────────────────
  // Source paths are spelled out in full because the user asked for them to be on
  // record. Note two folder names the planning documents get wrong: the decor lives
  // under 'חופות/קישוטי חופה' (singular), and the ring-centre shots under
  // 'עיצוב בתוך שולחן עגול גדול' — not 'עיצובי שולחן עיגול גדול', which is the
  // name of the GLB folder and does not exist here.

  // chuppah decoration that stands on the floor beside the chuppah (§31/§35).
  // One shot, one GLB, nothing to disambiguate.
  { id: 'chuppah.decor-1', src: 'חופות/קישוטי חופה/hf_20260728_092620_03f5e9f4-0462-4924-a3fb-2ae53e8723b9.png' },

  // The ninth canopy (§10). Sheer white drapes under a round rim carried entirely by
  // a crown of ivory roses and hydrangeas — that crown is the only thing separating it
  // from chuppah.round-white, and it is plainly in this shot. Keyed by catalog id from
  // 02-catalog-contract.md, so it does NOT wait on the GLB slug: both this and
  // entries/chuppah.ts:138 derive the filename as id.replaceAll('.', '-').
  { id: 'chuppah.round-floral', src: 'חופות/hf_20260728_092436_f3651f63-3c38-4c3e-b6aa-cd68b9e8a9d6.png' },

  // עיצובי שולחן — FOUR shots, THREE models. Every pairing below was decided by
  // reading A1's renders of the GLBs (handoff/renders-02-a1/) against the shots,
  // not by filename:
  //  · candelabrum: two of the four shots are candelabra and only one is the model.
  //    The GLB has curved arms in two tiers off a central shaft, cone-shaped
  //    bobeches each sitting on a ball, and a stepped FACETED POLYGONAL foot —
  //    all four features are in …112931 and none of them in …113310.
  //  · glass rod lamp: …113042 is the only shot with rods on a SQUARE plate.
  //  · orchids: …113010 has the model's four brass rods on a ROUND brass disc.
  { id: 'design.candelabrum-crystal', src: 'עיצובי שולחן/hf_20260728_112931_47cfbdbd-e81d-4899-881f-6ad8f09e7957.png' },
  { id: 'design.lamp-glass-rod', src: 'עיצובי שולחן/hf_20260728_113042_5fc051fc-fe19-44d0-af78-69bac8da134c.png' },
  { id: 'design.orchid-sculpture', src: 'עיצובי שולחן/hf_20260728_113010_fd8e5a67-e942-442d-afcf-741574706aa8.png' },
  // ✅ NOW MAPPED. This shot was the unmapped one under gate 1 of PLAN-02 — the
  // glass candelabrum with tall hurricane chimneys over its candles on a round
  // glass foot. Its model existed all along; it was saved at 19:07 on 2026-07-28,
  // after that scan, as "crystal candelabrum 3d mode3l.glb" (sic), which is why it
  // did not read as a second copy of the crystal candelabrum's own file.
  // Confirmed by rendering the new GLB: chimneys, scrolled S-arms and a round glass
  // disc — the exact four features …112931 lacks. Still do NOT point this at
  // design.candelabrum-crystal; that is the other candelabrum.
  { id: 'design.candelabrum-hurricane', src: 'עיצובי שולחן/hf_20260728_113310_8a388231-066b-4561-959b-d9d550f14e9f.png' },

  // עיצוב בתוך שולחן עגול גדול — 2 shots, 2 models, and the pair is decided by
  // whether the urn is in frame: …113541 is the bare draped table, …113245 has the
  // white rose urn standing on it, which is what A1's ring-center-floral render shows.
  // The render shows a table under the urn, but the PREPPED GLB has none: the source
  // model included one and A1 cut the urn free before prepping (15,657 of 45,921
  // triangles kept). Confirmed independently here — the prepped file measures
  // 73×65 cm, and its top-down plan image is flowers on transparency. So ring.floral
  // genuinely needs `requiresHost: 'ring.table'` to have something to stand on.
  { id: 'ring.table', src: 'עיצוב בתוך שולחן עגול גדול/hf_20260728_113541_6c49c128-48a9-47b0-9bd4-aa51cb15f4fd.png' },
  { id: 'ring.floral', src: 'עיצוב בתוך שולחן עגול גדול/hf_20260728_113245_69655076-0d9a-4eae-a8a2-8d342e730361.png' },

  // ── round 3 additions ──────────────────────────────────────────────────────
  // THE ONE ROW THAT IS NOT A PHOTO, and the decision is recorded here rather
  // than in the entry because this file is where the alternative lived.
  //
  // The human figure (source doc §17) arrived as `דמות אישה.glb` and nothing
  // else: the user wrote "no image is needed", meaning they were not going to
  // supply a product shot, and a search of HANAN-APP-DOCS on 2026-07-29 found no
  // photograph of a figure anywhere. The library still needs a tile, so the two
  // real options were (a) point this row at some existing photo of something
  // else, or (b) render the model. (a) is a lie in the shape of a mapping row —
  // every other line in this table is a promise that the picture IS the item —
  // so it is (b): model-elevation.mjs renders the prepped GLB from the front,
  // which is the view that makes a person recognisable at 64 px. The top-down
  // render the 2D plan uses (public/plan/) is the same model from above, where a
  // person is a disc of hair, so it could not double as the tile.
  { id: 'figure.woman', glb: 'figure-woman.glb', view: 'front' },

  // ── round 4 additions ──────────────────────────────────────────────────────
  // The last two entries that had no picture at all. They were open from round 1
  // (Plans/R1/handoff/BLOCKED-01-A1.md) purely for want of a source; the user
  // supplied both a model and a shot for each, so these are ordinary photo rows.
  //
  // ⚠ `בופה אולם.png` IS A DIFFERENT PRODUCT — the HALL's built-in buffet — and
  // must NOT be mapped here or anywhere. This project is resort-only, and the two
  // filenames differ by one word. Same trap as the green-marble bar shot flagged
  // at the `bar.resort-left` row above.
  { id: 'buffet.table', src: 'בופה ריזורט.png' },
  { id: 'divider.screen', src: 'מחיצה.png' },
]

const outName = (id) => `${id.replaceAll('.', '-')}.webp`
/** Where a row's input lives, whichever of the two kinds it is. */
const sourceOf = (row) => (row.glb ? path.join(PROPS_DIR, row.glb) : path.join(SRC_DIR, row.src))

const rows = MAPPING.filter((r) => !only || r.id.includes(only))
if (only && !rows.length) {
  console.error(`--only ${only} matched no mapping row`)
  process.exit(1)
}

const missing = []
for (const row of rows) {
  try {
    await access(sourceOf(row), constants.R_OK)
  } catch {
    missing.push(row.glb ?? row.src)
  }
}

if (missing.length) {
  console.error(`missing ${missing.length} source file(s):`)
  for (const m of missing) console.error(`  - ${m}`)
  process.exitCode = 1
} else {
  await mkdir(OUT_DIR, { recursive: true })
  for (const row of rows) {
    const out = path.join(OUT_DIR, outName(row.id))
    // Both kinds converge on the same square: fitted, never cropped, on a fully
    // transparent letterbox so the library card's own background shows through.
    // .rotate() honors EXIF orientation; sharp re-encoding also drops metadata.
    const image = row.glb
      ? (await renderElevation(sourceOf(row), row.view)).image
      : sharp(sourceOf(row)).rotate()
    await image
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 80 })
      .toFile(out)
    const kb = Math.round((await stat(out)).size / 1024)
    console.log(`${row.id.padEnd(18)} <- ${row.glb ?? row.src}  ->  ${outName(row.id)} (${kb} KB)`)
  }
  console.log(`\n${rows.length} thumbnails written to ${OUT_DIR}`)
}
