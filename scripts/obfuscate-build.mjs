/**
 * Post-build JS 混淆脚本
 * 对 dist-electron/renderer/assets/ 下的 JS 文件进行混淆
 * 跳过 Worker 文件和 ONNX 相关 chunk
 *
 * 用法：node scripts/obfuscate-build.mjs
 */

import { obfuscate } from 'javascript-obfuscator'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rendererAssets = path.resolve(__dirname, '..', 'dist-electron', 'renderer', 'assets')

// 要跳过的文件模式
const SKIP_PATTERNS = [
  /worker/,
  /ort-wasm/,
  /postProcess/,
  /mattingInference/,
  /superResolution/,
  /useSuperResolution/,
]

function walkJS(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkJS(fullPath))
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath)
    }
  }
  return files
}

const files = walkJS(rendererAssets)
let obfuscatedCount = 0
let skippedCount = 0

for (const filePath of files) {
  const rel = path.relative(rendererAssets, filePath)

  if (SKIP_PATTERNS.some(p => p.test(rel))) {
    console.log(`  ⏭  跳过: ${rel}`)
    skippedCount++
    continue
  }

  console.log(`  🔒 混淆: ${rel}`)
  const code = fs.readFileSync(filePath, 'utf-8')

  try {
    const result = obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.3,
      stringArray: true,
      stringArrayThreshold: 0.75,
      stringArrayEncoding: ['base64'],
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      selfDefending: false,
      debugProtection: false,
      disableConsoleOutput: false,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    })
    fs.writeFileSync(filePath, result.getObfuscatedCode())
    obfuscatedCount++
  } catch (err) {
    console.error(`  ❌ 混淆失败 ${rel}:`, err.message)
  }
}

console.log(`\n✅ 混淆完成: ${obfuscatedCount} 个文件, 跳过 ${skippedCount} 个`)
