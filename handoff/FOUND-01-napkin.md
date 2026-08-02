# FOUND-01-napkin — which primitive is the napkin, in each of the five covers

**R5 · EXEC-7 · PLAN-01 §3.7 · 2026-08-02**

§3.7 forbids writing `match:'napkin'` from a bbox table, and it is right to: in
`diagonal` the two broad flat parts are 26.1 × 18.7 × 4.2 and 24.8 × 26.7 × 2.4, and
geometry alone cannot say which is linen and which is china. So each file was read
three independent ways, and nothing was wired until all three agreed.

## The measurement that overturned the plan

§3.7 plans `split-napkin.mjs`, a generalisation of `split-candles.mjs`, on the
premise that "המפית אפויה בערכה, ה-GLB הוא חומר Tripo אחד לכל חלק, ואין slot לצבוע".
**That premise is false for four of the five files.** Tripo already segmented the
napkin into its own primitive with its own material and its own baked texture, so
there is nothing to cut. The tool that shipped is `tools/glb-prep/mark-napkin.mjs`,
a RENAMER in the family of `mark-glass.mjs` and `mark-fabric.mjs`.

The fifth file, `horizontal`, is the one where §3.7's premise does hold — and it is
the one that is refused.

## The five rows

| file | the napkin | signal 1 — geometry | signal 2 — baked texel | signal 3 — render |
|---|---|---|---|---|
| `diagonal` | `Material_tripo_part_2` → `napkin-00` (27,014 tris) | 95% of its plan area over the charger, top **+0.98 cm** above it; every other part scores overlap 0.00 | rgb(198,194,195) against the charger's rgb(156,147,137) — **Δ 0.331**, and the white §3.7 predicts | `marker-proof-diagonal.png` — magenta is the band across the plate, and only it |
| `vertical` | `Material_tripo_part_3` → `napkin-00` (16,313 tris) | 96% over the charger, **+0.81 cm**; 8.8 × 25.8 cm, the lengthways strip the fold's name promises | rgb(185,181,178) vs rgb(158,144,130) — **Δ 0.261**, white | `marker-proof-vertical.png` — magenta is the strip down the plate |
| `folded` | `Material_tripo_part_3` → `napkin-00` (21,942 tris) | 100% over the charger, **+1.83 cm** | rgb(121,125,108) vs rgb(160,154,145) — **Δ 0.241**, and **olive**, exactly the colour §3.7 predicts for this fold | `marker-proof-folded.png` — magenta is the square fold |
| `tied` | parts 2, 4, 6, 13, 14, 15, 16, 17, 19 → `napkin-00…08` (56,613 tris) | all nine 100% over the charger, **+0.32…+4.37 cm**; both glasses score overlap 0.00 and are excluded even though `mark-glass` never named them here | rgb(125,93,73) vs rgb(170,167,164) — **Δ 0.493**, and **copper**, exactly as §3.7 predicts. Per part, 0.412…0.800 | `marker-proof-tied.png` — magenta is the body, the knot AND the tie; the charger's rim stays grey |
| `horizontal` | **NONE — refused** | no part lies on the charger at all: Tripo welded the napkin INTO it, one primitive of 46,162 triangles (≈ the 22,240 + 27,014 the other files split) | its 90 connected components ARE bimodal — a white family at sat 0.012 against a woven one at 0.146 — but sixteen read 0.077…0.137 in between | — |

**Why `horizontal` was not forced.** A component cut is possible in principle and it
was measured before being rejected: the interleaving band is 16 components wide, and
a mis-cut leaves white speckles on the charger or beige speckles on the linen. §3.7
says not to write `match:'napkin'` on a reading that thin, and the task said four
working covers beat five where one repaints the plate. **The fix is to re-export that
cover with the napkin segmented, then re-run the tool — not a hand-written index.**

## The rule, and its margins

`mark-napkin.mjs --measure` prints all of this per part.

1. **The charger is the anchor** — the largest plan footprint, by 1.36× (diagonal) to
   5.31× (tied).
2. **A napkin lies on it** — plan footprint over the charger's (`OVERLAP_MIN 0.5`;
   measured 0.95…1.00 for napkin parts, **≤0.02 for all twenty-nine others**) and top
   above it (`LIFT_MIN 0.005` of height ≈ 0.09 cm; measured +0.32…+4.37 for napkin
   parts, ≤ −1.05 for anything else that clears the footprint test).
3. **Colour confirms, per part** — RGB distance from the charger ≥ 0.12; measured
   0.241…0.800, and the cutlery it must reject sits at 0.13.

The `LIFT_MIN` constant was lowered from 0.02 to 0.005 for a measured reason: at 0.02
the tied cover's smallest knot fragment (353 triangles, lift +0.32 cm) fell out, and
that fragment is copper linen at saturation 0.544. Eight parts became nine.

## Sizes, before → after

Marking DROPS each napkin's baked base-colour texture, so every file got smaller.

| file | before | after | |
|---|---|---|---|
| `decor-place-setting-diagonal.glb` | 1.303 MB | 1.268 MB | −2.7% |
| `decor-place-setting-vertical.glb` | 1.404 MB | 1.365 MB | −2.8% |
| `decor-place-setting-folded.glb` | 1.529 MB | 1.327 MB | −13.2% |
| `decor-place-setting-tied.glb` | 1.341 MB | 1.255 MB | −6.4% |
| `decor-place-setting-horizontal.glb` | 1.146 MB | *unchanged* | refused |

Triangle counts are unchanged in all five: 193,182 · 186,088 · 185,937 · 192,808 ·
187,248. Nothing was cut, so nothing could be lost.

## Why the base-colour map had to come off, measured

The renderer tints by writing `color` onto a clone, which MULTIPLIES the pick by the
bake. Keeping the map would have made the picker lie, and the folded cover proves it
in one number: its napkin bakes to rgb(121,125,108), so **picking pure white would
still have rendered olive**. With the map replaced by a measured `baseColorFactor`,
`#ffffff` on that cover renders rgb(206,203,200) — white.

`metallicRoughness` and `normal` are carried over. That is split-candles' hard-won
line (its :486-495), and it is why the folds still shade after the map is gone.

## What it cost, stated plainly

The before/after with NO override, same camera, same table, same four seats — the
"before" run served the pre-marking GLBs restored out of `bee33d9`:

| fold | whole-canvas mean \|Δ\| | max | channels differing by >16 |
|---|---|---|---|
| `horizontal` | **0.00** / 255 | 1 | 0.00% |
| `folded` | 0.23 | 32 | 0.02% |
| `diagonal` | 0.26 | 15 | 0.00% |
| `vertical` | 0.58 | 39 | 0.04% |
| `tied` | **1.62** | 85 | **4.08%** |

**This is not zero, and calling it negligible would be overstating it.** On `tied`
the copper napkin loses the baked weave GRAIN of its cloth — the folds survive,
because they are geometry plus the normal map, but the fabric texture in the base
colour is gone (`before-tied-0-plain.png` against `after-tied-0-plain.png`; the two
images differ only inside the napkin's silhouette). The charger, the cutlery, the
glasses and the cloth are pixel-identical everywhere. `horizontal` at 0.00 is the
control: that file was never touched.

The measured texel spread says why it is `tied` that moved most — its napkin's
base-colour texture has a standard deviation of 33–40 of 255 where the white folds
sit at 18–24. The flatter the linen, the less a mean costs.

## The feature, proved

Same cover, three picks, same camera. The sampled patch is 90 × 90 px at the frame
centre, which lands on the napkin.

| fold | untouched | `#ffffff` | `#c62828` | `#1a237e` |
|---|---|---|---|---|
| `diagonal` | rgb(145,135,126) sat 0.136 | rgb(156,147,138) sat 0.119 | rgb(145,89,84) **sat 0.422** | rgb(96,90,103) |
| `vertical` | rgb(151,141,131) sat 0.129 | rgb(182,175,168) sat 0.078 | rgb(156,45,47) **sat 0.714** | rgb(46,46,89) sat 0.490 |
| `folded` | rgb(99,99,80) sat 0.201 | rgb(206,203,200) sat 0.027 | rgb(170,10,27) **sat 0.941** | rgb(7,19,90) sat 0.917 |
| `tied` | rgb(103,80,67) sat 0.357 | rgb(177,170,164) sat 0.075 | rgb(146,45,55) **sat 0.692** | rgb(48,52,89) sat 0.460 |
| `horizontal` | rgb(166,156,147) | — | **rgb(166,156,147), unchanged** | — |

- **The tilt test passes.** `#c62828` reads at saturation 0.42…0.94 against an
  untouched 0.13…0.36. It is red, not the muddy brown a surviving base-colour map
  would have produced.
- **`#ffffff` really is white** — saturation falls to 0.027 on the olive fold.
- **Nothing else moves.** `after-diagonal-2-red.png` at full size: red napkin, woven
  beige charger, steel cutlery, transparent glass. The red seen THROUGH the wine
  glass is the transmissive material doing its job, not a leak.
- **`horizontal` refuses.** Its stored appearance stays `{}` and its pixels do not
  move — `setAppearance` rejects a slot the entry does not expose.

## The other three checks

- **Sentinel** (`ObjectGroup.tsx`'s nullable-override note). Painted a table of tied
  covers red, deleted one of the four, and the survivors are still red with their
  plates still white — `after-sentinel-2-after-delete.png`. Nothing blackened, so no
  instance disposed the shared cached material.
  ⚠ The script's own survivor COUNT printed 0 and is wrong: it filtered
  `objectOrder`, and an attached surface child does not appear there. The screenshot
  is the evidence, not the counter.
- **Texture, not just colour.** `fabric-06` applied to the `napkin` slot lands on the
  linen and nowhere else — `after-texture.png`, woven napkin on an untouched charger.
- **The control the user asked for.** `after-inspector.png`: a `מראה` section with a
  row labelled **מפית**, the palette, the free-picker swatch (`allowCustomColor`) and
  the `טקסטורה` row beside it.

## Two things seen and deliberately not touched

1. **The tied cover's wine glass renders as opaque brown**, visible in every `tied`
   shot. That is the pre-existing, documented state — `mark-glass.mjs` misses that
   model's wine glass by 0.3 cm and `entries/tableDecor.ts` records why. It is
   unchanged by this work: the before and after shots show the same glass.
2. **`tools/model-elevation.mjs` renders a marked file far too dark.** glTF defines
   `baseColorFactor` in LINEAR space and three.js reads it that way; the offline
   rasteriser multiplies in byte space with no encode. The file is right and the tool
   is not colour-managed — judge a marked cover in the app. The elevation is still
   exact for TELLING THE PARTS APART, which is all it is used for above.

## Where the pictures are

`D:\משה פרוייקטים\פיתוח אתרים\HANAN-APP-DOCS\צילומים\R5-napkin-colour\`

- `marker-proof-<fold>.png` — the marked parts painted magenta, top view, signal 3
- `before-<fold>-0-plain.png` / `after-<fold>-0-plain.png` — no override, same camera
- `after-<fold>-{1-white,2-red,3-blue}.png` — the feature
- `after-sentinel-*.png` · `after-texture.png` · `after-inspector.png`
