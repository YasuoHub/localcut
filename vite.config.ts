import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'cors-isolation-headers',
      configureServer(server) {
        // SharedArrayBuffer 需要跨域隔离头（多线程 WASM 依赖）
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
          next()
        })
      },
    },
    {
      name: 'ort-wasm-dev-server',
      configureServer(server) {
        const ortDist = path.resolve('node_modules/onnxruntime-web/dist')
        // 开发模式：拦截 /wasm/* 请求，直接从 node_modules 提供 ORT 文件
        // 避免 public/ 目录下的文件无法被动态 import() 的问题
        server.middlewares.use('/wasm', (req, res, next) => {
          // Vite 会给动态 import() 的 URL 加上 ?import 查询参数，需要去掉
          const urlWithoutQuery = (req.url || '/').split('?')[0]
          const filePath = path.join(ortDist, urlWithoutQuery)
          if (fs.existsSync(filePath)) {
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
          } else {
            next()
          }
        })
      },
    },
  ],
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
})
