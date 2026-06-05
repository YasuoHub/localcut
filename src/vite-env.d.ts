/// <reference types="vite/client" />

interface CanvasRenderingContext2D {
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  roundRect(x: number, y: number, w: number, h: number, radii: number[]): void
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
