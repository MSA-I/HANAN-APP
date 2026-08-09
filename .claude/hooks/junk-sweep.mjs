// Stop: zero-byte files keep appearing in this repo (a `>` opening a markdown blockquote
// reaching a shell, and plain Edit-tool traffic). Once it truncated a TRACKED file to 0 bytes.
// Report both classes; deleting is deliberately left to a human decision, and `git clean -f`
// is never the answer — it has taken real untracked work along with the junk.
import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'

let raw = ''
for await (const chunk of process.stdin) raw += chunk

try {
  const input = JSON.parse(raw || '{}')
  if (input.stop_hook_active) process.exit(0) // already reported once this turn

  const git = (args) =>
    execSync(`git ${args}`, { encoding: 'utf8' }).split('\0').filter(Boolean)
  const isEmpty = (f) => {
    try {
      return statSync(f).size === 0
    } catch {
      return false // deleted, or a path we cannot stat — not our bug
    }
  }

  const junk = git('ls-files --others --exclude-standard -z').filter(isEmpty)
  const truncated = git('diff --name-only -z').filter(isEmpty)

  if (junk.length || truncated.length) {
    const lines = []
    if (truncated.length) {
      lines.push(
        `TRACKED files are now 0 bytes — restore them with \`git checkout -- <path>\`: ${truncated.join(' ')}`,
      )
    }
    if (junk.length) {
      lines.push(
        `zero-byte junk files — delete by name (\`rm -- "<name>"\`), never \`git clean -f\`: ${junk.join(' ')}`,
      )
    }
    console.error(lines.join('\n'))
    process.exit(2)
  }
} catch {
  // never hold the session open because the sweep itself broke
}
process.exit(0)
