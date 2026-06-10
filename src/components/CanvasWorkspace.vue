<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'

function raf(fn: () => void) { requestAnimationFrame(fn) }
import { storeToRefs } from 'pinia'
import { useCanvasEngine } from '../composables/useCanvasEngine'
import { useEditorStore } from '../stores/editor'
import { useHistoryStore } from '../stores/history'
import { nextRegionName } from '../composables/shapeUtils'
import { createDefaultGridGroup } from '../composables/useGridGroups'
import {
  buildImportFeedback,
  getEditorLayerPixels,
  loadImageFromFile,
  validateEditorImageFiles,
  validateImageBeforeLayerAdd,
} from '../utils/editorImageImport'
import type { CropRegion } from '../types'

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const hrulerRef = ref<HTMLCanvasElement | null>(null)
const vrulerRef = ref<HTMLCanvasElement | null>(null)

const editor = useEditorStore()
const history = useHistoryStore()
const {
  regions, gridGroups, selectedRegionId, selectedGridGroupId, selectedRegionIds, selectedGridGroupIds, activeTool,
  brushSettings, eraserSettings,
  textAnnotations, selectedTextId,
  constrainToImage, isSingleLayerMode, magicWandTolerance, showOriginal,
  layers, activeLayerId, canvasVersion,
  hGuides, vGuides, selectedLayerIds, isHeavyProcessing, heavyProcessingText,
} = storeToRefs(editor)

const engine = useCanvasEngine(
  canvasRef, containerRef,
  regions.value, gridGroups.value, selectedRegionId, selectedGridGroupId, selectedRegionIds, selectedGridGroupIds,
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
const RULER_BG = '#1a1a17'
const RULER_TICK = '#4a483f'
const RULER_TEXT = '#8f897c'
const GUIDE_COLOR = '#66d99a'
const GUIDE_ACTIVE = '#35d97f'
const GUIDE_HANDLE_FILL = '#181914'
const GUIDE_HANDLE = 7
const zoomPercent = computed(() => `${Math.round(engine.view.scale * 100)}%`)

type GuideDragState = {
  axis: 'h' | 'v'
  index: number
  altKey: boolean
}
const draggingGuide = ref<GuideDragState | null>(null)

function drawGuideHandle(
  ctx: CanvasRenderingContext2D,
  axis: 'h' | 'v',
  pos: number,
  dpr: number,
  isActive: boolean,
) {
  const edge = (RULER - 2) * dpr
  const side = GUIDE_HANDLE * 1.45 * dpr
  const half = side / 2
  const triH = (Math.sqrt(3) / 2) * side
  const rectH = 4 * dpr

  ctx.save()
  ctx.fillStyle = isActive ? 'rgba(40, 199, 111, 0.18)' : GUIDE_HANDLE_FILL
  ctx.strokeStyle = isActive ? GUIDE_ACTIVE : GUIDE_COLOR
  ctx.lineWidth = isActive ? 1.5 * dpr : 1 * dpr
  ctx.lineJoin = 'round'

  ctx.beginPath()
  if (axis === 'v') {
    const apexY = edge
    const triTopY = apexY - triH
    const rectTopY = triTopY - rectH
    ctx.rect(pos - half, rectTopY, side, rectH)
    ctx.moveTo(pos, apexY)
    ctx.lineTo(pos - half, triTopY)
    ctx.lineTo(pos + half, triTopY)
  } else {
    const apexX = edge
    const triLeftX = apexX - triH
    const rectLeftX = triLeftX - rectH
    ctx.rect(rectLeftX, pos - half, rectH, side)
    ctx.moveTo(apexX, pos)
    ctx.lineTo(triLeftX, pos - half)
    ctx.lineTo(triLeftX, pos + half)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  if (isActive) {
    ctx.beginPath()
    ctx.arc(
      axis === 'v' ? pos : edge - triH * 0.42,
      axis === 'v' ? edge - triH * 0.42 : pos,
      2 * dpr,
      0,
      Math.PI * 2,
    )
    ctx.fillStyle = GUIDE_ACTIVE
    ctx.fill()
  }
  ctx.restore()
}

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
  vctx.fillStyle = RULER_BG
  vctx.fillRect(0, 0, vc.width, vc.height)

  // --- horizontal (top) ruler ---
  hc.width = canvasRef.value?.width ?? 0
  hc.height = RULER * dpr
  hc.style.width = (hc.width / dpr) + 'px'
  hc.style.height = RULER + 'px'
  const hctx = hc.getContext('2d')!
  hctx.clearRect(0, 0, hc.width, hc.height)
  hctx.fillStyle = RULER_BG
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
  hctx.strokeStyle = RULER_TICK
  hctx.lineWidth = 0.5
  hctx.fillStyle = RULER_TEXT
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

  for (let i = 0; i < editor.vGuides.length; i++) {
    const x = editor.vGuides[i]
    const sx = (x - view.offsetX) * view.scale
    if (sx < -GUIDE_HANDLE * dpr || sx > hwRuler + GUIDE_HANDLE * dpr) continue
    const isActive = editor.activeGuide?.axis === 'v' && editor.activeGuide.index === i
    drawGuideHandle(hctx, 'v', sx, dpr, isActive)
  }

  // --- draw left ruler (Y axis) — native buffer pixels, no DPR scale ---
  vctx.font = `bold ${10 * dpr}px sans-serif`
  vctx.textAlign = 'right'
  vctx.textBaseline = 'middle'
  vctx.strokeStyle = RULER_TICK
  vctx.lineWidth = 0.5
  vctx.fillStyle = RULER_TEXT
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

  for (let i = 0; i < editor.hGuides.length; i++) {
    const y = editor.hGuides[i]
    const sy = (y - view.offsetY) * view.scale
    if (sy < -GUIDE_HANDLE * dpr || sy > vhRuler + GUIDE_HANDLE * dpr) continue
    const isActive = editor.activeGuide?.axis === 'h' && editor.activeGuide.index === i
    drawGuideHandle(vctx, 'h', sy, dpr, isActive)
  }
}

// Redraw rulers whenever the view changes — use RAF to sync with engine render
watch(
  () => [engine.view.image, engine.view.scale, engine.view.offsetX, engine.view.offsetY],
  () => raf(drawRulers),
  { deep: true },
)

watch(regions, () => engine.scheduleRender(), { deep: true })
watch(gridGroups, () => engine.scheduleRender(), { deep: true })
watch(textAnnotations, () => engine.scheduleRender(), { deep: true })

// Trigger ruler redraw when layers change
watch(layers, () => raf(drawRulers), { deep: true })
watch([hGuides, vGuides], () => raf(drawRulers), { deep: true })
watch(() => editor.activeGuide, () => raf(drawRulers), { deep: true })

function selectRegion(id: string) { engine.selectRegion(id) }
function selectGridGroup(id: string) { engine.selectGridGroup(id) }
function selectText(id: string) { engine.selectText(id) }

function deleteRegion(id: string) {
  history.snapshot()
  editor.deleteRegion(id)
  engine.scheduleRender()
}

function deleteGridGroup(id: string) {
  history.snapshot()
  editor.deleteGridGroup(id)
  engine.scheduleRender()
}

function deleteText(id: string) {
  history.snapshot()
  editor.deleteText(id)
  engine.scheduleRender()
}

function copySelectedRegion() { engine.copySelectedRegion() }
function pasteRegion() { engine.pasteRegion() }

function createDefaultNGrid() {
  if (!editor.imageLoaded) return
  history.snapshot()
  const group = createDefaultGridGroup(editor.activeLayer)
  editor.gridGroups.push(group)
  editor.selectGridGroup(group.id)
  engine.scheduleRender()
}

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

  const layerW = layer.image.naturalWidth * layer.scaleX
  const layerH = layer.image.naturalHeight * layer.scaleY
  const rectW = preset.width
  const rectH = preset.height

  // 单图层 + 启用约束时：裁剪框不能超出图片边界
  const shouldConstrain = editor.isSingleLayerMode && editor.constrainToImage
  let rectX = Math.round(layer.x + (layerW - rectW) / 2)
  let rectY = Math.round(layer.y + (layerH - rectH) / 2)
  if (shouldConstrain && rectW <= layerW) {
    rectX = Math.max(layer.x, Math.min(rectX, layer.x + layerW - rectW))
  }
  if (shouldConstrain && rectH <= layerH) {
    rectY = Math.max(layer.y, Math.min(rectY, layer.y + layerH - rectH))
  }

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
  selectRegion, selectGridGroup, selectText,
  deleteRegion, deleteGridGroup, deleteText,
  loadImage: engine.loadImage,
  copySelectedRegion, pasteRegion,
  fitToCanvas: engine.fitToCanvas,
  cancelCustomPolygon: engine.cancelCustomPolygon,
  finalizeCustomPolygon: engine.finalizeCustomPolygon,
  scheduleRender: engine.scheduleRender,
  createPresetRegion,
  createDefaultNGrid,
})

function handleDragOver(e: DragEvent) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' }
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  const check = validateEditorImageFiles(Array.from(files), editor.layers.length)
  const rejected = [...check.rejected]
  const warnings = [...check.warnings]
  let addedCount = 0

  for (const file of check.accepted) {
    try {
      const img = await loadImageFromFile(file)
      const layerCheck = validateImageBeforeLayerAdd(img, getEditorLayerPixels(editor.layers), file.name)
      if (!layerCheck.ok) {
        rejected.push(layerCheck.message)
        continue
      }
      if (layerCheck.message) warnings.push(layerCheck.message)
      editor.addLayer(img, file.name)
      addedCount++
    } catch (err) {
      rejected.push(err instanceof Error ? err.message : `${file.name}: 图片解码失败`)
    }
  }
  if (addedCount > 0) engine.fitToCanvas()

  const feedback = buildImportFeedback(rejected, [...new Set(warnings)])
  if (feedback) window.alert(feedback)
}

// ---- ruler clicks → guide lines ----
function hitGuideHandle(e: MouseEvent, axis: 'h' | 'v') {
  const target = e.target as HTMLElement
  const rect = target.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const threshold = Math.max(8, GUIDE_HANDLE + 4) * dpr
  if (axis === 'h') {
    const sx = (e.clientX - rect.left) * dpr
    for (let i = editor.vGuides.length - 1; i >= 0; i--) {
      const guideSx = (editor.vGuides[i] - engine.view.offsetX) * engine.view.scale
      if (Math.abs(sx - guideSx) <= threshold) return { axis: 'v' as const, index: i }
    }
  } else {
    const sy = (e.clientY - rect.top) * dpr
    for (let i = editor.hGuides.length - 1; i >= 0; i--) {
      const guideSy = (editor.hGuides[i] - engine.view.offsetY) * engine.view.scale
      if (Math.abs(sy - guideSy) <= threshold) return { axis: 'h' as const, index: i }
    }
  }
  return null
}

function objectSnapTargets(axis: 'h' | 'v') {
  const targets: number[] = []
  const addBounds = (x: number, y: number, width: number, height: number) => {
    if (axis === 'v') {
      targets.push(x, x + width / 2, x + width)
    } else {
      targets.push(y, y + height / 2, y + height)
    }
  }
  for (const layer of editor.layers) {
    if (!layer.visible) continue
    addBounds(
      layer.x,
      layer.y,
      layer.image.naturalWidth * layer.scaleX,
      layer.image.naturalHeight * layer.scaleY,
    )
  }
  for (const region of editor.regions) addBounds(region.x, region.y, region.width, region.height)
  for (const group of editor.gridGroups) addBounds(group.x, group.y, group.width, group.height)
  for (const text of editor.textAnnotations) addBounds(text.x, text.y, text.width, text.height)
  return targets
}

function snapGuideValue(value: number, axis: 'h' | 'v', altKey: boolean) {
  if (!editor.snapToGuides || altKey) return value
  const threshold = 8 / engine.view.scale
  let bestValue = value
  let bestDistance = threshold
  for (const target of objectSnapTargets(axis)) {
    const distance = Math.abs(target - value)
    if (distance <= bestDistance) {
      bestDistance = distance
      bestValue = target
    }
  }
  return bestValue
}

function guideValueFromMouse(e: MouseEvent, axis: 'h' | 'v') {
  const canvas = canvasRef.value
  if (!canvas) return 0
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  if (axis === 'v') {
    const sx = (e.clientX - rect.left) * dpr
    return sx / engine.view.scale + engine.view.offsetX
  }
  const sy = (e.clientY - rect.top) * dpr
  return sy / engine.view.scale + engine.view.offsetY
}

function updateDraggingGuide(e: MouseEvent) {
  const drag = draggingGuide.value
  if (!drag) return
  const value = snapGuideValue(guideValueFromMouse(e, drag.axis), drag.axis, e.altKey)
  if (drag.axis === 'v') editor.moveVGuide(drag.index, value)
  else editor.moveHGuide(drag.index, value)
  raf(drawRulers)
}

function stopDraggingGuide() {
  if (!draggingGuide.value) return
  draggingGuide.value = null
  editor.sortGuides()
  raf(drawRulers)
  window.removeEventListener('mousemove', updateDraggingGuide)
  window.removeEventListener('mouseup', stopDraggingGuide)
}

function startGuideDrag(e: MouseEvent, axis: 'h' | 'v') {
  const hit = hitGuideHandle(e, axis)
  if (!hit) return false
  e.preventDefault()
  history.snapshot()
  draggingGuide.value = { axis: hit.axis, index: hit.index, altKey: e.altKey }
  editor.activeGuide = {
    axis: hit.axis,
    index: hit.index,
    value: hit.axis === 'v' ? editor.vGuides[hit.index] : editor.hGuides[hit.index],
  }
  updateDraggingGuide(e)
  window.addEventListener('mousemove', updateDraggingGuide)
  window.addEventListener('mouseup', stopDraggingGuide)
  return true
}

function handleRulerMove(e: MouseEvent, axis: 'h' | 'v') {
  if (draggingGuide.value) return
  const hit = hitGuideHandle(e, axis)
  const target = e.target as HTMLCanvasElement
  if (hit) {
    target.style.cursor = hit.axis === 'v' ? 'ew-resize' : 'ns-resize'
    editor.activeGuide = {
      axis: hit.axis,
      index: hit.index,
      value: hit.axis === 'v' ? editor.vGuides[hit.index] : editor.hGuides[hit.index],
    }
  } else {
    target.style.cursor = 'default'
    if (editor.activeGuide) editor.activeGuide = null
  }
  raf(drawRulers)
  engine.scheduleRender()
}

function handleRulerLeave(e: MouseEvent) {
  const target = e.target as HTMLCanvasElement
  target.style.cursor = 'default'
  if (draggingGuide.value) return
  if (editor.activeGuide) {
    editor.activeGuide = null
    raf(drawRulers)
    engine.scheduleRender()
  }
}

function handleRulerClick(e: MouseEvent, axis: 'h' | 'v') {
  if (startGuideDrag(e, axis)) return
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
onBeforeUnmount(() => {
  stopDraggingGuide()
  engine.destroy()
})
</script>

<template>
  <div class="workspace-outer">
    <div class="ruler-corner" />
    <canvas
      ref="hrulerRef"
      class="ruler-h"
      @mousedown="handleRulerClick($event, 'h')"
      @mousemove="handleRulerMove($event, 'h')"
      @mouseleave="handleRulerLeave"
    />
    <canvas
      ref="vrulerRef"
      class="ruler-v"
      @mousedown="handleRulerClick($event, 'v')"
      @mousemove="handleRulerMove($event, 'v')"
      @mouseleave="handleRulerLeave"
    />
    <main ref="containerRef" class="workspace" @dragover="handleDragOver" @drop="handleDrop">
      <canvas ref="canvasRef" class="canvas" />
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
      <div v-if="editor.imageLoaded" class="view-controls" aria-label="画布视图控制">
        <button class="view-btn" title="居中活动图层 (Shift+2)" @click="engine.centerActiveLayer()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v4" />
            <path d="M12 17v4" />
            <path d="M3 12h4" />
            <path d="M17 12h4" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </button>
        <button class="view-btn" title="适应全部内容 (Shift+1)" @click="engine.fitAllLayersToViewport()">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9V4h5" />
            <path d="M20 9V4h-5" />
            <path d="M4 15v5h5" />
            <path d="M20 15v5h-5" />
          </svg>
        </button>
        <button class="zoom-btn" title="恢复 100% (Shift+0)" @click="engine.resetZoomTo100()">{{ zoomPercent }}</button>
      </div>
    </main>
    <Teleport to="body">
      <div v-if="isHeavyProcessing" class="heavy-loading-overlay">
        <span class="heavy-loading-text">{{ heavyProcessingText || '处理中...' }}</span>
      </div>
    </Teleport>
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
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
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
  background: var(--bg-canvas);
}
.canvas { display: block; width: 100%; height: 100%; }
.drop-hint { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; color: var(--text-muted); gap: 8px; }
.drop-icon { font-size: 42px; font-weight: 100; color: var(--border-strong); width: 76px; height: 76px; border: 1px dashed var(--border-strong); border-radius: 6px; display: flex; align-items: center; justify-content: center; background: rgba(17, 17, 15, 0.48); }
.drop-formats { font-size: 11px; color: var(--text-muted); }

.show-original-toggle {
  position: absolute; bottom: 10px; left: 12px;
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

.view-controls {
  position: absolute; right: 12px; bottom: 10px; z-index: 11;
  display: flex; align-items: center; gap: 4px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(17, 17, 15, 0.82);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(8px);
}
.view-btn,
.zoom-btn {
  height: 28px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.view-btn {
  width: 30px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0;
}
.view-btn svg {
  width: 15px; height: 15px;
  fill: none; stroke: currentColor; stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
}
.zoom-btn {
  min-width: 50px;
  padding: 0 8px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.view-btn:hover,
.zoom-btn:hover {
  border-color: rgba(40, 199, 111, 0.42);
  color: var(--accent);
  background: rgba(40, 199, 111, 0.08);
}

.heavy-loading-overlay {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.42); z-index: 99990; pointer-events: all;
}
.heavy-loading-text {
  padding: 12px 24px; background: rgba(0,0,0,0.75);
  border-radius: var(--radius); color: var(--accent); font-size: 14px;
}
</style>
