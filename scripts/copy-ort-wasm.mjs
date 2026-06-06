import { cpSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const src = 'node_modules/onnxruntime-web/dist'
const dest = 'public/wasm'

mkdirSync(dest, { recursive: true })

const wasmFiles = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jspi.wasm',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.asyncify.mjs',
]

for (const f of wasmFiles) {
  cpSync(resolve(src, f), resolve(dest, f))
  console.log(`Copied: ${f}`)
}
console.log('ORT WASM files copied to public/wasm/')
