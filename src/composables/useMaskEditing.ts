import { ref, type Ref } from 'vue'
import { useMattingStore } from '../stores/matting'
import { useEditorStore } from '../stores/editor'
import { compositeResult } from '../utils/mattingImageUtils'

type WorkerRequest = {
  type: 'process_edges'
  id: number
  mask: Uint8ClampedArray
  width: number
  height: number
  expand: number
  contract: number
  feather: number
}

type WorkerResponse = {
  type: 'edges_processed'
  id: number
  mask: Uint8ClampedArray
  error?: string
}

function createEdgeWorker(): Worker {
  return new Worker(
    new URL('../workers/mattingPostProcess.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

export function useMaskEditing(
  displayCanvasRef: Ref<HTMLCanvasElement | null>,
) {
  const store = useMattingStore()
  const isDrawing = ref(false)
  const isProcessingEdges = ref(false)
  let maskCanvas: HTMLCanvasElement | null = null
  let maskCtx: CanvasRenderingContext2D | null = null

  let compositeCanvas: HTMLCanvasElement | null = null
  let compositeCtx: CanvasRenderingContext2D | null = null

  // Source image pre-rendered at working resolution (avoids sampling full-res HTMLImageElement)
  let workingSource: HTMLCanvasElement | null = null

  // Undo / redo stacks
  const maskHistory: Uint8ClampedArray[] = []
  const maskRedoHistory: Uint8ClampedArray[] = []
  const MAX_HISTORY = 20

  // rAF throttle + bounding boxes (O(1) expand, replaces O(n²) dirty rect merge)
  let rafPending = false
  let frameBounds: { x: number; y: number; w: number; h: number } | null = null
  let strokeBounds: { x: number; y: number; w: number; h: number } | null = null

  // Pre-rendered brush stamp caches (rebuilt when size changes)
  let keepStamp: HTMLCanvasElement | null = null
  let removeStamp: HTMLCanvasElement | null = null
  let stampSize = 0

  // Previous brush position + bezier midpoint for smooth curve interpolation
  let lastX = -1
  let lastY = -1
  let midX = -1
  let midY = -1

  // Edge-processing Worker state
  let edgeWorker: Worker | null = null
  let edgeRequestId = 0

  function ensureEdgeWorker(): Worker {
    if (!edgeWorker) {
      edgeWorker = createEdgeWorker()
      edgeWorker.addEventListener('message', onEdgeWorkerMessage)
    }
    return edgeWorker
  }

  function onEdgeWorkerMessage(e: MessageEvent<WorkerResponse>) {
    const msg = e.data
    if (msg.type !== 'edges_processed') return
    if (msg.id !== edgeRequestId) return

    isProcessingEdges.value = false

    if (msg.error || !store.sourceImage || !store.maskData) return

    store.maskEdited = true

    const w = store.maskData.width
    const h = store.maskData.height
    if (maskCanvas && maskCtx && maskCanvas.width === w && maskCanvas.height === h) {
      const imgData = maskCtx.createImageData(w, h)
      const dst32 = new Uint32Array(imgData.data.buffer)
      const src = msg.mask
      for (let i = 0; i < src.length; i++) {
        const val = src[i]
        dst32[i] = (val << 24) | (val << 16) | (val << 8) | val
      }
      maskCtx.putImageData(imgData, 0, 0)
      store.maskData = { width: w, height: h, data: new Uint8ClampedArray(src) }
      fullComposite()
    } else {
      store.maskData = { width: w, height: h, data: new Uint8ClampedArray(msg.mask) }
      const resultCanvas = compositeResult(store.sourceImage, msg.mask, w, h)
      store.setResultCanvas(resultCanvas)
      compositeCanvas = resultCanvas
      compositeCtx = resultCanvas.getContext('2d')!
    }

    triggerDisplayUpdate()
  }

  function ensureMaskCanvas() {
    if (!store.maskData) return false
    if (maskCanvas && maskCanvas.width === store.maskData.width && maskCanvas.height === store.maskData.height) {
      return true
    }

    maskCanvas = document.createElement('canvas')
    maskCanvas.width = store.maskData.width
    maskCanvas.height = store.maskData.height
    maskCtx = maskCanvas.getContext('2d')!

    const imgData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height)
    const src = store.maskData.data
    const dst32 = new Uint32Array(imgData.data.buffer)
    for (let i = 0; i < src.length; i++) {
      const val = src[i]
      dst32[i] = (val << 24) | (val << 16) | (val << 8) | val
    }
    maskCtx.putImageData(imgData, 0, 0)

    compositeCanvas = null
    compositeCtx = null
    workingSource = null
    return true
  }

  function ensureWorkingSource() {
    if (!store.sourceImage || !store.maskData) return false
    const w = store.maskData.width
    const h = store.maskData.height
    if (!workingSource || workingSource.width !== w || workingSource.height !== h) {
      workingSource = document.createElement('canvas')
      workingSource.width = w
      workingSource.height = h
      const wsCtx = workingSource.getContext('2d')!
      wsCtx.drawImage(store.sourceImage, 0, 0, w, h)
    }
    return true
  }

  function ensureCompositeCanvas() {
    if (!store.sourceImage || !store.maskData) return false
    const w = store.maskData.width
    const h = store.maskData.height

    if (!compositeCanvas || compositeCanvas.width !== w || compositeCanvas.height !== h) {
      compositeCanvas = document.createElement('canvas')
      compositeCanvas.width = w
      compositeCanvas.height = h
      compositeCtx = compositeCanvas.getContext('2d')!
      fullComposite()
    }
    return true
  }

  function fullComposite() {
    if (!store.sourceImage || !store.maskData || !compositeCtx || !compositeCanvas) return
    const { width, height, data } = store.maskData
    const result = compositeResult(store.sourceImage, data, width, height)
    compositeCtx.clearRect(0, 0, width, height)
    compositeCtx.drawImage(result, 0, 0)
    store.setResultCanvas(compositeCanvas)
  }

  function saveMaskSnapshot() {
    if (!store.maskData) return
    store.maskEdited = true
    const snapshot = new Uint8ClampedArray(store.maskData.data)
    maskHistory.push(snapshot)
    if (maskHistory.length > MAX_HISTORY) {
      maskHistory.shift()
    }
  }

  function undoMaskEdit() {
    if (maskHistory.length === 0 || !maskCtx || !maskCanvas) return
    const editor = useEditorStore()
    editor.isHeavyProcessing = true
    try {
      if (store.maskData) {
        const current = new Uint8ClampedArray(store.maskData.data)
        maskRedoHistory.push(current)
        if (maskRedoHistory.length > MAX_HISTORY) maskRedoHistory.shift()
      }
      const snapshot = maskHistory.pop()!
      const imgData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height)
      const dst32 = new Uint32Array(imgData.data.buffer)
      for (let i = 0; i < snapshot.length; i++) {
        const val = snapshot[i]
        dst32[i] = (val << 24) | (val << 16) | (val << 8) | val
      }
      maskCtx.putImageData(imgData, 0, 0)
      store.maskData = { width: maskCanvas.width, height: maskCanvas.height, data: new Uint8ClampedArray(snapshot) }
      fullComposite()
      triggerDisplayUpdate()
    } finally {
      editor.isHeavyProcessing = false
    }
  }

  function redoMaskEdit() {
    if (maskRedoHistory.length === 0 || !maskCtx || !maskCanvas) return
    const editor = useEditorStore()
    editor.isHeavyProcessing = true
    try {
      if (store.maskData) {
        const current = new Uint8ClampedArray(store.maskData.data)
        maskHistory.push(current)
        if (maskHistory.length > MAX_HISTORY) maskHistory.shift()
      }
      const snapshot = maskRedoHistory.pop()!
      const imgData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height)
      const dst32 = new Uint32Array(imgData.data.buffer)
      for (let i = 0; i < snapshot.length; i++) {
        const val = snapshot[i]
        dst32[i] = (val << 24) | (val << 16) | (val << 8) | val
      }
      maskCtx.putImageData(imgData, 0, 0)
      store.maskData = { width: maskCanvas.width, height: maskCanvas.height, data: new Uint8ClampedArray(snapshot) }
      fullComposite()
      triggerDisplayUpdate()
    } finally {
      editor.isHeavyProcessing = false
    }
  }

  function preInit() {
    if (!store.maskData || !store.sourceImage) return
    ensureMaskCanvas()
    ensureWorkingSource()
    if (store.resultCanvas &&
        store.resultCanvas.width === store.maskData.width &&
        store.resultCanvas.height === store.maskData.height) {
      compositeCanvas = store.resultCanvas
      compositeCtx = compositeCanvas.getContext('2d')!
      return
    }
    ensureCompositeCanvas()
  }

  function rebuildBrushStamps(size: number) {
    const dim = size
    const radius = size / 2
    const cx = dim / 2
    const cy = dim / 2

    keepStamp = document.createElement('canvas')
    keepStamp.width = keepStamp.height = dim
    const kctx = keepStamp.getContext('2d')!
    const kgrad = kctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius)
    kgrad.addColorStop(0, 'rgba(255, 255, 255, 1)')
    kgrad.addColorStop(0.6, 'rgba(255, 255, 255, 0.9)')
    kgrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
    kctx.fillStyle = kgrad
    kctx.beginPath()
    kctx.arc(cx, cy, radius, 0, Math.PI * 2)
    kctx.fill()

    removeStamp = document.createElement('canvas')
    removeStamp.width = removeStamp.height = dim
    const rctx = removeStamp.getContext('2d')!
    const rgrad = rctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius)
    rgrad.addColorStop(0, 'rgba(0, 0, 0, 1)')
    rgrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.9)')
    rgrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    rctx.fillStyle = rgrad
    rctx.beginPath()
    rctx.arc(cx, cy, radius, 0, Math.PI * 2)
    rctx.fill()

    stampSize = size
  }

  function startBrush(canvasX: number, canvasY: number) {
    if (!ensureMaskCanvas()) return
    saveMaskSnapshot()
    maskRedoHistory.length = 0
    strokeBounds = null
    isDrawing.value = true
    lastX = canvasX
    lastY = canvasY
    midX = canvasX
    midY = canvasY
    drawBrushDot(canvasX, canvasY)
    scheduleFlush()
  }

  function moveBrush(canvasX: number, canvasY: number) {
    if (!isDrawing.value) return

    const brush = store.brush
    const radius = brush.size / 2
    const step = Math.max(1, radius * 0.25)

    const newMidX = (lastX + canvasX) / 2
    const newMidY = (lastY + canvasY) / 2

    const dist = Math.sqrt((newMidX - midX) ** 2 + (newMidY - midY) ** 2)
    const steps = Math.max(0, Math.ceil(dist / step))

    for (let i = 1; i <= steps; i++) {
      const t = i / (steps || 1)
      const u = 1 - t
      const bx = u * u * midX + 2 * u * t * lastX + t * t * newMidX
      const by = u * u * midY + 2 * u * t * lastY + t * t * newMidY
      drawBrushDot(bx, by)
    }

    midX = newMidX
    midY = newMidY
    lastX = canvasX
    lastY = canvasY
    scheduleFlush()
  }

  function endBrush() {
    isDrawing.value = false
    if (midX >= 0 && midY >= 0) {
      const brush = store.brush
      const radius = brush.size / 2
      const step = Math.max(1, radius * 0.25)
      const dist = Math.sqrt((lastX - midX) ** 2 + (lastY - midY) ** 2)
      const steps = Math.ceil(dist / step)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        drawBrushDot(midX + (lastX - midX) * t, midY + (lastY - midY) * t)
      }
    }
    lastX = -1
    lastY = -1
    midX = -1
    midY = -1
    if (rafPending) {
      rafPending = false
      flushBrushEdits()
    }
    syncMaskFromCanvas()
  }

  function drawBrushDot(canvasX: number, canvasY: number) {
    if (!maskCtx || !maskCanvas) return

    const brush = store.brush
    const size = brush.size

    if (size !== stampSize) {
      rebuildBrushStamps(size)
    }

    const stamp = brush.mode === 'keep' ? keepStamp! : removeStamp!
    const half = stampSize / 2

    maskCtx.globalCompositeOperation = brush.mode === 'keep' ? 'source-over' : 'destination-out'
    maskCtx.drawImage(stamp, canvasX - half, canvasY - half)

    const radius = size / 2
    const margin = 4
    const rx = Math.max(0, Math.floor(canvasX - radius - margin))
    const ry = Math.max(0, Math.floor(canvasY - radius - margin))
    const rw = Math.min(maskCanvas.width - rx, Math.ceil(radius * 2 + margin * 2))
    const rh = Math.min(maskCanvas.height - ry, Math.ceil(radius * 2 + margin * 2))

    // O(1) bounding box expansion (replaces O(n²) dirty rect merge)
    if (!frameBounds) {
      frameBounds = { x: rx, y: ry, w: rw, h: rh }
    } else {
      const nx = Math.min(frameBounds.x, rx)
      const ny = Math.min(frameBounds.y, ry)
      frameBounds.w = Math.max(frameBounds.x + frameBounds.w, rx + rw) - nx
      frameBounds.h = Math.max(frameBounds.y + frameBounds.h, ry + rh) - ny
      frameBounds.x = nx
      frameBounds.y = ny
    }
    if (!strokeBounds) {
      strokeBounds = { x: rx, y: ry, w: rw, h: rh }
    } else {
      const sx = Math.min(strokeBounds.x, rx)
      const sy = Math.min(strokeBounds.y, ry)
      strokeBounds.w = Math.max(strokeBounds.x + strokeBounds.w, rx + rw) - sx
      strokeBounds.h = Math.max(strokeBounds.y + strokeBounds.h, ry + rh) - sy
      strokeBounds.x = sx
      strokeBounds.y = sy
    }
  }

  function scheduleFlush() {
    if (!rafPending) {
      rafPending = true
      requestAnimationFrame(flushBrushEdits)
    }
  }

  function flushBrushEdits() {
    rafPending = false
    if (!maskCtx || !maskCanvas || !store.maskData) return
    if (!ensureCompositeCanvas() || !ensureWorkingSource()) return

    const rect = frameBounds
    frameBounds = null
    if (!rect || rect.w <= 0 || rect.h <= 0) return

    // Single bounding box compositing: 2x getImageData on ONE rect (~1ms total)
    // vs. previous O(n²) merge + 20+ rects × 2 getImageData (~40ms)
    compositeCtx!.clearRect(rect.x, rect.y, rect.w, rect.h)
    compositeCtx!.drawImage(workingSource!,
      rect.x, rect.y, rect.w, rect.h,
      rect.x, rect.y, rect.w, rect.h)

    const regionData = compositeCtx!.getImageData(rect.x, rect.y, rect.w, rect.h)
    const pixels = regionData.data
    const maskRegion = maskCtx.getImageData(rect.x, rect.y, rect.w, rect.h)
    const maskPixels = maskRegion.data
    for (let row = 0; row < rect.h; row++) {
      for (let col = 0; col < rect.w; col++) {
        pixels[(row * rect.w + col) * 4 + 3] = maskPixels[(row * rect.w + col) * 4 + 3]
      }
    }
    compositeCtx!.putImageData(regionData, rect.x, rect.y)

    store.setResultCanvas(compositeCanvas!)
    triggerDisplayUpdate()
  }

  function syncMaskFromCanvas() {
    if (!maskCtx || !maskCanvas || !store.maskData) return

    const bounds = strokeBounds
    strokeBounds = null

    if (bounds && bounds.w > 0 && bounds.h > 0) {
      // Incremental sync: only read the stroke region (e.g. 200x200 vs 4096x4096 full)
      const { x, y, w, h } = bounds
      const regionData = maskCtx.getImageData(x, y, w, h)
      const newData = new Uint8ClampedArray(store.maskData.data)
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const maskIdx = (y + row) * maskCanvas.width + (x + col)
          newData[maskIdx] = regionData.data[(row * w + col) * 4 + 3]
        }
      }
      store.maskData = { width: maskCanvas.width, height: maskCanvas.height, data: newData }
    } else {
      // Full-mask sync (undo/redo/edge-refinement fallback)
      const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
      const newData = new Uint8ClampedArray(maskCanvas.width * maskCanvas.height)
      for (let i = 0; i < newData.length; i++) {
        newData[i] = imgData.data[i * 4 + 3]
      }
      store.maskData = { width: maskCanvas.width, height: maskCanvas.height, data: newData }
    }
  }

  function triggerDisplayUpdate() {
    const displayCanvas = displayCanvasRef.value
    if (displayCanvas) {
      displayCanvas.dispatchEvent(new CustomEvent('matting-display-update'))
    }
  }

  function updateDisplayRaw() {
    if (!store.sourceImage || !store.maskData) return
    if (compositeCanvas && compositeCtx) {
      fullComposite()
    } else {
      const { width, height, data } = store.maskData
      const resultCanvas = compositeResult(store.sourceImage, data, width, height)
      store.setResultCanvas(resultCanvas)
      compositeCanvas = resultCanvas
      compositeCtx = resultCanvas.getContext('2d')!
    }
    triggerDisplayUpdate()
  }

  function refineEdges() {
    if (!store.maskData || !store.sourceImage) return

    const hasEdges =
      store.edgeSettings.feather > 0 ||
      store.edgeSettings.expand > 0 ||
      store.edgeSettings.contract > 0

    if (!hasEdges) {
      updateDisplayRaw()
      return
    }

    const worker = ensureEdgeWorker()
    const id = ++edgeRequestId

    const maskCopy = new Uint8ClampedArray(store.maskData.data)
    isProcessingEdges.value = true

    worker.postMessage(
      {
        type: 'process_edges',
        id,
        mask: maskCopy,
        width: store.maskData.width,
        height: store.maskData.height,
        expand: store.edgeSettings.expand,
        contract: store.edgeSettings.contract,
        feather: store.edgeSettings.feather,
      } satisfies WorkerRequest,
      [maskCopy.buffer],
    )
  }

  function destroy() {
    if (edgeWorker) {
      edgeWorker.terminate()
      edgeWorker = null
    }
  }

  return {
    isProcessingEdges,
    preInit,
    startBrush,
    moveBrush,
    endBrush,
    undoMaskEdit,
    redoMaskEdit,
    refineEdges,
    saveMaskSnapshot,
    updateDisplay: updateDisplayRaw,
    destroy,
  }
}
