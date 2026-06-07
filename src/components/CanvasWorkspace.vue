<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

function raf(fn: () => void) { requestAnimationFrame(fn) }
import { storeToRefs } from 'pinia'
import { useCanvasEngine } from '../composables/useCanvasEngine'
import { useEditorStore } from '../stores/editor'
import { useHistoryStore } from '../stores/history'
import { nextRegionName } from '../composables/shapeUtils'
import type { CropRegion } from '../types'

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const hrulerRef = ref<HTMLCanvasElement | null>(null)
const vrulerRef = ref<HTMLCanvasElement | null>(null)

const editor = useEditorStore()
const history = useHistoryStore()
const {
  regions, selectedRegionId, selectedRegionIds, activeTool,
  brushSettings, eraserSettings,
  textAnnotations, selectedTextId,
  constrainToImage, isSingleLayerMode, magicWandTolerance, showOriginal,
  layers, activeLayerId, canvasVersion,
  hGuides, vGuides, selectedLayerIds, isHeavyProcessing,
} = storeToRefs(editor)

const engine = useCanvasEngine(
  canvasRef, containerRef,
  regions.value, selectedRegionId, selectedRegionIds,
  activeTool,
  brushSettings, eraserSettings,
  textAnnotations.value, selectedTextId,
  constrainToImage,
  isSingleLayerMode,
  magicWandTolerance,
  showOriginal,
  layers, activeLayerId,
  canvasVersion,
  hGuides, vGuides,
  selectedLayerIds,
  isHeavyProcessing,
  editor.removeHGuide, editor.removeVGuide,
  history.snapshot,
)

const RULER = 28

function drawRulers() {
  const vc = vrulerRef.value
  const hc = hrulerRef.value
  if (!vc || !hc) return

  const dpr = window.devicePixelRatio || 1
  const view = engine.view

  // --- vertical (left) ruler ---
  vc.width = RULER * dpr
  vc.height = canvasRef.value?.height ?? 0
  vc.style.width = RULER + 'px'
  vc.style.height = (vc.height / dpr) + 'px'
  const vctx = vc.getContext('2d')!
  vctx.clearRect(0, 0, vc.width, vc.height)
  vctx.fillStyle = '#1a1a2e'
  vctx.fillRect(0, 0, vc.width, vc.height)

  // --- horizontal (top) ruler ---
  hc.width = canvasRef.value?.width ?? 0
  hc.height = RULER * dpr
  hc.style.width = (hc.width / dpr) + 'px'
  hc.style.height = RULER + 'px'
  const hctx = hc.getContext('2d')!
  hctx.clearRect(0, 0, hc.width, hc.height)
  hctx.fillStyle = '#1a1a2e'
  hctx.fillRect(0, 0, hc.width, hc.height)

  if (!editor.imageLoaded) return

  // --- tick interval ---
  const targetTickSpacing = 80
  const rawInterval = targetTickSpacing / view.scale
  const mag = Math.pow(10, Math.floor(Math.log10(rawInterval)))
  const residual = rawInterval / mag
  let tickInterval: number
  if (residual < 1.5) tickInterval = mag
  else if (residual < 3.5) tickInterval = 2 * mag
  else if (residual < 7.5) tickInterval = 5 * mag
  else tickInterval = 10 * mag
  if (tickInterval < 1) tickInterval = 1

  // --- draw top ruler (X axis) — native buffer pixels, no DPR scale ---
  hctx.font = `bold ${10 * dpr}px sans-serif`
  hctx.textAlign = 'center'
  hctx.textBaseline = 'top'
  hctx.strokeStyle = '#999'
  hctx.lineWidth = 0.5
  hctx.fillStyle = '#ccc'
  const startX = Math.floor(view.offsetX / tickInterval) * tickInterval
  const hwRuler = hc.width
  for (let ix = startX; ix <= view.offsetX + hwRuler / view.scale; ix += tickInterval) {
    const sx = (ix - view.offsetX) * view.scale
    if (sx < 0 || sx > hwRuler) continue
    hctx.beginPath()
    hctx.moveTo(sx, 0)
    hctx.lineTo(sx, RULER * dpr * 0.55)
    hctx.stroke()
    hctx.fillText(String(Math.round(ix)), sx, RULER * dpr * 0.58)
  }

  // --- draw left ruler (Y axis) — native buffer pixels, no DPR scale ---
  vctx.font = `bold ${10 * dpr}px sans-serif`
  vctx.textAlign = 'right'
  vctx.textBaseline = 'middle'
  vctx.strokeStyle = '#999'
  vctx.lineWidth = 0.5
  vctx.fillStyle = '#ccc'
  const startY = Math.floor(view.offsetY / tickInterval) * tickInterval
  const vhRuler = vc.height
  for (let iy = startY; iy <= view.offsetY + vhRuler / view.scale; iy += tickInterval) {
    const sy = (iy - view.offsetY) * view.scale
    if (sy < 0 || sy > vhRuler) continue
    vctx.beginPath()
    vctx.moveTo(0, sy)
    vctx.lineTo(RULER * dpr * 0.55, sy)
    vctx.stroke()
    vctx.fillText(String(Math.round(iy)), RULER * dpr - 6 * dpr, sy)
  }
}

// Redraw rulers whenever the view changes — use RAF to sync with engine render
watch(
  () => [engine.view.image, engine.view.scale, engine.view.offsetX, engine.view.offsetY],
  () => raf(drawRulers),
  { deep: true },
)

watch(regions, () => engine.scheduleRender(), { deep: true })
watch(textAnnotations, () => engine.scheduleRender(), { deep: true })

// Trigger ruler redraw when layers change
watch(layers, () => raf(drawRulers), { deep: true })

function selectRegion(id: string) { engine.selectRegion(id) }
function selectText(id: string) { engine.selectText(id) }

function deleteRegion(id: string) {
  history.snapshot()
  editor.deleteRegion(id)
  engine.scheduleRender()
}

function deleteText(id: string) {
  history.snapshot()
  editor.deleteText(id)
  engine.scheduleRender()
}

function copySelectedRegion() { engine.copySelectedRegion() }
function pasteRegion() { engine.pasteRegion() }

interface PresetCropSizeInput {
  id: string
  name: string
  width: number
  height: number
}

function createPresetRegion(preset: PresetCropSizeInput) {
  // 自由裁剪：不创建预设，切换到矩形工具让用户手动绘制
  if (preset.width === 0 || preset.height === 0) {
    editor.setTool('rect')
    return
  }

  const layer = editor.activeLayer
  if (!layer) return

  const imgW = layer.image.naturalWidth
  const imgH = layer.image.naturalHeight

  // 宽度与图层宽度对齐，高度等比例缩放
  let rectW = imgW
  let rectH = Math.round(imgW * (preset.height / preset.width))

  // 单图层 + 启用约束时：裁剪框不能超出图片边界
  const shouldConstrain = editor.isSingleLayerMode && editor.constrainToImage
  if (shouldConstrain && rectH > imgH) {
    rectH = imgH
    rectW = Math.round(imgH * (preset.width / preset.height))
  }

  // 水平中线与图层水平中线对齐
  const rectX = 0
  const rectY = shouldConstrain
    ? Math.max(0, Math.round((imgH - rectH) / 2))
    : Math.round((imgH - rectH) / 2)

  history.snapshot()
  const region: CropRegion = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: nextRegionName(),
    x: rectX,
    y: rectY,
    width: rectW,
    height: rectH,
    shape: 'rect',
  }
  editor.regions.push(region)
  editor.selectRegion(region.id)
  engine.scheduleRender()
}

defineExpose({
  selectRegion, selectText,
  deleteRegion, deleteText,
  loadImage: engine.loadImage,
  copySelectedRegion, pasteRegion,
  cancelCustomPolygon: engine.cancelCustomPolygon,
  finalizeCustomPolygon: engine.finalizeCustomPolygon,
  scheduleRender: engine.scheduleRender,
  createPresetRegion,
})

function handleDragOver(e: DragEvent) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' }
function handleDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file.type.startsWith('image/')) continue
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => { editor.addLayer(img); engine.fitToCanvas() }
      img.src = ev.target?.result as string
    }
    reader.readAsDataURL(file)
  }
}

// ---- ruler clicks → guide lines ----
function handleRulerClick(e: MouseEvent, axis: 'h' | 'v') {
  if (!(e.ctrlKey || e.metaKey)) return
  const canvas = canvasRef.value!
  const dpr = window.devicePixelRatio || 1
  const view = engine.view
  if (axis === 'h') {
    // top ruler clicked → vertical guide at x in world coords
    const sx = (e.clientX - (e.target as HTMLElement).getBoundingClientRect().left) * dpr
    const x = Math.round(sx / view.scale + view.offsetX)
    editor.addVGuide(x)
  } else {
    // left ruler clicked → horizontal guide at y in world coords
    const sy = (e.clientY - (e.target as HTMLElement).getBoundingClientRect().top) * dpr
    const y = Math.round(sy / view.scale + view.offsetY)
    editor.addHGuide(y)
  }
}

// ResizeObserver for main canvas
onMounted(() => {
  engine.initCanvas()
  raf(drawRulers)
  if (containerRef.value) {
    const ro = new ResizeObserver(() => raf(drawRulers))
    ro.observe(containerRef.value)
  }
})
onBeforeUnmount(() => engine.destroy())
</script>

<template>
  <div class="workspace-outer">
    <div class="ruler-corner" />
    <canvas ref="hrulerRef" class="ruler-h" @mousedown="handleRulerClick($event, 'h')" />
    <canvas ref="vrulerRef" class="ruler-v" @mousedown="handleRulerClick($event, 'v')" />
    <main ref="containerRef" class="workspace" @dragover="handleDragOver" @drop="handleDrop">
      <canvas ref="canvasRef" class="canvas" />
      <div v-if="isHeavyProcessing" class="heavy-loading-overlay">
        <span class="heavy-loading-text">处理中...</span>
      </div>
      <div v-if="!editor.imageLoaded" class="drop-hint">
        <div class="drop-icon">+</div>
        <div>拖拽图片到此处或点击上传</div>
        <div class="drop-formats">支持 PNG / JPG / WebP 格式</div>
      </div>
      <label v-if="editor.imageLoaded" class="show-original-toggle">
        <input type="checkbox" v-model="editor.showOriginal" />
        <span class="toggle-track">
          <span class="toggle-thumb"></span>
        </span>
        <span class="toggle-label">原图</span>
      </label>
    </main>
  </div>
</template>

<style scoped>
.workspace-outer {
  flex: 1;
  display: grid;
  grid-template-columns: 28px 1fr;
  grid-template-rows: 28px 1fr;
  overflow: hidden;
  background: var(--bg-primary);
}
.ruler-corner {
  grid-column: 1; grid-row: 1;
  background: #1a1a2e;
}
.ruler-h {
  grid-column: 2; grid-row: 1;
  display: block;
}
.ruler-v {
  grid-column: 1; grid-row: 2;
  display: block;
}
.workspace {
  grid-column: 2; grid-row: 2;
  position: relative;
  overflow: hidden;
}
.canvas { display: block; width: 100%; height: 100%; }
.drop-hint { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; color: var(--text-muted); gap: 8px; }
.drop-icon { font-size: 48px; font-weight: 100; color: var(--border); width: 80px; height: 80px; border: 2px dashed var(--border); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.drop-formats { font-size: 11px; color: var(--text-muted); }

.show-original-toggle {
  position: absolute; bottom: 10px; right: 12px;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; user-select: none; z-index: 10;
}
.show-original-toggle input { display: none; }
.toggle-track {
  width: 36px; height: 20px; border-radius: 10px;
  background: rgba(255,255,255,0.15); transition: background 0.2s;
  position: relative; flex-shrink: 0;
}
.show-original-toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb {
  position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: left 0.2s;
}
.show-original-toggle input:checked + .toggle-track .toggle-thumb { left: 18px; }
.toggle-label { font-size: 11px; color: rgba(255,255,255,0.6); }

.heavy-loading-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); z-index: 20; pointer-events: none;
}
.heavy-loading-text {
  padding: 12px 24px; background: rgba(0,0,0,0.75);
  border-radius: var(--radius); color: var(--accent); font-size: 14px;
}
</style>
