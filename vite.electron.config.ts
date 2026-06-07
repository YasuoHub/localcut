import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  return {
    plugins: [
      vue(),

      // Electron 主进程 + 预加载脚本构建
      electron([
        {
          // 主进程入口
          entry: 'electron/main.ts',
          onstart(args) {
            if (isDev) {
              // 开发模式：Vite 编译完主进程后自动启动 Electron
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
        {
          // 预加载脚本 —— Electron 始终用 require() 加载 preload
          // 必须输出 .cjs 扩展名，因为 package.json "type": "module" 会把 .js 当 ESM
          entry: 'electron/preload.cjs',
          onstart(args) {
            args.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              lib: { entry: 'electron/preload.cjs', formats: ['cjs'] },
              rollupOptions: {
                external: ['electron'],
                output: {
                  format: 'cjs',
                  inlineDynamicImports: true,
                  entryFileNames: '[name].cjs',
                  chunkFileNames: '[name].cjs',
                },
              },
            },
          },
        },
      ]),

      // 渲染进程：支持 Node.js 内置模块
      renderer(),

      // JS 混淆：仅在 Electron 生产构建时启用
      // 在 Vite 中直接使用 obfuscator 插件会与 chunk 系统冲突（破坏 Worker 导出等）
      // 改为通过 post-build 脚本单独处理，参见 scripts/obfuscate-build.mjs
    ],

    // 渲染进程构建输出
    build: {
      outDir: 'dist-electron/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/index.html'),
        },
      },
    },

    // 开发服务器
    server: {
      port: 5173,
    },
  }
})
