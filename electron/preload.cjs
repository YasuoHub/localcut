const { contextBridge, ipcRenderer } = require('electron')

/**
 * 预加载桥接脚本（CommonJS 格式）
 * Electron 的 preload 始终用 require() 加载，必须用 CJS
 */
const electronAPI = {
  isElectron: true,

  openFileDialog: (options) => {
    return ipcRenderer.invoke('open-file-dialog', options)
  },

  saveFileDialog: (options) => {
    return ipcRenderer.invoke('save-file-dialog', options)
  },

  getUserDataPath: () => {
    return ipcRenderer.invoke('get-user-data-path')
  },

  onOpenFiles: (callback) => {
    ipcRenderer.on('open-files', (_event, paths) => {
      callback(paths)
    })
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
