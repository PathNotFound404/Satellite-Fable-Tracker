import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const wasmStub = fileURLToPath(new URL('./src/stubs/satellite-js-wasm.ts', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // satellite.js lazily imports optional WebAssembly builds through these internal
      // specifiers. We only use its plain-JS SGP4, and the threaded build doesn't
      // bundle for the browser, so point both at a stub.
      '#wasm-single-thread': wasmStub,
      '#wasm-multi-thread': wasmStub,
    },
  },
  build: {
    target: 'es2022',
    // three.js is a single large dependency; keep it in its own cacheable chunk.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
