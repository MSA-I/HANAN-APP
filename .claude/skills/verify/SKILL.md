---
name: verify
description: Build, launch and drive HANAN-APP end-to-end (headless) to verify changes at the real UI surface
---

# Verifying HANAN-APP

## Launch
- `npm run dev -- --host 127.0.0.1 --port 3001` — MUST pass `--host`: the default binding on this machine is IPv6-only (`[::1]`), so `127.0.0.1` refuses connections.
- Confirm the server is up: `Invoke-WebRequest http://127.0.0.1:3001` → 200.

## Drive it (headless — the Chrome extension blocks localhost)
The claude-in-chrome extension refuses localhost/private-IP navigation (site permissions), so drive with puppeteer-core + the system Edge instead:

- `npm install --no-save puppeteer-core`
- Edge binary: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- Put the script inside the repo (e.g. `.tmp/verify.mjs` — gitignored) so `node_modules` resolves.
- Launch args: `['--enable-unsafe-swiftshader', '--lang=he']` (SwiftShader enables WebGL for the 3D view).

## Useful runtime hooks
- Dev-only Konva handle: `window.__stage` → `window.__stage.find('.scene-object').length` counts rendered top-level 2D objects (great for layer-visibility assertions).
- WASD flight (3D): send real key events — `page.keyboard.down('KeyW')` / `'KeyQ'` / `'Shift'`; handlers key off `e.code` and are active only when the view mode is `3d`.
- JSON import: a hidden `input[type="file"]` in the toolbar accepts a ProjectFile JSON — the cleanest way to exercise schema migrations end-to-end.
- New-project modal: color swatches are `button[aria-label="#rrggbb"]`; option buttons are plain buttons matched by Hebrew text.

## Gotchas
- `/favicon.ico` 404s in the console — pre-existing, ignore.
- The 3D pane lazy-loads (React.lazy + GLBs) — wait ~4s after clicking "3D" before screenshots.
- Headless runs get a fresh browser profile each time, so IndexedDB starts empty — create a project via the dialog first.
