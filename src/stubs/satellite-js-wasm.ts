/**
 * Stand-in for satellite.js's optional WebAssembly builds, which this app does not use
 * (see docs/adr/0002-propagation-strategy.md). vite.config.ts aliases the library's
 * internal `#wasm-*` imports here so the bundler doesn't try to package them.
 */
export default function createWasmModule(): never {
  throw new Error('The satellite.js WebAssembly runtime is not bundled in this app.')
}
