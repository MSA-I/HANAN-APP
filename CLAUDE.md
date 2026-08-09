# HANAN-APP — working notes for Claude

Hebrew-first event/hall planner. React 19 · TS strict · Vite 6 · Konva (2D) · three + R3F (3D) ·
Zustand+zundo · IndexedDB. Architecture map: `docs/ARCHITECTURE.md`. State of the work:
`docs/design/PROGRESS.md`.

Talk to the user in Hebrew. Code, filenames and commit messages in English.

## Commands

| | |
|---|---|
| `npm test` | vitest, `src/**/*.test.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint on `src` |
| `npm run dev -- --host 127.0.0.1 --port 3001` | **`--host` is mandatory** — the default bind here is IPv6-only, so `127.0.0.1` refuses connections |

Verifying at the real UI surface: `.claude/skills/verify/SKILL.md` (headless puppeteer-core; the
Chrome extension refuses localhost). Chrome, **not** Edge.

## Facts that have each cost a round

**A table's `defaultSize` is the tablecloth hem at the floor, not the usable top.** The top is
11–20 cm inside the declared rim (⌀180 → 12, ⌀380 → 19, serpentine → 0, measured with
`tools/glb-prep/measure-top.mjs`). `footprint()` — the outline seats snap to and the blue 2D
circle — is the hem. The correction lives in `TOP_INSET` in `core/layout/seatItemLayout.ts`, and
**re-prepping a table GLB invalidates its row**.

**`scene.objectOrder` includes the 25 baked venue fixtures**, so `objectOrder.length === 0` is
never true in production and it never means "what the user placed". Ask
`hasUserObjects(scene)` / `userObjectCount(scene)` in `src/state/selectors.ts` instead. The rule
underneath: a fixture is `frozen`, and `frozen` means "belongs to the hall, not to this event".
A gesture that mysteriously does nothing on a fresh project is usually hitting a fixture that is
correctly refusing.

**`src/core/space.ts` is the only place for plan↔three conversions and units.** three metres =
plan cm ÷ 100; three `z` = plan `y`.

**Adding a library item is a catalog file in `src/core/catalog/entries/` and nothing else** — no
renderer changes.

## Shell and filesystem here

- Never `/tmp`; it does not exist. Temp files go to the session scratchpad or the repo's `.tmp/`.
- The repo path contains Hebrew and a space. `.mjs` may hold Hebrew path literals (node reads
  UTF-8); **`.ps1` may not** — PowerShell 5.1 reads a BOM-less script as ANSI and mojibakes it.
  Parameterise the path instead: `param([string]$Repo = '.')`.
- **Zero-byte junk files keep appearing** — a `>` opening a markdown blockquote reaching a shell,
  and also plain Edit-tool traffic. They have truncated a *tracked* file once
  (`tools/glb-prep/glb-prep.mjs` → 0 bytes; `git checkout --` fixed it). So: check `git status`
  between `git add` and `git commit`, stage **by name** — never `git add -A` — delete junk by name,
  and **never `git clean -f`** (it once took a new tool and generated assets with it). The Stop
  hook in `.claude/settings.json` reports both classes.

## Worktrees (parallel agents)

- The shell cwd silently drifts back to the main tree between calls, so `npm test` reports green
  for **main**. Pin the directory in the same invocation, and treat an unexplained change in total
  test count as a wrong-tree signal before hunting for a cache bug. The `where-am-i` PreToolUse
  hook prints the tree and branch a verification command actually ran in.
- Worktrees junction `node_modules`, so they used to share `node_modules/.vite` and invalidate each
  other's pre-bundle — surfacing as `R3F: Hooks can only be used within the Canvas component!` and
  an empty 3D panel, which reads like a viewer regression and is not one. `vite.config.ts` now
  gives each worktree its own `cacheDir`. Before concluding "WebGL does not work on this machine",
  check for two dev servers first.
- Tearing worktrees down: `rmdir` each junction first (`node_modules` and
  `tools/glb-prep/node_modules`), then delete the directory, and assert the main `node_modules`
  still exists and is not a symlink after every tree. A recursive delete that follows a junction
  takes the real one.

## Driving the app headlessly

- `window.__stage` (Konva) and `window.__viewer3d` = `{ gl, scene, camera, controlsRef, invalidate, info }`
  (dev only). `controlsRef.current.setLookAt(...)` frames repeatable 3D shots; nothing in the 3D
  scene graph carries a `name`, so measure against a known-size object or against the GLB on disk.
- 2D zoom must go through the app's own controls (wheel over the canvas, negative `deltaY` = in, or
  the four `footer button`s) — setting the Konva stage scale directly does not stick.
- Double-click differs per view: 2D/Konva wants **two discrete `mouse.click`s**; 3D/R3F wants a
  dispatched native `dblclick` (`detail: 2`), because CDP never emits one.
- The inspector is the **last** `aside`, not the first — `dir="rtl"` flips where panels appear, not
  DOM order.
- Restart the dev server before a final verification run. After HMR, a query-less
  `await import('/src/state/store.ts')` instantiates a **second, empty** store and every read comes
  back "never created" while the app is fine. A `git checkout -- src` under a live server poisons it
  the same way.
- Vite watches the whole worktree: writing any file mid-run reloads the page and kills the
  in-flight `evaluate`. Write every script before launching the browser, and never verify while a
  subagent is still editing.
- `window.__viewer3d` missing usually means the app bounced back to the Dashboard (there is no
  router; the open project lives in component state). Read it together with
  `document.querySelectorAll('canvas').length` — 0 = Dashboard.

## Assets

Models and product images live outside the repo, under `…\HANAN-APP-DOCS\` (`מודלים GLB`, `GPT`).
SketchUp source: `D:\משה פרוייקטים\מגרש 510\SKP\ריזורט גאמוס - אפליקציה.skp`. Only the **resort**
venue pack ships — do not spend effort on the other halls' assets even though the files exist.
