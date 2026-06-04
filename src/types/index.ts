export type ShapeType = 'rect' | 'circle' | 'triangle' | 'diamond' | 'star' | 'heart' | 'custom'

export type ToolType = 'select' | ShapeType | 'brush' | 'eraser' | 'text' | 'magic-wand'

export type DragType = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w'

export type ImageFormat = 'png' | 'jpeg' | 'webp'

export interface CropRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  shape: ShapeType
  points?: { x: number; y: number }[]
}

export interface TextAnnotation {
  id: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  fontColor: string
  fontWeight: 'normal' | 'bold'
}

export interface BrushSettings {
  size: number
  color: string
}

export interface EraserSettings {
  size: number
}

export interface ExportSettings {
  format: ImageFormat
  quality: number
  outputWidth: number
  outputHeight: number
  lockAspectRatio: boolean
  dpr: number
}

export interface CanvasViewState {
  image: HTMLImageElement | null
  scale: number
  offsetX: number
  offsetY: number
}
