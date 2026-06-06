import { ref, type Ref } from 'vue'
import { useMattingStore } from '../stores/matting'
import { compositeResult } from '../utils/mattingImageUtils'
import { applyEdgeRefinements } from '../utils/mattingPostProcess'

export function useMaskEditing(
  displayCanvasRef: Ref<HTMLCanvasElement | null>,
) {
  const store = useMattingStore()
  const isDrawing = ref(false)
  let maskCanvas: HTMLCanvasElement | null = null
  let maskCtx: CanvasRenderingContext2D | null = null

  // Persistent composite canvas (avoids full-image recomposite every frame)
  let compositeCanvas: HTMLCanvasElement | null = null
  let compositeCtx: CanvasRenderingContext2D | null = null

  // Undo stack
  const maskHistory: Uint8ClampedArray[] = []
  const MAX_HISTORY = 20

  // rAF throttle + dirty rects
  let rafPending = false
  let dirtyRects: { x: number; y: number; w: number; h: number }[] = []

  // Previous brush position for interpolation
  let lastX = -1
  let lastY = -1

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
    for (let i = 0; i < store.maskData.data.length; i++) {
      const val = store.maskData.data[i]
      imgData.data[i * 4] = val
      imgData.data[i * 4 + 1] = val
      imgData.data[i * 4 + 2] = val
      imgData.data[i * 4 + 3] = 255
    }
    maskCtx.putImageData(imgData, 0, 0)

    // Force full composite rebuild on dimension change
    compositeCanvas = null
    compositeCtx = null
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

    compositeCtx.drawImage(store.sourceImage, 0, 0, width, height)
    const imgData = compositeCtx.getImageData(0, 0, width, height)
    const pixels = imgData.data
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4 + 3] = data[i]
    }
    compositeCtx.putImageData(imgData, 0, 0)
    store.setResultCanvas(compositeCanvas)
  }

  function saveMaskSnapshot() {
    if (!maskCtx || !maskCanvas) return
    const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    const snapshot = new Uint8ClampedArray(maskCanvas.width * maskCanvas.height)
    for (let i = 0; i < snapshot.length; i++) {
      snapshot[i] = imgData.data[i * 4]
    }
    maskHistory.push(snapshot)
    if (maskHistory.length > MAX_HISTORY) {
      maskHistory.shift()
    }
  }

  function undoMaskEdit() {
    if (maskHistory.length === 0 || !maskCtx || !maskCanvas) return
    const snapshot = maskHistory.pop()!
    const imgData = maskCtx.createImageData(maskCanvas.width, maskCanvas.height)
    for (let i = 0; i < snapshot.length; i++) {
      const val = snapshot[i]
      imgData.data[i * 4] = val
      imgData.data[i * 4 + 1] = val
      imgData.data[i * 4 + 2] = val
      imgData.data[i * 4 + 3] = 255
    }
    maskCtx.putImageData(imgData, 0, 0)
    syncMaskFromCanvas()
    fullComposite()
    triggerDisplayUpdate()
  }

  function startBrush(canvasX: number, canvasY: number) {
    if (!ensureMaskCanvas()) return
    saveMaskSnapshot()
    isDrawing.value = true
    lastX = canvasX
    lastY = canvasY
    drawBrushDot(canvasX, canvasY)
    scheduleFlush()
  }

  function moveBrush(canvasX: number, canvasY: number) {
    if (!isDrawing.value) return

    const brush = store.brush
    const radius = brush.size / 2
    const step = Math.max(1, radius * 0.4)

    const dx = canvasX - lastX
    const dy = canvasY - lastY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist >= step) {
      const steps = Math.ceil(dist / step)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        drawBrushDot(lastX + dx * t, lastY + dy * t)
      }
    } else if (dist > 0) {
      drawBrushDot(canvasX, canvasY)
    }

    lastX = canvasX
    lastY = canvasY
    scheduleFlush()
  }

  function endBrush() {
    isDrawing.value = false
    lastX = -1
    lastY = -1
    if (rafPending) {
      rafPending = false
      flushBrushEdits()
    }
  }

  function drawBrushDot(canvasX: number, canvasY: number) {
    if (!maskCtx || !maskCanvas) return

    const brush = store.brush
    const radius = brush.size / 2

    const gradient = maskCtx.createRadialGradient(
      canvasX, canvasY, radius * 0.2,
      canvasX, canvasY, radius,
    )

    if (brush.mode === 'keep') {
      maskCtx.globalCompositeOperation = 'source-over'
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
      gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.9)')
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    } else {
      maskCtx.globalCompositeOperation = 'destination-out'
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)')
      gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.9)')
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    }

    maskCtx.fillStyle = gradient
    maskCtx.beginPath()
    maskCtx.arc(canvasX, canvasY, radius, 0, Math.PI * 2)
    maskCtx.fill()

    const margin = 4
    const rx = Math.max(0, Math.floor(canvasX - radius - margin))
    const ry = Math.max(0, Math.floor(canvasY - radius - margin))
    const rw = Math.min(maskCanvas.width - rx, Math.ceil(radius * 2 + margin * 2))
    const rh = Math.min(maskCanvas.height - ry, Math.ceil(radius * 2 + margin * 2))
    dirtyRects.push({ x: rx, y: ry, w: rw, h: rh })
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
    if (!ensureCompositeCanvas()) return

    const maskW = maskCanvas.width
    const srcImg = store.sourceImage!

    for (const rect of dirtyRects) {
      if (rect.w <= 0 || rect.h <= 0) continue

      // 1. Sync mask pixels (only dirty rect)
      const maskImgData = maskCtx.getImageData(rect.x, rect.y, rect.w, rect.h)
      const maskSrc = maskImgData.data
      for (let row = 0; row < rect.h; row++) {
        for (let col = 0; col < rect.w; col++) {
          const srcIdx = row * rect.w + col
          const dstIdx = (rect.y + row) * maskW + (rect.x + col)
          store.maskData.data[dstIdx] = maskSrc[srcIdx * 4]
        }
      }

      // 2. Incremental composite: only redraw the dirty rect
      compositeCtx!.clearRect(rect.x, rect.y, rect.w, rect.h)
      compositeCtx!.drawImage(srcImg, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h)

      const regionData = compositeCtx!.getImageData(rect.x, rect.y, rect.w, rect.h)
      const pixels = regionData.data
      for (let row = 0; row < rect.h; row++) {
        for (let col = 0; col < rect.w; col++) {
          const maskIdx = (rect.y + row) * maskW + (rect.x + col)
          pixels[(row * rect.w + col) * 4 + 3] = store.maskData.data[maskIdx]
        }
      }
      compositeCtx!.putImageData(regionData, rect.x, rect.y)
    }
    dirtyRects = []

    store.setResultCanvas(compositeCanvas!)
    triggerDisplayUpdate()
  }

  function syncMaskFromCanvas() {
    if (!maskCtx || !maskCanvas || !store.maskData) return
    const imgData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
    const newData = new Uint8ClampedArray(maskCanvas.width * maskCanvas.height)
    for (let i = 0; i < newData.length; i++) {
      newData[i] = imgData.data[i * 4]
    }
    store.maskData = { width: maskCanvas.width, height: maskCanvas.height, data: newData }
  }

  function triggerDisplayUpdate() {
    const displayCanvas = displayCanvasRef.value
    if (displayCanvas) {
      displayCanvas.dispatchEvent(new CustomEvent('matting-display-update'))
    }
  }

  /**
   * Full recomposite: used when initializing or edge sliders change
   */
  function updateDisplay() {
    if (!store.sourceImage || !store.maskData) return

    let mask = store.maskData.data

    if (store.edgeSettings.feather > 0 || store.edgeSettings.expand > 0 || store.edgeSettings.contract > 0) {
      mask = applyEdgeRefinements(
        mask,
        store.maskData.width,
        store.maskData.height,
        store.edgeSettings.expand,
        store.edgeSettings.contract,
        store.edgeSettings.feather,
      )
    }

    const resultCanvas = compositeResult(
      store.sourceImage,
      mask,
      store.maskData.width,
      store.maskData.height,
    )
    store.setResultCanvas(resultCanvas)

    // Keep persistent canvas in sync
    if (compositeCanvas && compositeCtx) {
      compositeCtx.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height)
      compositeCtx.drawImage(resultCanvas, 0, 0)
    } else {
      compositeCanvas = resultCanvas
      compositeCtx = resultCanvas.getContext('2d')!
    }

    triggerDisplayUpdate()
  }

  function refineEdges() {
    if (!store.maskData) return
    compositeCanvas = null
    compositeCtx = null
    updateDisplay()
  }

  return {
    startBrush,
    moveBrush,
    endBrush,
    undoMaskEdit,
    refineEdges,
    saveMaskSnapshot,
    updateDisplay,
  }
}
