/**
 * capture-plugin — dev-only endpoint that lands 3D captures next to the rest of
 * the project's assets instead of in the browser's Downloads folder.
 *
 * The app is a pure browser SPA: it has no disk access, and `<a download>` cannot
 * choose a destination. While the app is in development the dev server is the
 * simplest thing that can write a file, so `POST /__capture` does it.
 *
 * ponytail: dev-only (`apply: 'serve'`) and a hardcoded destination. The caller
 * falls back to a plain download when this isn't mounted, so `vite build` /
 * `preview` still work. If captures are ever needed from a real build, that is
 * the File System Access API — a different feature, not an extension of this one.
 *
 * .ts, unlike the rest of tools/, because it is imported by vite.config.ts rather
 * than run by node — so it may as well be type-checked with the app.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Sibling of the repo — where the user keeps source images, SKPs and GLBs. */
const OUT_DIR = resolve(fileURLToPath(new URL('../../HANAN-APP-DOCS/צילומים', import.meta.url)))

const MAX_BODY = 32 * 1024 * 1024 // a 1536×1024 PNG data-URL is ~2–5 MB
const PNG_PREFIX = 'data:image/png;base64,'

/**
 * Trust boundary: `name` arrives from the browser. Allowlist letters (Hebrew
 * included), digits, space, dot, dash, underscore and round brackets (camera
 * labels use them) — everything else becomes a dash, which leaves no way to
 * express a path separator or `..`. The caller re-verifies the resolved path
 * anyway, because a sanitiser bug here writes anywhere on disk.
 */
function safeName(raw: unknown): string {
  const base = String(raw ?? '')
    .replace(/[^\p{L}\p{N} ()._-]/gu, '-')
    .replace(/\.+/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
  return `${base || 'capture'}.png`
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
          const { dataUrl, name } = JSON.parse(await readBody(req)) as {
            dataUrl?: unknown
            name?: unknown
          }
          if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) {
            return send(400, { error: 'expected a PNG data URL' })
          }
          const file = join(OUT_DIR, safeName(name))
          if (!resolve(file).startsWith(OUT_DIR + sep)) return send(400, { error: 'bad name' })

          mkdirSync(OUT_DIR, { recursive: true })
          writeFileSync(file, Buffer.from(dataUrl.slice(PNG_PREFIX.length), 'base64'))
          server.config.logger.info(`captured → ${file}`)
          send(200, { path: file })
        } catch (err) {
          send(500, { error: err instanceof Error ? err.message : String(err) })
        }
      })
    },
  }
}
