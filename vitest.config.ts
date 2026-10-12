import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared'), '@resources': resolve('resources') } },
  // main-process tests run in Node; renderer tests (test/renderer/*.test.tsx) opt into jsdom with `// @vitest-environment jsdom`
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'], setupFiles: ['test/renderer/setup.ts'] }
})
