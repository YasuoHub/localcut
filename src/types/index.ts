export type ShapeType = 'rect' | 'circle' | 'triangle' | 'diamond' | 'star' | 'heart' | 'custom' | 'roundrect'

export type ToolType = 'select' | ShapeType | 'brush' | 'eraser' | 'text' | 'magic-wand'

export type DragType = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | 'resize-n' | 'resize-s' | 'resize-e' | 'resize-w'

export type ImageFormat = 'png' | 'jpeg' | 'webp'

export type BatchOutputFitMode = 'original' | 'cover' | 'contain' | 'stretch'

export interface CropRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  shape: ShapeType
  points?: { x: number; y: number }[]
  borderRadius?: number
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

export interface ImageLayer {
  id: string
  name: string
  image: HTMLImageElement
  workingCanvas: HTMLCanvasElement | null
  x: number
  y: number
  scaleX: number
  scaleY: number
  visible: boolean
}

export interface GridOptions {
  rows: number
  cols: number
  startX: number
  startY: number
  cellWidth: number
  cellHeight: number
  gapX: number
  gapY: number
  namePrefix: string
  borderRadius: number
}

export interface DuplicateOptions {
  count: number
  mode: 'horizontal' | 'vertical' | 'custom'
  gapX: number
  gapY: number
  deltaX: number
  deltaY: number
}

export interface SliceOptions {
  startY: number
  endY: number | null
  sliceHeight: number
  overlap: number
  namePrefix: string
}

export interface FilenameContext {
  imageName: string
  regionName: string
  index: number
  width: number
  height: number
  format: string
  date: string
}

export interface CropTemplate {
  id: string
  name: string
  createdAt: number
  baseRect: { x: number; y: number; width: number; height: number }
  regions: CropTemplateRegion[]
}

export interface CropTemplateRegion {
  name: string
  shape: ShapeType
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  pointsRatio?: { x: number; y: number }[]
}

export interface ExportNamingOptions {
  pattern: string
  imageName: string
}

export interface PlatformPreset {
  id: string
  group: string
  name: string
  width: number
  height: number
}

// ---- matting ----

export type MattingModelType = 'modnet' | 'modnet-fp16'

export type MattingBackend = 'webgpu' | 'wasm'

export type MaskViewMode = 'checkerboard'

export type MaskBrushMode = 'keep' | 'remove'

export type MattingStage =
  | 'idle'
  | 'ready'
  | 'loading_model'
  | 'running_inference'
  | 'mask_editing'
  | 'done'

export type MattingImageSource = 'upload' | 'current-layer'

export interface MattingMaskData {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface MattingBrush {
  size: number
  mode: MaskBrushMode
}

export interface MattingEdgeSettings {
  feather: number
  expand: number
  contract: number
}

export interface MattingProgress {
  message: string
  percent: number
}

export type MattingWorkerRequest =
  | { type: 'load_model'; modelType: MattingModelType; modelData: ArrayBuffer }
  | { type: 'run_inference'; imageData: ImageData }
  | { type: 'cancel' }

export type MattingWorkerResponse =
  | { type: 'model_load_progress'; percent: number }
  | { type: 'model_loaded'; backend: MattingBackend }
  | { type: 'inference_complete'; mask: { width: number; height: number; data: number[] } }
  | { type: 'error'; message: string }
