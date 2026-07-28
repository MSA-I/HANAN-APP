/**
 * The path-traversal guard. Every case here is a real request shape the dev
 * server can receive, because the reference list is built in the browser.
 */
import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRefPath } from './refPaths'

const DOCS = resolve('D:/work/HANAN-APP-DOCS')
const PUBLIC = resolve('D:/work/HANAN-APP/public')
const ROOTS = { 'HANAN-APP-DOCS': DOCS, public: PUBLIC }

describe('resolveRefPath', () => {
  it('accepts a path inside a known root', () => {
    expect(resolveRefPath('public/thumbs/table-round.webp', ROOTS)).toBe(
      resolve(PUBLIC, 'thumbs/table-round.webp'),
    )
  })

  it('accepts hebrew directory and file names', () => {
    expect(resolveRefPath('HANAN-APP-DOCS/טסטים/זווית מקורית.png', ROOTS)).toBe(
      resolve(DOCS, 'טסטים/זווית מקורית.png'),
    )
  })

  it('REJECTS ../../../ escapes', () => {
    expect(resolveRefPath('HANAN-APP-DOCS/../../../Windows/System32/config/SAM', ROOTS)).toBeNull()
    expect(resolveRefPath('public/../../secrets.env', ROOTS)).toBeNull()
    expect(resolveRefPath('public/thumbs/../../../../etc/passwd', ROOTS)).toBeNull()
  })

  it('REJECTS escapes spelled with backslashes', () => {
    expect(resolveRefPath('public\\..\\..\\secrets.env', ROOTS)).toBeNull()
    expect(resolveRefPath('HANAN-APP-DOCS\\..\\..\\..\\Windows\\win.ini', ROOTS)).toBeNull()
  })

  it('REJECTS absolute paths, drive letters and UNC', () => {
    expect(resolveRefPath('/etc/passwd', ROOTS)).toBeNull()
    expect(resolveRefPath('C:/Windows/win.ini', ROOTS)).toBeNull()
    expect(resolveRefPath('public/C:/Windows/win.ini', ROOTS)).toBeNull()
    expect(resolveRefPath('//server/share/file.png', ROOTS)).toBeNull()
  })

  it('REJECTS an unknown or missing root', () => {
    expect(resolveRefPath('node_modules/evil.js', ROOTS)).toBeNull()
    expect(resolveRefPath('thumbs/table-round.webp', ROOTS)).toBeNull()
    expect(resolveRefPath('public', ROOTS)).toBeNull()
    expect(resolveRefPath('public/', ROOTS)).toBeNull()
  })

  it('REJECTS a sibling directory that merely shares the prefix', () => {
    expect(resolveRefPath('public/../publicX/leak.png', ROOTS)).toBeNull()
  })

  it('REJECTS non-strings and blanks', () => {
    expect(resolveRefPath(undefined, ROOTS)).toBeNull()
    expect(resolveRefPath(42, ROOTS)).toBeNull()
    expect(resolveRefPath('', ROOTS)).toBeNull()
    expect(resolveRefPath('   ', ROOTS)).toBeNull()
  })

  it('keeps a deep legitimate path inside its root', () => {
    const out = resolveRefPath('HANAN-APP-DOCS/GPT/עיצובי בסיס ריזורט/shot.png', ROOTS)
    expect(out?.startsWith(DOCS + sep)).toBe(true)
  })
})
