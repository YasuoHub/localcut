import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import fs from 'node:fs'
import path, { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  return {
    plugins: [
      vue(),
      {
        name: 'ort-wasm-dev-server',
        configureServer(server) {
          const ortDist = path.resolve('node_modules/onnxruntime-web/dist')
          server.middlewares.use('/wasm', (req, res, next) => {
            const urlWithoutQuery = (req.url || '/').split('?')[0]
            const filePath = path.join(ortDist, urlWithoutQuery)

            if (!fs.existsSync(filePath)) {
              next()
              return
            }

            const ext = path.extname(filePath)
            const mimeTypes: Record<string, string> = {
              '.wasm': 'application/wasm',
              '.mjs': 'application/javascript',
              '.js': 'application/javascript',
              '.json': 'application/json',
            }

            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Cache-Control', 'public, max-age=3600')
            fs.createReadStream(filePath).pipe(res)
          })
        },
      },
      {
        name: 'copy-electron-preload',
        closeBundle() {
          fs.mkdirSync('dist-electron', { recursive: true })
          fs.copyFileSync('electron/preload.cjs', 'dist-electron/preload.cjs')
        },
      },

      // Electron 主进�?+ 预加载脚本构�?
      electron([
        {
          // 主进程入�?
          entry: 'electron/main.ts',
          onstart(args) {
            if (isDev) {
              // 开发模式：Vite 编译完主进程后自动启�?Electron
              args.startup(['.', '--no-sandbox'])
            }
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                external: ['electron', 'onnxruntime-web'],
              },
            },
          },
        },
      ]),

      // 渲染进程：支�?Node.js 内置模块
      renderer(),

      // JS 混淆：仅�?Electron 生产构建时启�?
      // �?Vite 中直接使�?obfuscator 插件会与 chunk 系统冲突（破�?Worker 导出等）
      // 改为通过 post-build 脚本单独处理，参�?scripts/obfuscate-build.mjs
    ],

    // 渲染进程构建输出
    build: {
      outDir: 'dist-electron/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/index.html'),
        },
      },
      minify: 'terser',
      sourcemap: false
    },

    // 开发服务器
    server: {
      port: 5173,
    },

    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
  }
})
