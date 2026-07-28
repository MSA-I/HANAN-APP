/**
 * The trust boundary for reference files.
 *
 * An export package is built in the browser and POSTed to the dev server, which
 * then COPIES the reference images it names. Those names are therefore attacker
 * -controlled input to a file read: without this module, `../../../` in a ref
 * path reads any file on the disk into the output folder. `safeName` in
 * tools/capture-plugin.ts does not help — it sanitises a single file NAME, and
 * these are paths with directories in them.
 *
 * ⚠ SERVER-SIDE ONLY. It lives under src/core because that is the only place
 * vitest is configured to look for tests (vite.config.ts `include`), and this is
 * exactly the kind of logic that must not ship untested. Nothing the browser
 * bundle imports may import this file — it pulls in `node:path`. `refs.ts` and
 * `compose.ts` deliberately do not.
 */
import { isAbsolute, join, resolve, sep } from 'node:path'

/**
 * Leading path segment → the absolute directory it means. A ref path is always
 * `<prefix>/<rest>`, so the set of readable roots is a closed list rather than
 * anything the client can widen.
 */
export type RefRoots = Record<string, string>

/**
 * Absolute path of a client-supplied reference, or null if it is not provably
 * inside one of `roots`.
 *
 * Rejects, in order: empty input, anything already absolute, anything carrying a
 * drive letter or UNC marker (`:` never appears in a legitimate ref path, and
 * `join` on win32 will happily splice `C:/…` into a relative tail), an unknown
 * root prefix, and finally anything whose RESOLVED path escapes its root — which
 * is the check that actually catches `../../../`, including the encoded and
 * mixed-separator spellings, because it compares real paths rather than text.
 */
export function resolveRefPath(rel: unknown, roots: RefRoots): string | null {
  if (typeof rel !== 'string' || !rel.trim()) return null
  const cleaned = rel.replaceAll('\\', '/').trim()
  if (isAbsolute(cleaned) || cleaned.includes(':') || cleaned.startsWith('//')) return null

  const slash = cleaned.indexOf('/')
  if (slash <= 0) return null
  const root = roots[cleaned.slice(0, slash)]
  if (!root) return null

  const rest = cleaned.slice(slash + 1)
  if (!rest) return null

  const base = resolve(root)
  const full = resolve(join(base, rest))
  // `+ sep` so a sibling directory sharing a name prefix ("…/publicX") cannot pass
  return full.startsWith(base + sep) ? full : null
}
