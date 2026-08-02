/**
 * capture-plugin — dev-only endpoint that lands 3D captures next to the rest of
 * the project's assets instead of in the browser's Downloads folder.
 *
 * The app is a pure browser SPA: it has no disk access, and `<a download>` cannot
 * choose a destination. While the app is in development the dev server is the
 * simplest thing that can write a file, so `POST /__capture` does it.
 *
 * It now writes a FOLDER as well as a file (PLAN-08 §47): the capture, the
 * prompt, the reference images and a manifest, which together are one package
 * that can be handed to an image model. The references are COPIED here, server
 * side — sending a dozen images back up through the POST that asked for them
 * would be megabytes of base64 for files already sitting on this disk.
 *
 * ponytail: dev-only (`apply: 'serve'`) and a hardcoded destination. The caller
 * falls back to a plain download when this isn't mounted, so `vite build` /
 * `preview` still work. If captures are ever needed from a real build, that is
 * the File System Access API — a different feature, not an extension of this one.
 *
 * .ts, unlike the rest of tools/, because it is imported by vite.config.ts rather
 * than run by node — so it may as well be type-checked with the app.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { resolveRefPath, type RefRoots } from '../src/core/prompts/refPaths'

/** Sibling of the repo — where the user keeps source images, SKPs and GLBs. */
const DOCS_DIR = resolve(fileURLToPath(new URL('../../HANAN-APP-DOCS', import.meta.url)))
const OUT_DIR = join(DOCS_DIR, 'צילומים')
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)))
/** The other sibling — the site's own photography, where the landscape shot lives. */
const GAMOS_DIR = resolve(fileURLToPath(new URL('../../GAMOS-DOCS', import.meta.url)))

/**
 * ⚠ TRUST BOUNDARY. Reference paths arrive from the browser, and the server
 * READS whatever they name. These THREE directories are the whole of what it is
 * willing to read: the docs folder (the hall material photo), GAMOS-DOCS (the
 * site's own background photography — the real landscape behind the building,
 * §23) and the app's own public/ (the product thumbnails). `resolveRefPath`
 * proves a request stays inside one of them before anything is opened — see
 * src/core/prompts/refPaths.test.ts, which is where the `../../../` cases live.
 *
 * A new root is the ONLY sanctioned way to widen this. Loosening resolveRefPath
 * instead would turn every reference path into an arbitrary file read.
 *
 * `safeSegment` below is NOT this check and cannot be: it sanitises one file
 * NAME, and these are paths with directories in them.
 */
const REF_ROOTS: RefRoots = {
  'HANAN-APP-DOCS': DOCS_DIR,
  'GAMOS-DOCS': GAMOS_DIR,
  public: PUBLIC_DIR,
}

const MAX_BODY = 32 * 1024 * 1024 // a 1536×1024 PNG data-URL is ~2–5 MB
const PNG_PREFIX = 'data:image/png;base64,'

/**
 * Trust boundary: `name` arrives from the browser. Allowlist letters (Hebrew
 * included), digits, space, dot, dash, underscore and round brackets (camera
 * labels use them) — everything else becomes a dash, which leaves no way to
 * express a path separator or `..`. The caller re-verifies the resolved path
 * anyway, because a sanitiser bug here writes anywhere on disk.
 */
function safeSegment(raw: unknown, fallback = 'capture'): string {
  const base = String(raw ?? '')
    .replace(/[^\p{L}\p{N} ()._-]/gu, '-')
    .replace(/\.+/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
  return base || fallback
}

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

/** What the browser posts. Nothing in here is trusted until it has been checked. */
interface CaptureRequest {
  dataUrl?: unknown
  /** single-frame mode: just a file name */
  name?: unknown
  /** package mode (PLAN-08): the composed prompt and its references */
  pkg?: {
    angleId?: unknown
    angleLabel?: unknown
    prompt?: unknown
    refs?: unknown
    warnings?: unknown
  }
  /** project name, so one event's angles land in one folder */
  project?: unknown
}

interface IncomingRef {
  path: string
  role: string
  caption: string
}

/**
 * RefRole in core/prompts/refs.ts. Anything else the browser sends is a design
 * shot — a SILENT downgrade, which is the whole reason this list is exported and
 * held against `REF_ROLE_NAMES` by a test: a role added there and forgotten here
 * gets the wrong name in manifest.json and the wrong name on disk, with no error
 * anywhere to say so.
 *
 * Not imported from refs.ts directly: this module is loaded by vite.config.ts,
 * and refs.ts pulls in three and the whole catalog registry.
 */
export const REF_ROLES = new Set(['materials', 'background', 'floor', 'fixed', 'design'])

function readRefs(raw: unknown): IncomingRef[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap<IncomingRef>((item) => {
    if (!item || typeof item !== 'object') return []
    const { path, role, caption } = item as Record<string, unknown>
    if (typeof path !== 'string') return []
    return [
      {
        path,
        role: typeof role === 'string' && REF_ROLES.has(role) ? role : 'design',
        caption: String(caption ?? ''),
      },
    ]
  })
}

/** `01-materials-hall.png` — mirrors refFileName in core/prompts/compose.ts. */
export function refFileName(ref: IncomingRef, index: number): string {
  const ext = /\.[a-z0-9]+$/i.exec(ref.path)?.[0] ?? '.png'
  const n = String(index + 1).padStart(2, '0')
  if (ref.role === 'materials') return `${n}-materials-hall${ext}`
  if (ref.role === 'background') return `${n}-background-landscape${ext}`
  if (ref.role === 'floor') return `${n}-floor-detail${ext}`
  const stem = ref.path.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? 'ref'
  return `${n}-${ref.role === 'fixed' ? 'fixed-' : ''}${safeSegment(stem, 'ref')}${ext}`
}

export function capturePlugin(): Plugin {
  return {
    name: 'hanan-capture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        const send = (code: number, payload: unknown) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        }
        try {
          const body = JSON.parse(await readBody(req)) as CaptureRequest
          const { dataUrl, pkg } = body
          if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) {
            return send(400, { error: 'expected a PNG data URL' })
          }
          const png = Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64')

          // --- single-frame mode: no package, just land the picture ---
          if (!pkg) {
            const file = join(OUT_DIR, `${safeSegment(body.name)}.png`)
            if (!resolve(file).startsWith(OUT_DIR + sep)) return send(400, { error: 'bad name' })
            mkdirSync(OUT_DIR, { recursive: true })
            writeFileSync(file, png)
            server.config.logger.info(`captured → ${file}`)
            return send(200, { path: file })
          }

          // --- package mode: צילומים/<project>/<angle label>__<ISO>/ ---
          // path.join throughout and no shell anywhere: every segment of this
          // path is Hebrew with spaces in it, and a quoted command line is the
          // one thing on Windows that will not survive that.
          const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
          const dir = join(
            OUT_DIR,
            safeSegment(body.project, 'ללא שם'),
            `${safeSegment(pkg.angleLabel ?? pkg.angleId, 'מבט')}__${stamp}`,
          )
          if (!resolve(dir).startsWith(OUT_DIR + sep)) return send(400, { error: 'bad folder' })

          const refsDir = join(dir, 'refs')
          mkdirSync(refsDir, { recursive: true })
          writeFileSync(join(dir, 'capture.png'), png)
          // explicit utf8 — the prompt is English today but nothing guarantees it
          writeFileSync(join(dir, 'prompt.txt'), String(pkg.prompt ?? ''), { encoding: 'utf8' })

          const warnings = Array.isArray(pkg.warnings) ? pkg.warnings.map(String) : []
          const copied: { file: string; role: string; caption: string; source: string }[] = []
          readRefs(pkg.refs).forEach((ref, i) => {
            const from = resolveRefPath(ref.path, REF_ROOTS)
            if (!from) {
              // a path that escapes the allowed roots is dropped, and SAID so:
              // skipping it quietly would read as a missing product shot
              warnings.push(`Reference rejected (outside the allowed folders): ${ref.path}`)
              return
            }
            if (!existsSync(from)) {
              warnings.push(`Reference not on disk: ${ref.path}`)
              return
            }
            const file = refFileName(ref, i)
            copyFileSync(from, join(refsDir, file))
            copied.push({ file, role: ref.role, caption: ref.caption, source: ref.path })
          })

          writeFileSync(
            join(dir, 'manifest.json'),
            JSON.stringify(
              {
                angleId: String(pkg.angleId ?? ''),
                angleLabel: String(pkg.angleLabel ?? ''),
                capturedAt: new Date().toISOString(),
                capture: 'capture.png',
                prompt: 'prompt.txt',
                refs: copied,
                warnings,
              },
              null,
              2,
            ),
            { encoding: 'utf8' },
          )

          server.config.logger.info(`exported → ${dir} (${copied.length} refs)`)
          send(200, { path: dir, refs: copied.length, warnings })
        } catch (err) {
          send(500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  }
}
