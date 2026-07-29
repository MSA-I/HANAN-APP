/**
 * bake-plugin — dev-only endpoint behind the "קיבוע האלמנטים" button in the
 * presets panel. It writes the current arrangement into
 * `src/core/venueFixtures.ts`, a normal source file that `createDefaultScene`
 * seeds every new project from (source doc §16).
 *
 * Why a source file and not IndexedDB: the point of the button is that the
 * arrangement outlives the button. Once the fixtures are decided the button can
 * be deleted and nothing else has to change — `venueFixtures.ts` stays in the
 * repo, `factory.ts` keeps seeding it, and `flags.frozen` keeps the roots
 * un-movable and un-deletable.
 *
 * SECURITY. This writes into the repo on request from a browser page, so it is
 * deliberately narrow:
 * - `apply: 'serve'` — never mounted by `vite build`/`preview`.
 * - The destination path is a module constant. Nothing in the request reaches it.
 * - The one client string that lands in the generated source (the venue id) is
 *   allowlisted to `[a-z0-9-]`; everything else is re-serialised through
 *   JSON.stringify of already-parsed JSON, which cannot emit code.
 * - The caller shows a confirm dialog first — see PresetsSection.tsx.
 *
 * .ts, like capture-plugin.ts, because vite.config.ts imports it.
 */
import { writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Fixed destination. Never derived from the request. */
const OUT_FILE = fileURLToPath(new URL('../src/core/venueFixtures.ts', import.meta.url))

const MAX_BODY = 8 * 1024 * 1024
const VENUE_ID = /^[a-z0-9-]{1,40}$/
const MAX_OBJECTS = 2000

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        fail(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', fail)
  })
}

type BakeRecord = Record<string, unknown>

const idOf = (object: BakeRecord): string | null =>
  typeof object.id === 'string' && object.id ? object.id : null

const parentOf = (object: BakeRecord): string | null =>
  typeof object.parentId === 'string' && object.parentId ? object.parentId : null

/**
 * Chairs by seat index, everything else after them — the same rule as
 * `childSortKey` (src/core/model/types.ts), restated rather than imported
 * because this file is loaded by vite.config.ts and stays outside the app's
 * module graph.
 *
 * TIES KEEP THE CALLER'S ORDER (Array#sort is stable). Sorting by id would be
 * the obvious tiebreak and is exactly wrong here: ids are nanoid, so two bakes
 * of the same arrangement would order the decor differently and the file this
 * function exists to keep byte-identical would churn on every press.
 */
function seatKey(object: BakeRecord): number {
  const attachment = object.attachment as { kind?: unknown; seatIndex?: unknown } | null | undefined
  return attachment && attachment.kind === 'seat' && typeof attachment.seatIndex === 'number'
    ? attachment.seatIndex
    : Number.MAX_SAFE_INTEGER
}

/**
 * Roots in the order given, each followed by its own subtree.
 *
 * An object whose parent is not in the payload is DROPPED, not promoted: a
 * child's `transform` is parent-relative, so promoting it would write a local
 * offset as a hall coordinate and stand the chair at the origin.
 */
function treeOrder(objects: BakeRecord[]): BakeRecord[] {
  const present = new Set<string>()
  for (const object of objects) {
    const id = idOf(object)
    if (id) present.add(id)
  }
  const childrenOf = new Map<string, BakeRecord[]>()
  const roots: BakeRecord[] = []
  for (const object of objects) {
    const parent = parentOf(object)
    if (!parent) {
      roots.push(object)
      continue
    }
    if (!present.has(parent)) continue
    const siblings = childrenOf.get(parent)
    if (siblings) siblings.push(object)
    else childrenOf.set(parent, [object])
  }
  const out: BakeRecord[] = []
  const seen = new Set<BakeRecord>()
  const walk = (object: BakeRecord): void => {
    // a malformed payload must not hang the dev server on a parent cycle
    if (seen.has(object)) return
    seen.add(object)
    out.push(object)
    const id = idOf(object)
    if (!id) return
    for (const child of [...(childrenOf.get(id) ?? [])].sort((a, b) => seatKey(a) - seatKey(b))) {
      walk(child)
    }
  }
  for (const root of roots) walk(root)
  return out
}

/**
 * `stackedOn` points at a SIBLING (a napkin on its place setting), so it travels
 * into the new id space with everything else. A target that did not survive
 * loses the key rather than keeping an id that resolves to nothing.
 */
function remapAttachment(attachment: BakeRecord, newIds: Map<string, string>): BakeRecord {
  const target = attachment.stackedOn
  if (typeof target !== 'string') return attachment
  const mapped = newIds.get(target)
  if (mapped) return { ...attachment, stackedOn: mapped }
  const rest = { ...attachment }
  delete rest.stackedOn
  return rest
}

/**
 * Deterministic ids (`fixture-<venue>-001`) rather than nanoid: baking twice from
 * the same arrangement must produce the same file, or every bake is a diff and
 * two machines never agree.
 *
 * The WHOLE TREE is written — roots and the chairs and table decor attached to
 * them. `objectOrder` holds top-level objects only, so the bake that followed it
 * silently dropped everything the user had arranged ON the tables, which is the
 * report this endpoint exists to answer (source doc §5).
 *
 * Two rules make a tree safe to write:
 *
 * - `parentId` and `attachment.stackedOn` are remapped into the new id space. A
 *   child that kept its old nanoid parent is the failure mode here and it is
 *   silent: `venueFixtures` drops it, or worse seeds it as an orphan sitting at
 *   parent-relative coordinates.
 * - only ROOTS carry `flags.frozen`. `frozen` implies `isEffectivelyLocked`
 *   (src/state/selectors.ts), and an effectively-locked object cannot be picked
 *   in the 2D editor, so freezing chairs and centrepieces would hand the user a
 *   table they can never dress. The hall's own fittings stay immovable; what
 *   stands on them stays editable. Children are written `locked: false` for the
 *   same reason — `locked` reaches `isEffectivelyLocked` too.
 *
 * Already-frozen objects are INCLUDED rather than filtered out, so pressing the
 * button twice is cumulative: the second bake rewrites the fixtures the first
 * one produced instead of dropping them on the floor.
 */
export function bakeSource(venueId: string, objects: unknown[], now: string): string {
  const ordered = treeOrder(objects as BakeRecord[])
  const fixtureId = (i: number) => `fixture-${venueId}-${String(i + 1).padStart(3, '0')}`
  const newIds = new Map<string, string>()
  ordered.forEach((object, i) => {
    const id = idOf(object)
    if (id) newIds.set(id, fixtureId(i))
  })

  const withIds = ordered.map((object, i) => {
    const parent = parentOf(object)
    const attachment = object.attachment as BakeRecord | null | undefined
    return {
      ...object,
      // re-assigning keys the object already has leaves them where they were, so
      // the emitted key order still mirrors the scene model
      id: fixtureId(i),
      parentId: parent ? (newIds.get(parent) ?? null) : null,
      ...(attachment ? { attachment: remapAttachment(attachment, newIds) } : {}),
      flags: parent
        ? { locked: false, visible: true }
        : { locked: true, visible: true, frozen: true },
      meta: { ...(object.meta as object | undefined), fixture: true },
    }
  })
  const body = withIds.map((o) => `    ${JSON.stringify(o)},`).join('\n')
  return `/**
 * AUTO-GENERATED by tools/bake-plugin.ts — do not edit by hand.
 * Generated: ${now}  ·  venue: ${venueId}
 *
 * Baked venue fixtures: objects that belong to the hall itself rather than to a
 * single event. \`createDefaultScene\` seeds them into every new project.
 *
 * A TREE, not a list. Roots come first and each is followed by its attached
 * children, whose \`transform\` is parent-relative and whose \`parentId\` points at
 * the root's id IN THIS FILE. Only roots carry \`flags.frozen\`, which makes them
 * un-movable, un-deletable and un-unlockable; the chairs and decor on them stay
 * selectable, or the user could never dress a table again.
 *
 * Re-baking is CUMULATIVE: the button sends the frozen fixtures back along with
 * everything else, so a second press rewrites this file rather than emptying it.
 *
 * This file is self-sufficient. When the temporary bake button is removed from
 * the presets panel the fixtures stay exactly as they are — nothing else changes.
 */
import type { SceneObject } from './model/types'

export const VENUE_FIXTURES: Record<string, SceneObject[]> = {
  ${JSON.stringify(venueId)}: [
${body}
  ],
}
`
}

export function bakePlugin(): Plugin {
  return {
    name: 'hanan-bake',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bake', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, payload: unknown) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        }
        try {
          const { venueId, objects } = JSON.parse(await readBody(req)) as {
            venueId?: unknown
            objects?: unknown
          }
          if (typeof venueId !== 'string' || !VENUE_ID.test(venueId)) {
            return send(400, { error: 'bad venue id' })
          }
          if (!Array.isArray(objects) || objects.length > MAX_OBJECTS) {
            return send(400, { error: 'expected an object array' })
          }
          writeFileSync(OUT_FILE, bakeSource(venueId, objects, new Date().toISOString()), 'utf8')
          server.config.logger.info(`baked ${objects.length} fixtures → ${OUT_FILE}`)
          send(200, { count: objects.length })
        } catch (err) {
          send(500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  }
}
