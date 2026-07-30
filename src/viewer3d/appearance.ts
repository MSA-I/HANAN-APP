/**
 * Which GLB part wears which catalog slot's override.
 *
 * Everything the renderer needs to decide that, with NO `three` import — which is
 * what makes it testable: vitest runs `environment: 'node'` over `src/**\/*.test.ts`
 * (BRIEF §1), so a module that touched `THREE.Material` could not be covered at
 * all. `ObjectGroup.ModelParts` is left holding only the part that genuinely needs
 * three: cloning a material and writing `color`/`map` onto the clone.
 *
 * The mapping is by MATERIAL NAME PREFIX, the same shape `isGlassPart` already
 * uses. A Tripo export names every part `Material_tripo_part_<n>`, which carries no
 * semantics at all; a prep step renames the ones a slot owns
 * (`tools/glb-prep/mark-fabric.mjs` → `fabric-00…16` / `frame-00…07`), and a rename
 * survives a re-prep of the same source where an index list would not.
 */
import { editableSlotsOf, slotTextureId, type CatalogEntry } from '../core/catalog/types'
import type { AppearanceOverrides } from '../core/model/types'

export interface SlotAppearance {
  /** GLB material-name prefix this slot owns; undefined = every part */
  match?: string
  /** an EXPLICIT user tint, or undefined — never the slot's catalogue default */
  color?: string
  /** the texture in force: user pick → slot default → null */
  textureId: string | null
}

/**
 * The override each editable slot is asking for, in catalogue order.
 *
 * ⚠ `color` is the user's override ONLY, deliberately left undefined when there is
 * none. `slotColor()` would answer with the slot's `defaultColor` instead, and that
 * number is the model's own measured MEAN colour — writing it onto a cloned
 * material would multiply the baked texture by itself and darken a table nobody had
 * touched. The 2D footprint is what `defaultColor` is for.
 *
 * `textureId` goes through `slotTextureId`, which is where the three states of
 * `AppearanceOverrides` collapse: pick beats default, an explicit `null` beats
 * default, absent falls through to it.
 */
export function slotAppearances(
  entry: CatalogEntry,
  appearance: AppearanceOverrides,
): SlotAppearance[] {
  return editableSlotsOf(entry).map((slot) => ({
    match: slot.match,
    color: appearance[slot.slot]?.color,
    textureId: slotTextureId(entry, appearance, slot.slot),
  }))
}

/**
 * Which override owns a GLB part, or undefined — and undefined means the part
 * KEEPS ITS OWN BAKED MATERIAL, untouched. That is the divider's black frame while
 * its curtain is recoloured.
 *
 * First match wins, so a `match`-less slot listed first would swallow the rest;
 * entries are written narrowest-first. A slot with no `match` owns every part
 * including one whose material is unnamed (`''`), which is what all nine
 * pre-existing entries meant when they were a single `editableColorSlot` and still
 * mean now: their GLBs carry Tripo's own names and nothing renames them.
 */
export function overrideForPart(
  materialName: string,
  slots: readonly SlotAppearance[],
): SlotAppearance | undefined {
  return slots.find((s) => s.match === undefined || materialName.startsWith(s.match))
}
