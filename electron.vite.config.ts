import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: { resolve: { alias: shared } },
  preload: { resolve: { alias: shared } },
  renderer: {
    // the renderer also reads the logo from resources/ (the same file the app icons are made from)
    resolve: { alias: { ...shared, '@resources': resolve('resources') } },
    plugins: [react(), tailwindcss()]
  }
})
