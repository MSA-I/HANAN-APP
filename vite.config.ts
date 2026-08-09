import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { bakePlugin } from './tools/bake-plugin'
import { capturePlugin } from './tools/capture-plugin'

export default defineConfig({
  // One pre-bundle cache per worktree. Worktrees here reach node_modules through a junction, so
  // they otherwise share `node_modules/.vite` and two dev servers invalidate each other's
  // pre-bundle mid-session — which surfaces as "R3F: Hooks can only be used within the Canvas
  // component!" and an empty 3D panel, i.e. as a viewer regression that isn't one.
  cacheDir: `node_modules/.vite-${basename(process.cwd())}`,
  plugins: [react(), tailwindcss(), capturePlugin(), bakePlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 3000 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
