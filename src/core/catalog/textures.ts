/**
 * The fabric swatch palette: the 22 seamless textures under `public/textures/`,
 * generated through the Higgsfield MCP from the source swatch sheet and cut by
 * `tools/textures-prep.mjs` (provenance and the 22-row measurement table:
 * `Plans/R3/handoff/05-textures.md`).
 *
 * It lives in `core/catalog/` because a texture id is now CATALOGUE DATA — an
 * `EditableSlot.defaultTexture` names one, and a stored `appearance[slot].textureId`
 * is one. It used to live in `viewer3d/slotTextures.ts`, whose own header said the
 * move belonged here once a catalog owner wanted it. `/props/` and `/thumbs/`
 * paths are already written in `core/catalog/entries/`, so a `/textures/` path
 * here breaks no layering rule: the catalogue names public assets, three.js loads
 * them.
 *
 * The list is WRITTEN OUT rather than generated. A catalogue cannot glob a
 * directory at runtime, and a stored project's `textureId` has to keep meaning the
 * same file across releases — so the ids are the contract and
 * `catalog/textures.test.ts` checks each one against the disk.
 */

/**
 * `fabric-01` … `fabric-22`, in the sheet's own reading order. The numbering rule
 * is the swatch sheet's, not a rank: 06 is the cream damask trellis the six tables
 * wore before round 4 made the choice the user's, 13/14/19 are the three napkin
 * weaves that are still the catalogue defaults for them.
 */
export const FABRIC_TEXTURE_IDS: readonly string[] = Array.from(
  { length: 22 },
  (_, i) => `fabric-${String(i + 1).padStart(2, '0')}`,
)

/** Where the file for an id lives, under `public/`. */
export function textureUrl(id: string): string {
  return `/textures/${id}.webp`
}

/**
 * Is this one of the 22?
 *
 * ⚠ Load-bearing, not decorative. A stored id BECOMES A URL, so an unvalidated
 * one is a path the renderer would try to fetch — `setSlotTexture` checks against
 * this before writing, which is what keeps `'../../secret'` out of the scene file
 * and out of `<img src>` in the picker.
 */
export function isTextureId(id: string): boolean {
  return FABRIC_TEXTURE_IDS.includes(id)
}
