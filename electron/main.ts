import { app, BrowserWindow, protocol, session, Menu, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// ESM 兼容：用 import.meta.url 推导 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 开发模式检测
const isDev = !app.isPackaged

// 模型和 WASM 资源根目录
// - 开发：项目根目录的 public/ 和 node_modules/onnxruntime-web/dist/
// - 生产：extraResources 目录（安装时复制到这里）
function getResourcePath(...segments: string[]): string {
  if (isDev) {
    return path.join(__dirname, '..', ...segments)
  }
  return path.join(process.resourcesPath, ...segments)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'LocalCut Pro',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      // .cjs 强制 CommonJS，因为 package.json "type": "module" 会影响 .js
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false 允许 preload 使用 ESM import（对桌面 App 风险可控，
      // 因为 preload 仅通过 contextBridge 暴露少量安全 API）
      sandbox: false,
      webSecurity: true,
      webAssembly: true,
    },
    show: false,
    backgroundColor: '#1a1a2e',
  })

  // 窗口准备好后再显示，避免白屏
  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // 生产：加载 Vite 打包后的 index.html
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'))

    // 生产环境禁止打开 DevTools
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools()
    })
  }

  return win
}

function setupProtocol() {
  // 注册 localcut:// 自定义协议，用于加载模型和 WASM 文件
  protocol.handle('localcut', (request) => {
    const url = new URL(request.url)
    // localcut://models/xxx.onnx → public/models/xxx.onnx 或 resources/models/xxx.onnx
    // localcut://wasm/xxx.wasm → node_modules/.../xxx.wasm 或 resources/wasm/xxx.wasm

    let filePath: string
    if (url.pathname.startsWith('/models')) {
      filePath = getResourcePath('public', url.pathname.slice(1))
    } else if (url.pathname.startsWith('/wasm')) {
      // WASM 文件在 node_modules/onnxruntime-web/dist/ 中
      filePath = getResourcePath('node_modules', 'onnxruntime-web', 'dist', url.pathname.slice(6))
    } else {
      return new Response('Not Found', { status: 404 })
    }

    try {
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.onnx': 'application/octet-stream',
        '.wasm': 'application/wasm',
        '.mjs': 'application/javascript',
        '.cjs': 'application/javascript',
        '.js': 'application/javascript',
        '.json': 'application/json',
      }
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        },
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}

function setupCors() {
  // 注入 COOP/COEP 头以支持 SharedArrayBuffer（ONNX Runtime WASM 多线程需要）
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
        'Cross-Origin-Resource-Policy': ['cross-origin'],
      },
    })
  })
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '导入图片',
          accelerator: 'CmdOrCtrl+O',
          click: (_menuItem, win) => {
            if (win) {
              dialog.showOpenDialog(win, {
                properties: ['openFile', 'multiSelections'],
                filters: [
                  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
                ],
              }).then(result => {
                if (!result.canceled && result.filePaths.length > 0) {
                  win.webContents.send('open-files', result.filePaths)
                }
              })
            }
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' as const },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' as const },
        { type: 'separator' },
        { label: '剪切', role: 'cut' as const },
        { label: '复制', role: 'copy' as const },
        { label: '粘贴', role: 'paste' as const },
        { label: '全选', role: 'selectAll' as const },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' as const },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' as const },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' as const },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' as const },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 LocalCut Pro',
          click: () => {
            dialog.showMessageBox({
              title: '关于 LocalCut Pro',
              message: 'LocalCut Pro v1.0.0',
              detail: '本地图片素材切割工作台\n支持 AI 智能抠图与超分辨率',
            })
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function setupIPC() {
  // 文件打开对话框
  ipcMain.handle('open-file-dialog', async (_event, options) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      properties: options?.multi
        ? ['openFile', 'multiSelections']
        : ['openFile'],
      filters: options?.filters || [
        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      ],
    })

    return result.canceled ? null : result.filePaths
  })

  // 文件保存对话框
  ipcMain.handle('save-file-dialog', async (_event, options) => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showSaveDialog(win, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [
        { name: 'ZIP 压缩包', extensions: ['zip'] },
        { name: 'PNG 图片', extensions: ['png'] },
        { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
        { name: 'WebP 图片', extensions: ['webp'] },
      ],
    })

    return result.canceled ? null : result.filePath
  })

  // 获取用户数据目录
  ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData')
  })
}

// 禁用远程调试端口（安全加固）
app.commandLine.appendSwitch('remote-debugging-port', '0')

// 注册 localcut:// 为特权协议（必须在 app.whenReady() 之前调用）
// - standard: 让 URL 像 http:// 一样解析
// - secure: 视为安全来源（类似 https）
// - supportFetchAPI: 让 fetch() 可以使用此协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localcut',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
])

app.whenReady().then(() => {
  setupProtocol()
  setupCors()
  buildMenu()
  setupIPC()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
