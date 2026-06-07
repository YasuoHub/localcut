<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMattingStore } from '../../stores/matting'
import { useMaskEditing } from '../../composables/useMaskEditing'

const store = useMattingStore()
const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isMouseDown = ref(false)
const showBrushCursor = ref(false)
const mouseCanvasPos = ref({ x: 0, y: 0 })

// Track image draw bounds for coordinate conversion
let imageBounds = { dx: 0, dy: 0, drawW: 0, drawH: 0, scale: 1 }
let rendering = false // prevent re-entrant renders

// Zoom & pan state
let zoom = 1
let offsetX = 0
let offsetY = 0
let baseScale = 1
let containerW = 0
let containerH = 0
const isPanning = ref(false)
const spaceHeld = ref(false)
let panStartMouseX = 0
let panStartMouseY = 0
let panStartOffsetX = 0
let panStartOffsetY = 0
const MIN_ZOOM = 0.1
const MAX_ZOOM = 20
const zoomPercent = computed(() => Math.round(imageBounds.scale * 100) + '%')

const { isProcessingEdges, preInit, startBrush, moveBrush, endBrush, undoMaskEdit, redoMaskEdit, refineEdges, destroy: destroyEditor } = useMaskEditing(canvasRef)

let resizeObserver: ResizeObserver | null = null

function resetView() {
  zoom = 1
  offsetX = 0
  offsetY = 0
  requestAnimationFrame(render)
}

function handleResetClick() {
  resetView()
}

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number, size = 12) {
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#2a2a3a' : '#353545'
      ctx.fillRect(x, y, size, size)
    }
  }
}

function computeImageBounds(cw: number, ch: number) {
  if (!store.sourceImage) return
  containerW = cw
  containerH = ch
  const img = store.sourceImage

  // Use working-resolution dimensions when mask exists,
  // so brush coordinates map correctly to the mask canvas.
  const imgW = store.maskData ? store.maskData.width : img.naturalWidth
  const imgH = store.maskData ? store.maskData.height : img.naturalHeight

  baseScale = Math.min(cw / imgW, ch / imgH, 1)
  const scale = baseScale * zoom
  const drawW = imgW * scale
  const drawH = imgH * scale
  const defaultDx = (cw - drawW) / 2
  const defaultDy = (ch - drawH) / 2
  imageBounds = {
    dx: defaultDx + offsetX,
    dy: defaultDy + offsetY,
    drawW,
    drawH,
    scale,
  }
}

function screenToImage(canvasX: number, canvasY: number): { x: number; y: number } | null {
  // Compute display transform directly from store content dimensions,
  // avoiding any dependency on potentially-stale imageBounds.
  if (!containerW || !containerH) return null

  const contentW = store.maskData?.width ?? store.sourceImage?.naturalWidth
  const contentH = store.maskData?.height ?? store.sourceImage?.naturalHeight
  if (!contentW || !contentH) return null

  const contentScale = Math.min(containerW / contentW, containerH / contentH, 1) * zoom
  const contentDrawW = contentW * contentScale
  const contentDrawH = contentH * contentScale
  const contentDx = (containerW - contentDrawW) / 2 + offsetX
  const contentDy = (containerH - contentDrawH) / 2 + offsetY

  const relX = (canvasX - contentDx) / contentScale
  const relY = (canvasY - contentDy) / contentScale

  if (relX < 0 || relX >= contentW || relY < 0 || relY >= contentH) {
    return null
  }
  return { x: Math.round(relX), y: Math.round(relY) }
}

function render() {
  if (rendering) return // prevent re-entrant calls
  rendering = true
  try {
    const canvas = canvasRef.value
    if (!canvas) return
    const container = containerRef.value
    if (!container) return

    const rect = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const newW = rect.width * dpr
    const newH = rect.height * dpr
    // Only resize when dimensions actually changed — avoids expensive buffer reallocation
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW
      canvas.height = newH
    }
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    computeImageBounds(rect.width, rect.height)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, rect.width, rect.height)

    // Background
    ctx.fillStyle = '#0f0f1a'
    ctx.fillRect(0, 0, rect.width, rect.height)

    if (store.stage === 'idle') {
      ctx.fillStyle = '#5a5a70'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('请上传图片或从画布导入', rect.width / 2, rect.height / 2)
      return
    }

    const img = store.sourceImage
    if (!img) return

    const { dx, dy, drawW, drawH } = imageBounds

    if (store.stage === 'mask_editing' || store.stage === 'done') {
      if (store.resultCanvas) {
        // Draw transparent result over checkerboard
        ctx.save()
        ctx.beginPath()
        ctx.rect(dx, dy, drawW, drawH)
        ctx.clip()
        drawCheckerboard(ctx, rect.width, rect.height)
        ctx.restore()
        ctx.drawImage(store.resultCanvas, dx, dy, drawW, drawH)
      } else {
        ctx.drawImage(img, dx, dy, drawW, drawH)
      }
    } else {
      ctx.drawImage(img, dx, dy, drawW, drawH)
    }

    // Brush preview ring (scaled by zoom for visual accuracy)
    if (showBrushCursor.value && (store.stage === 'mask_editing' || store.stage === 'done')) {
      const { x, y } = mouseCanvasPos.value
      const brushRadius = (store.brush.size / 2) * imageBounds.scale
      const isKeep = store.brush.mode === 'keep'
      ctx.beginPath()
      ctx.arc(x, y, brushRadius, 0, Math.PI * 2)
      ctx.strokeStyle = isKeep ? 'rgba(76, 175, 124, 0.85)' : 'rgba(239, 83, 80, 0.85)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fillStyle = isKeep ? 'rgba(76, 175, 124, 0.9)' : 'rgba(239, 83, 80, 0.9)'
      ctx.fill()
    }

    // Zoom indicator (rendered as HTML overlay for proper click handling)

    // Processing overlay
    if (store.isProcessing || isProcessingEdges.value) {
      const cx = rect.width / 2
      const cy = rect.height / 2

      // Darken background
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, rect.width, rect.height)

      // Spinning arc
      const t = performance.now() / 1000
      const arcR = 18
      ctx.beginPath()
      ctx.arc(cx, cy - 28, arcR, t * 3, t * 3 + Math.PI * 1.6)
      ctx.strokeStyle = 'rgba(79, 195, 247, 0.9)'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.stroke()

      // Status text
      ctx.fillStyle = '#fff'
      ctx.font = '600 15px sans-serif'
      ctx.textAlign = 'center'
      if (store.isProcessing) {
        ctx.fillText(store.progress.message, cx, cy + 12)
      } else {
        ctx.fillText('应用边缘精修...', cx, cy + 12)
      }

      // Progress bar (only for model loading/inference)
      if (store.progress.percent > 0) {
        const barW = 200
        const barH = 4
        const barX = cx - barW / 2
        const barY = cy + 30
        ctx.fillStyle = 'rgba(255,255,255,0.15)'
        ctx.fillRect(barX, barY, barW, barH)
        ctx.fillStyle = 'rgba(79, 195, 247, 0.8)'
        ctx.fillRect(barX, barY, barW * (store.progress.percent / 100), barH)
      }

      // Hint
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.font = '11px sans-serif'
      ctx.fillText('处理中，请稍候...', cx, cy + 52)
    }
  } finally {
    rendering = false
  }
}

// Mouse event handlers
function getCanvasPos(e: MouseEvent): { x: number; y: number } {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function handleMouseDown(e: MouseEvent) {
  if (store.stage !== 'mask_editing' && store.stage !== 'done') return

  // Middle button → pan
  if (e.button === 1) {
    e.preventDefault()
    startPan(e)
    return
  }

  // Left button
  if (e.button === 0) {
    // Space+left → pan
    if (spaceHeld.value) {
      startPan(e)
      return
    }
    // Normal left click → brush
    const pos = getCanvasPos(e)
    const imgPos = screenToImage(pos.x, pos.y)
    if (!imgPos) return
    isMouseDown.value = true
    startBrush(imgPos.x, imgPos.y)
  }
}

function handleMouseMove(e: MouseEvent) {
  const pos = getCanvasPos(e)
  mouseCanvasPos.value = pos

  if (isPanning.value) {
    offsetX = panStartOffsetX + (e.clientX - panStartMouseX)
    offsetY = panStartOffsetY + (e.clientY - panStartMouseY)
    requestAnimationFrame(render)
    return
  }

  const imgPos = screenToImage(pos.x, pos.y)
  showBrushCursor.value = imgPos !== null && (store.stage === 'mask_editing' || store.stage === 'done')
  if (isMouseDown.value && imgPos) {
    moveBrush(imgPos.x, imgPos.y)
    // Cursor render deferred to flushBrushEdits → render() — avoids extra rAF hop
  } else if (showBrushCursor.value) {
    requestAnimationFrame(render)
  }
}

function handleMouseUp(e: MouseEvent) {
  if (isPanning.value) {
    endPan()
    return
  }
  if (isMouseDown.value) {
    endBrush()
    isMouseDown.value = false
  }
}

function handleMouseLeave() {
  showBrushCursor.value = false
  if (isPanning.value) {
    endPan()
  }
  if (isMouseDown.value) {
    endBrush()
    isMouseDown.value = false
  }
}

// Pan
function startPan(e: MouseEvent) {
  isPanning.value = true
  panStartMouseX = e.clientX
  panStartMouseY = e.clientY
  panStartOffsetX = offsetX
  panStartOffsetY = offsetY
}

function endPan() {
  isPanning.value = false
}

// Zoom
function handleWheel(e: WheelEvent) {
  if (store.stage !== 'mask_editing' && store.stage !== 'done') return
  e.preventDefault()

  const pos = getCanvasPos(e)
  const { dx, dy, scale: oldScale } = imageBounds

  // Image point under cursor before zoom
  const imgX = (pos.x - dx) / oldScale
  const imgY = (pos.y - dy) / oldScale

  const factor = e.deltaY < 0 ? 1.15 : 0.85
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
  const newScale = baseScale * newZoom

  if (!store.sourceImage) return
  const imgW = store.maskData ? store.maskData.width : store.sourceImage.naturalWidth
  const imgH = store.maskData ? store.maskData.height : store.sourceImage.naturalHeight
  const newDrawW = imgW * newScale
  const newDrawH = imgH * newScale
  const newDefaultDx = (containerW - newDrawW) / 2
  const newDefaultDy = (containerH - newDrawH) / 2

  // Adjust offset so the same image point stays under cursor
  offsetX = pos.x - newDefaultDx - imgX * newScale
  offsetY = pos.y - newDefaultDy - imgY * newScale
  zoom = newZoom

  requestAnimationFrame(render)
}

// Keyboard handlers for space+pan
function handleKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && (store.stage === 'mask_editing' || store.stage === 'done')) {
    // Don't trigger if user is typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    e.preventDefault()
    spaceHeld.value = true
  }
}

function handleKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    spaceHeld.value = false
    if (isPanning.value) {
      endPan()
    }
  }
}

function handleDisplayUpdate() {
  render()
}

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => render())
    resizeObserver.observe(containerRef.value)
  }
  canvasRef.value?.addEventListener('matting-display-update', handleDisplayUpdate)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(processingAnimFrame)
  destroyEditor()
  canvasRef.value?.removeEventListener('matting-display-update', handleDisplayUpdate)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
})

// Debounced edge settings sync (avoids heavy processing on every slider tick)
let edgeDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [() => store.edgeSettings.feather, () => store.edgeSettings.expand, () => store.edgeSettings.contract],
  () => {
    if (store.stage === 'mask_editing' || store.stage === 'done') {
      if (edgeDebounceTimer) clearTimeout(edgeDebounceTimer)
      edgeDebounceTimer = setTimeout(() => refineEdges(), 60)
    }
  },
)

// Watch for major state changes to trigger render
watch(
  [() => store.stage, () => store.sourceImage, () => store.resultCanvas, () => store.progress],
  () => { requestAnimationFrame(render) },
)

// Pre-initialize mask canvases when inference completes,
// so the first brush stroke doesn't pay lazy-init cost.
// Only reset zoom/pan on new inference (maskVersion bump).
let lastMaskVersion = 0
watch(
  () => store.maskData,
  (maskData) => {
    if (maskData) {
      if (store.maskVersion !== lastMaskVersion) {
        lastMaskVersion = store.maskVersion
        resetView()
      }
      requestAnimationFrame(() => preInit())
    }
  },
)

// Continuous render loop for spinner animation during processing
let processingAnimFrame = 0
watch(
  [() => store.isProcessing, isProcessingEdges],
  ([processing, processingEdges]) => {
    if (processing || processingEdges) {
      const loop = () => {
        if (!store.isProcessing && !isProcessingEdges.value) return
        render()
        processingAnimFrame = requestAnimationFrame(loop)
      }
      processingAnimFrame = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(processingAnimFrame)
    }
  },
)

defineExpose({ render, undoMaskEdit, redoMaskEdit })
</script>

<template>
  <div ref="containerRef" class="matting-canvas-wrap">
    <canvas
      ref="canvasRef"
      class="matting-preview-canvas"
      :class="{
        'cursor-grab': spaceHeld && !isPanning,
        'cursor-grabbing': isPanning,
        'brush-cursor-keep': showBrushCursor && store.brush.mode === 'keep' && store.stage === 'mask_editing' && !isPanning && !spaceHeld,
        'brush-cursor-remove': showBrushCursor && store.brush.mode === 'remove' && store.stage === 'mask_editing' && !isPanning && !spaceHeld,
      }"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
      @wheel.prevent="handleWheel"
    />
    <div
      v-if="store.sourceImage && (store.stage === 'mask_editing' || store.stage === 'done')"
      class="zoom-indicator"
      title="点击重置缩放"
      @click="handleResetClick"
    >
      {{ zoomPercent }}
    </div>
  </div>
</template>

<style scoped>
.matting-canvas-wrap {
  flex: 1; overflow: hidden; position: relative; min-height: 0;
  background: #0f0f1a; cursor: default;
}
.matting-preview-canvas { display: block; }
.brush-cursor-keep { cursor: crosshair; }
.brush-cursor-remove { cursor: none; }
.cursor-grab { cursor: grab; }
.cursor-grabbing { cursor: grabbing; }

.zoom-indicator {
  position: absolute; bottom: 8px; right: 8px;
  padding: 3px 10px; border-radius: 4px;
  background: rgba(0,0,0,0.6); color: rgba(255,255,255,0.7);
  font-size: 11px; font-weight: 600; cursor: pointer;
  user-select: none; z-index: 2;
  transition: background 0.15s;
}
.zoom-indicator:hover { background: rgba(0,0,0,0.8); color: #fff; }
</style>
