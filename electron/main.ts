import { app, BrowserWindow, protocol, session, Menu, dialog, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// ESM 兼容：用 import.meta.url 推导 __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 开发模式检测
const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null

function imageFileToDataUrl(filePath: string): { name: string; dataUrl: string } {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const data = fs.readFileSync(filePath)
  return {
    name: path.basename(filePath),
    dataUrl: `data:${mimeTypes[ext] || 'application/octet-stream'};base64,${data.toString('base64')}`,
  }
}

// 模型和 WASM 资源根目录
// - 开发：项目根目录的 public/ 和 node_modules/onnxruntime-web/dist/
// - 生产：extraResources 目录（安装时复制到这里）
function getResourcePath(...segments: string[]): string {
  if (isDev) {
    return path.join(__dirname, '..', ...segments)
  }
  return path.join(process.resourcesPath, ...segments)
}

function createLocalFileResponse(filePath: string, cacheControl = 'public, max-age=86400'): Response {
  const data = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.onnx': 'application/octet-stream',
    '.wasm': 'application/wasm',
  }

  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': cacheControl,
    },
  })
}

function getSafeProtocolPath(requestUrl: string): string | null {
  const url = new URL(requestUrl)
  const resourcePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
  const normalized = path.normalize(resourcePath)

  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return null
  }

  return normalized
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
      preload: isDev
        ? path.join(__dirname, '..', 'electron', 'preload.cjs')
        : path.join(__dirname, 'preload.cjs'),
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
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // 窗口准备好后再显示，避免白屏
  win.once('ready-to-show', () => {
    win.show()
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    // 生产：通过自定义协议加载，让 HTML/JS/Worker 都能带 COOP/COEP 头
    win.loadURL('localcut-app://app/electron/index.html')

    // 生产环境禁止打开 DevTools
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools()
    })
  }

  return win
}

function setupProtocol() {
  protocol.handle('localcut-app', (request) => {
    const resourcePath = getSafeProtocolPath(request.url)
    if (!resourcePath) {
      return new Response('Not Found', { status: 404 })
    }

    try {
      const filePath = path.join(__dirname, 'renderer', resourcePath)
      return createLocalFileResponse(filePath, resourcePath.endsWith('.html') ? 'no-cache' : 'public, max-age=86400')
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })

  // 注册 localcut:// 自定义协议，用于加载模型和 WASM 文件
  protocol.handle('localcut', (request) => {
    const url = new URL(request.url)
    const resourceType = url.hostname || url.pathname.split('/')[1]
    const resourcePath = url.hostname
      ? url.pathname.slice(1)
      : url.pathname.split('/').slice(2).join('/')

    if (!resourcePath || resourcePath.includes('..') || path.isAbsolute(resourcePath)) {
      return new Response('Not Found', { status: 404 })
    }
    // localcut://models/xxx.onnx → public/models/xxx.onnx 或 resources/models/xxx.onnx
    // localcut://wasm/xxx.wasm → node_modules/.../xxx.wasm 或 resources/wasm/xxx.wasm

    let filePath: string
    if (resourceType === 'models') {
      filePath = isDev
        ? getResourcePath('public', 'models', resourcePath)
        : getResourcePath('models', resourcePath)
    } else if (resourceType === 'wasm') {
      // 开发环境从 node_modules 读取，生产环境从 extraResources/wasm 读取
      filePath = isDev
        ? getResourcePath('node_modules', 'onnxruntime-web', 'dist', resourcePath)
        : getResourcePath('wasm', resourcePath)
    } else {
      return new Response('Not Found', { status: 404 })
    }

    try {
      return createLocalFileResponse(filePath)
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
  function getTargetWindow(win?: BrowserWindow): BrowserWindow | null {
    return (
      win ??
      BrowserWindow.getFocusedWindow() ??
      mainWindow ??
      BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) ??
      null
    )
  }

  function sendEditCommand(win: BrowserWindow | undefined, command: string) {
    const target = getTargetWindow(win)
    target?.webContents.send('menu-command', command)
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '导入图片',
          accelerator: 'CmdOrCtrl+O',
          click: (_menuItem, win) => {
            const target = getTargetWindow(win)
            if (target) {
              dialog.showOpenDialog(target, {
                properties: ['openFile', 'multiSelections'],
                filters: [
                  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
                ],
              }).then(result => {
                if (!result.canceled && result.filePaths.length > 0) {
                  const files = result.filePaths.map(imageFileToDataUrl)
                  target.webContents.send('open-files', files)
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
        {
          label: '撤销',
          accelerator: 'CmdOrCtrl+Z',
          click: (_menuItem, win) => sendEditCommand(win, 'undo'),
        },
        {
          label: '重做',
          accelerator: 'CmdOrCtrl+Y',
          click: (_menuItem, win) => sendEditCommand(win, 'redo'),
        },
        { type: 'separator' },
        {
          label: '剪切',
          accelerator: 'CmdOrCtrl+X',
          click: (_menuItem, win) => sendEditCommand(win, 'cut'),
        },
        {
          label: '复制',
          accelerator: 'CmdOrCtrl+C',
          click: (_menuItem, win) => sendEditCommand(win, 'copy'),
        },
        {
          label: '粘贴',
          accelerator: 'CmdOrCtrl+V',
          click: (_menuItem, win) => sendEditCommand(win, 'paste'),
        },
        {
          label: '全选',
          accelerator: 'CmdOrCtrl+A',
          click: (_menuItem, win) => sendEditCommand(win, 'select-all'),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' as const },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' as const },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' as const },
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
              detail: '本地图片素材切割工作台\n支持 AI 智能抠图与超分辨率\n 联系方式: leox520@163.com ',
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
// Electron 的 Chromium 在部分机器上不会默认暴露 WebGPU；FP16 ONNX 模型需要 WebGPU + shader-f16。
app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('ignore-gpu-blocklist')

// 注册 localcut:// 为特权协议（必须在 app.whenReady() 之前调用）
// - standard: 让 URL 像 http:// 一样解析
// - secure: 视为安全来源（类似 https）
// - supportFetchAPI: 让 fetch() 可以使用此协议
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localcut-app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: 'localcut',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

app.whenReady().then(() => {
  if (isDev) {
    console.log('GPU feature status:', app.getGPUFeatureStatus())
  }
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
