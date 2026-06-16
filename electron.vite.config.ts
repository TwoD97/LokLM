import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Dev-server-only CSP relaxation. The strict policy in index.html is what
// ships ; under `electron-vite dev` two things need extra allowances that
// must NOT leak into the build : the react-refresh preamble is an inline
// script , and HMR runs over a localhost websocket ( connect-src 'self'
// does not match ws: in Chromium ). apply: 'serve' keeps this out of builds.
function cspDevRelax(): Plugin {
  return {
    name: 'loklm-csp-dev-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace(
          "connect-src 'self'",
          "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
        )
    },
  }
}

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
        // modelsWorker + documentsWorker are sibling entries — utilityProcess.fork
        // loads them from out/main/<name>.js at runtime (see the worker clients).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          modelsWorker: resolve(__dirname, 'src/main/services/workers/modelsWorker.ts'),
          documentsWorker: resolve(__dirname, 'src/main/services/workers/documentsWorker.ts'),
          transcriptionWorker: resolve(
            __dirname,
            'src/main/services/workers/transcriptionWorker.ts',
          ),
          diarizationWorker: resolve(__dirname, 'src/main/services/workers/diarizationWorker.ts'),
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
        // CJS , not the package-default ESM : the renderer runs with
        // sandbox: true ( see createMainWindow ) and Chromium's sandboxed
        // preload loader cannot execute ES modules. The only runtime import
        // is 'electron' , which the sandbox polyfills for require().
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), cspDevRelax()],
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
