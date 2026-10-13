import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// electron-vite's `import path from './x?modulePath'` (the transcription worker) is a build feature; in tests it's just a path
const modulePath = {
  name: 'module-path-stub',
  // before Vite's own resolver, which would ignore the query and import the worker itself
  enforce: 'pre' as const,
  resolveId: (id: string) => (id.endsWith('?modulePath') ? `virtual:module-path:${id}` : null),
  load: (id: string) => (id.startsWith('virtual:module-path:') ? 'export default "worker-stub.js"' : null)
}

export default defineConfig({
  plugins: [react(), modulePath],
  resolve: { alias: { '@shared': resolve('src/shared'), '@resources': resolve('resources') } },
  // main-process tests run in Node; renderer tests (test/renderer/*.test.tsx) opt into jsdom with `// @vitest-environment jsdom`
  test: { include: ['test/**/*.test.ts', 'test/**/*.test.tsx'], setupFiles: ['test/renderer/setup.ts'] }
})
