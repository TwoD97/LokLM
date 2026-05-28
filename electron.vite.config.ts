import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAliases = {
  '@main': resolve(__dirname, 'src/main'),
  '@preload': resolve(__dirname, 'src/preload'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer/src'),
}

const pkgVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
  .version as string

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAliases },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        // modelsWorker is a sibling entry — utilityProcess.fork loads it from
        // out/main/modelsWorker.js at runtime (see ModelsWorkerClient).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          modelsWorker: resolve(__dirname, 'src/main/services/workers/modelsWorker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAliases },
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: sharedAliases },
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion),
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
