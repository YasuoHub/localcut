/**
 * 运行环境检测
 * - 浏览器：navigator.userAgent 不包含 Electron
 * - Electron：navigator.userAgent 包含 Electron
 * - Electron Dev：从 Vite dev server (localhost) 加载，可用相对 URL
 * - Electron Prod：从 file:// 或本地文件加载，需要 localcut:// 自定义协议
 *
 * 在 Web Worker 中也可使用（Worker 有 self.navigator 和 self.location）
 */

export const IS_ELECTRON =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

/**
 * Electron 开发模式
 * Dev: renderer 从 http://localhost:5173 加载 → 相对 URL 自动走 Vite dev server
 * Prod: renderer 从 file:// 加载 → 需要 localcut:// 自定义协议
 */
export const IS_ELECTRON_DEV =
  IS_ELECTRON &&
  typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
