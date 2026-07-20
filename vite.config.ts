import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { capturePlugin } from './tools/capture-plugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), capturePlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 3000 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
