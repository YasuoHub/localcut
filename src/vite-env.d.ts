/// <reference types="vite/client" />

interface CanvasRenderingContext2D {
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  roundRect(x: number, y: number, w: number, h: number, radii: number[]): void
}

interface ElectronImageFile {
  name: string
  dataUrl: string
}

interface ElectronAPI {
  isElectron: boolean
  openFileDialog: (options?: unknown) => Promise<string[] | null>
  saveFileDialog: (options?: unknown) => Promise<string | null>
  getUserDataPath: () => Promise<string>
  onOpenFiles: (callback: (files: ElectronImageFile[]) => void) => () => void
  onMenuCommand: (callback: (command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all') => void) => () => void
}

interface Window {
  electronAPI?: ElectronAPI
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
