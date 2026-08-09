// PreToolUse(Bash): a verification command in this repo can silently run against the main
// tree instead of the worktree you think you are in, and main always passes. Print the tree
// and branch it actually ran in so a green result is attributable.
import { execSync } from 'node:child_process'

let raw = ''
for await (const chunk of process.stdin) raw += chunk

try {
  const input = JSON.parse(raw || '{}')
  const command = input.tool_input?.command ?? ''
  if (!/\b(vitest|tsc|eslint)\b|npm (run )?(test|typecheck|lint|build|dev)/.test(command)) {
    process.exit(0)
  }
  const cwd = input.cwd || process.cwd()
  const git = (args) => execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim()
  const tree = git('rev-parse --show-toplevel')
  const branch = git('branch --show-current') || git('rev-parse --short HEAD')
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `[where-am-i] this runs in ${tree} on ${branch}`,
      },
    }),
  )
} catch {
  // not a git dir, or malformed input — never block the command over it
}
process.exit(0)
