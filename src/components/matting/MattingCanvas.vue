<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
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

const { startBrush, moveBrush, endBrush, undoMaskEdit, refineEdges } = useMaskEditing(canvasRef)

let resizeObserver: ResizeObserver | null = null

function drawCheckerboard(ctx: CanvasRenderingContext2D, w: number, h: number, size = 12) {
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#2a2a3a' : '#353545'
      ctx.fillRect(x, y, size, size)
    }
  }
}

function computeImageBounds(containerW: number, containerH: number) {
  if (!store.sourceImage) return
  const img = store.sourceImage
  const maxW = containerW * 0.9
  const maxH = containerH * 0.9
  let drawW = img.naturalWidth
  let drawH = img.naturalHeight
  const scale = Math.min(maxW / drawW, maxH / drawH, 1)
  drawW *= scale
  drawH *= scale
  imageBounds = {
    dx: (containerW - drawW) / 2,
    dy: (containerH - drawH) / 2,
    drawW,
    drawH,
    scale,
  }
}

function screenToImage(canvasX: number, canvasY: number): { x: number; y: number } | null {
  const { dx, dy, drawW, drawH, scale } = imageBounds
  const relX = (canvasX - dx) / scale
  const relY = (canvasY - dy) / scale
  if (relX < 0 || relX >= drawW / scale || relY < 0 || relY >= drawH / scale) {
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
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
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

    // Brush preview ring (shows mode + size visually)
    if (showBrushCursor.value && (store.stage === 'mask_editing' || store.stage === 'done')) {
      const { x, y } = mouseCanvasPos.value
      const brushRadius = store.brush.size / 2
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

    // Processing overlay
    if (store.isProcessing) {
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
      ctx.fillText(store.progress.message, cx, cy + 12)

      // Progress bar
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

// Mouse event handlers for brush editing
function getCanvasPos(e: MouseEvent): { x: number; y: number } {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function handleMouseDown(e: MouseEvent) {
  if (store.stage !== 'mask_editing' && store.stage !== 'done') return
  if (e.button !== 0) return
  const pos = getCanvasPos(e)
  const imgPos = screenToImage(pos.x, pos.y)
  if (!imgPos) return
  isMouseDown.value = true
  startBrush(imgPos.x, imgPos.y)
}

function handleMouseMove(e: MouseEvent) {
  const pos = getCanvasPos(e)
  mouseCanvasPos.value = pos
  const imgPos = screenToImage(pos.x, pos.y)
  showBrushCursor.value = imgPos !== null && (store.stage === 'mask_editing' || store.stage === 'done')
  if (showBrushCursor.value) requestAnimationFrame(render)
  if (isMouseDown.value && imgPos) {
    moveBrush(imgPos.x, imgPos.y)
  }
}

function handleMouseUp() {
  if (isMouseDown.value) {
    endBrush()
    isMouseDown.value = false
  }
}

function handleMouseLeave() {
  showBrushCursor.value = false
  if (isMouseDown.value) {
    endBrush()
    isMouseDown.value = false
  }
}

onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => render())
    resizeObserver.observe(containerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(processingAnimFrame)
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

// Continuous render loop for spinner animation during processing
let processingAnimFrame = 0
watch(
  () => store.isProcessing,
  (processing) => {
    if (processing) {
      const loop = () => {
        if (!store.isProcessing) return
        render()
        processingAnimFrame = requestAnimationFrame(loop)
      }
      processingAnimFrame = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(processingAnimFrame)
    }
  },
)

defineExpose({ render, undoMaskEdit })
</script>

<template>
  <div ref="containerRef" class="matting-canvas-wrap">
    <canvas
      ref="canvasRef"
      class="matting-preview-canvas"
      :class="{
        'brush-cursor-keep': showBrushCursor && store.brush.mode === 'keep' && store.stage === 'mask_editing',
        'brush-cursor-remove': showBrushCursor && store.brush.mode === 'remove' && store.stage === 'mask_editing',
      }"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseLeave"
    />
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
</style>
