<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { CropRegion, TextAnnotation, ImageFormat } from '../types'
import { useExport } from '../composables/useExport'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useHistoryStore } from '../stores/history'
import { PLATFORM_PRESETS } from '../constants/platformPresets'
import {
  flipRegionHorizontal, flipRegionVertical,
  rotateRegionLeft90, rotateRegionRight90, rotateRegion,
} from '../composables/useRegionTransform'
import ExportNamingPanel from './right/ExportNamingPanel.vue'
import ExportSizePanel from './right/ExportSizePanel.vue'
import BatchCutPanel from './right/BatchCutPanel.vue'
import TemplatePanel from './right/TemplatePanel.vue'
import PreviewModal from './PreviewModal.vue'
import ImageZoomModal from './ImageZoomModal.vue'

const editor = useEditorStore()
const exp = useExportStore()
const history = useHistoryStore()

const { exportSingleRegion, exportRegions, downloadZip, computeSourcePixelRatio } = useExport()

// Watch platform preset to auto-fill size
watch(() => exp.selectedPlatformPresetId, (id) => {
  if (id) {
    const preset = PLATFORM_PRESETS.find(p => p.id === id)
    if (preset) {
      exp.applyPlatformPreset(preset.width, preset.height)
    }
  }
})

const shapeLabels: Record<string, string> = {
  rect: '矩形', circle: '圆形', triangle: '三角形', diamond: '菱形', star: '星形', heart: '心形', custom: '多边形', roundrect: '圆角矩形',
}
const shapeIcons: Record<string, string> = {
  rect: '▭', circle: '○', triangle: '△', diamond: '◇', star: '☆', heart: '♡', custom: '⬠', roundrect: '▢',
}

// ---- region editing (component-local form state) ----
const editName = ref('')
const editX = ref(0)
const editY = ref(0)
const editWidth = ref(0)
const editHeight = ref(0)
const widthFocused = ref(false)
const heightFocused = ref(false)
const editBorderRadius = ref(0)

function syncFromRegion(r: CropRegion) {
  if (!widthFocused.value) editWidth.value = Math.round(r.width)
  if (!heightFocused.value) editHeight.value = Math.round(r.height)
  editX.value = Math.round(r.x)
  editY.value = Math.round(r.y)
}

watch(() => editor.selectedRegion, (r, old) => {
  if (r) {
    if (r.id !== old?.id) {
      editName.value = r.name
      editX.value = Math.round(r.x)
      editY.value = Math.round(r.y)
      editWidth.value = Math.round(r.width)
      editHeight.value = Math.round(r.height)
      editBorderRadius.value = r.borderRadius ?? Math.round(Math.min(r.width, r.height) * 0.2)
    }
    if (!exp.customOutputSize) {
      exp.exportOutputWidth = Math.round(r.width)
      exp.exportOutputHeight = Math.round(r.height)
    }
  }
}, { immediate: true })

watch(
  () => editor.selectedRegion ? `${editor.selectedRegion.width}|${editor.selectedRegion.height}|${editor.selectedRegion.x}|${editor.selectedRegion.y}` : null,
  () => {
    if (editor.selectedRegion) {
      syncFromRegion(editor.selectedRegion)
      if (!exp.customOutputSize) {
        exp.exportOutputWidth = Math.round(editor.selectedRegion.width)
        exp.exportOutputHeight = Math.round(editor.selectedRegion.height)
      }
    }
  },
)

function updateName() {
  if (!editor.selectedRegion) return
  const name = editName.value.trim()
  if (!name) { editName.value = editor.selectedRegion.name; return }
  if (editor.regions.some(r => r.id !== editor.selectedRegion!.id && r.name === name)) {
    editName.value = editor.selectedRegion.name
    return
  }
  history.snapshot()
  editor.selectedRegion.name = name
}
function updateSize() {
  if (!editor.selectedRegion) return
  const newW = Math.max(1, editWidth.value), newH = Math.max(1, editHeight.value)
  if (newW === Math.round(editor.selectedRegion.width) && newH === Math.round(editor.selectedRegion.height)) return
  history.snapshot()
  editor.selectedRegion.width = newW
  editor.selectedRegion.height = newH
}

function updatePosition() {
  if (!editor.selectedRegion) return
  const newX = editX.value, newY = editY.value
  if (newX === Math.round(editor.selectedRegion.x) && newY === Math.round(editor.selectedRegion.y)) return
  history.snapshot()
  editor.selectedRegion.x = newX
  editor.selectedRegion.y = newY
}

function updateBorderRadius() {
  if (!editor.selectedRegion || editor.selectedRegion.shape !== 'roundrect') return
  const r = Math.max(0, editBorderRadius.value)
  const defaults = Math.round(Math.min(editor.selectedRegion.width, editor.selectedRegion.height) * 0.2)
  history.snapshot()
  editor.selectedRegion.borderRadius = r === defaults ? undefined : r
  editor.invalidateCanvas()
}

function onBorderRadiusInput() {
  if (!editor.selectedRegion || editor.selectedRegion.shape !== 'roundrect') return
  editor.selectedRegion.borderRadius = Math.max(0, editBorderRadius.value)
  editor.invalidateCanvas()
}

// ---- text editing (component-local form state) ----
const editText = ref('')
const editFontSize = ref(44)
const editFontColor = ref('#ffffff')
const editFontWeight = ref<'normal' | 'bold'>('bold')
const textEditSnapshotTaken = ref(false)

watch(() => editor.selectedText, (t, old) => {
  if (t && t.id !== old?.id) {
    editText.value = t.text
    editFontSize.value = t.fontSize
    editFontColor.value = t.fontColor
    editFontWeight.value = t.fontWeight
    textEditSnapshotTaken.value = false
  }
}, { immediate: true })

function ensureTextEditSnapshot() {
  if (!editor.selectedText || textEditSnapshotTaken.value) return
  history.snapshot()
  textEditSnapshotTaken.value = true
}

function applyTextEdits() {
  if (!editor.selectedText) return
  const selectedText = editor.selectedText
  const hasChanged =
    selectedText.text !== editText.value ||
    selectedText.fontSize !== editFontSize.value ||
    selectedText.fontColor !== editFontColor.value ||
    selectedText.fontWeight !== editFontWeight.value
  if (!hasChanged) return

  ensureTextEditSnapshot()
  selectedText.text = editText.value
  selectedText.fontSize = editFontSize.value
  selectedText.fontColor = editFontColor.value
  selectedText.fontWeight = editFontWeight.value
  editor.invalidateCanvas()
}

function commitTextEdits() {
  if (!editor.selectedText) return
  if (editor.selectedText.text.trim()) {
    textEditSnapshotTaken.value = false
    return
  }
  editor.deleteText(editor.selectedText.id)
  textEditSnapshotTaken.value = false
}

// ---- global export state ----
const isExporting = ref(false)
const exportStatusText = ref('')

// ---- single export ----
const exportingSingle = ref(false)
let sharedUpscaleCleanup: (() => void) | null = null

async function createUpscaleFn(): Promise<((canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>) | undefined> {
  if (!exp.upscaleEnabled) return undefined
  const { loadModel, upscaleImage, destroy, progress } = (await import('../composables/useSuperResolution')).useSuperResolution()
  sharedUpscaleCleanup = destroy

  exportStatusText.value = '加载超分模型...'
  await loadModel()
  exportStatusText.value = ''

  // Sync the worker progress ref into status text via polling
  let stopPolling: (() => void) | null = null
  const startPolling = () => {
    const timer = setInterval(() => {
      if (progress.value.message) {
        exportStatusText.value = progress.value.message
      }
    }, 50)
    stopPolling = () => clearInterval(timer)
  }

  return async (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    startPolling()
    try {
      const resultData = await upscaleImage(imgData)
      const result = document.createElement('canvas')
      result.width = resultData.width
      result.height = resultData.height
      result.getContext('2d')!.putImageData(resultData, 0, 0)
      return result
    } finally {
      stopPolling?.()
      stopPolling = null
    }
  }
}

async function handleExportSingle() {
  const region = editor.selectedRegion
  if (!editor.imageLoaded || !region) return
  isExporting.value = true
  exportingSingle.value = true
  exportStatusText.value = '正在导出...'
  try {
    const upscaleFn = await createUpscaleFn()
    await exportSingleRegion(
      editor.layers, region,
      exp.exportFormat, exp.exportQuality,
      exp.exportOutputWidth, exp.exportOutputHeight, exp.exportDpr,
      editor.showOriginal,
      editor.textAnnotations,
      upscaleFn,
      exp.sharpenAmount,
    )
  } catch (err) { console.error('Export failed:', err) }
  finally {
    isExporting.value = false
    exportingSingle.value = false
    sharedUpscaleCleanup?.()
    sharedUpscaleCleanup = null
    exportStatusText.value = ''
  }
}

// ---- preview ----
const previewModalRef = ref<InstanceType<typeof PreviewModal> | null>(null)
const previewZoomRegion = ref<CropRegion | null>(null)
const previewZoomShow = ref(false)

function handlePreviewSingle() {
  const region = editor.selectedRegion
  if (!editor.imageLoaded || !region) return
  previewZoomRegion.value = region
  previewZoomShow.value = true
}

function handlePreviewBatch() {
  if (!editor.imageLoaded || editor.regions.length === 0) return
  previewModalRef.value?.open()
}

// ---- region transforms ----
const rotateAngle = ref(45)

function getRegionsToTransform(): CropRegion[] {
  if (editor.selectedRegionIds.size > 0 && editor.selectedRegionId && editor.selectedRegionIds.has(editor.selectedRegionId)) {
    return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
  }
  const sel = editor.selectedRegion
  return sel ? [sel] : []
}

function applyTransform(fn: (r: CropRegion) => void) {
  const targets = getRegionsToTransform()
  if (targets.length === 0) return
  history.snapshot()
  for (const r of targets) fn(r)
  editor.invalidateCanvas()
}

function handleFlipH() { applyTransform(flipRegionHorizontal) }
function handleFlipV() { applyTransform(flipRegionVertical) }
function handleRotateLeft() { applyTransform(rotateRegionLeft90) }
function handleRotateRight() { applyTransform(rotateRegionRight90) }
function handleRotate() {
  rotateAngle.value = Math.max(-360, Math.min(360, rotateAngle.value))
  if (rotateAngle.value === 0) return
  applyTransform(r => rotateRegion(r, rotateAngle.value))
}

// ---- region list ----
const sortedRegions = computed(() => [...editor.regions].reverse())
const checkedCount = computed(() => editor.selectedRegionIds.size)

const exportResolutionInfo = computed(() => {
  const region = editor.selectedRegion
  if (!region || !editor.imageLoaded) return null
  const srcRatio = computeSourcePixelRatio(editor.layers, region, exp.exportOutputWidth, exp.exportOutputHeight)
  const outW = exp.exportOutputWidth ?? region.width
  const outH = exp.exportOutputHeight ?? region.height
  const pw = Math.round(outW * exp.exportDpr)
  const ph = Math.round(outH * exp.exportDpr)
  const effectiveDpr = Math.min(exp.exportDpr, Math.max(1, Math.round(srcRatio * 2 * 10) / 10))
  const effectivePw = Math.round(outW * effectiveDpr)
  const effectivePh = Math.round(outH * effectiveDpr)
  const isOverUpscale = srcRatio < 0.5
  const isDprCapped = effectiveDpr < exp.exportDpr
  let srcLabel = `${Math.round(region.width)}×${Math.round(region.height)}`
  if (srcRatio >= 1) srcLabel += ' (充足)'
  else if (srcRatio >= 0.5) srcLabel += ' (一般)'
  else srcLabel += ' (不足)'
  return { outW, outH, pw, ph, effectiveDpr, effectivePw, effectivePh, isOverUpscale, isDprCapped, srcRatio, srcLabel }
})

function selectRegion(id: string, _e: MouseEvent) {
  editor.selectRegion(id)
  editor.activeTool = 'select'
}

function checkedRegions(): CropRegion[] {
  if (editor.selectedRegionIds.size === 0) return editor.regions
  return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
}

const exporting = ref(false)

// layer rename state
const renamingId = ref<string | null>(null)
const renameValue = ref('')

// layer drag state
const dragOverIdx = ref(-1)

function onLayerDragStart(e: DragEvent, idx: number) {
  if (!e.dataTransfer) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', String(idx))
}

function onLayerDragLeave(idx: number) {
  if (dragOverIdx.value === idx) dragOverIdx.value = -1
}

function onLayerDrop(e: DragEvent, toIdx: number) {
  dragOverIdx.value = -1
  const fromIdx = parseInt(e.dataTransfer?.getData('text/plain') ?? '')
  if (isNaN(fromIdx)) return
  history.snapshot()
  editor.moveLayer(fromIdx, toIdx)
}

async function handleBatchExport() {
  if (!editor.imageLoaded || editor.regions.length === 0) return
  const toExport = checkedRegions()
  if (toExport.length === 0) return
  isExporting.value = true
  exporting.value = true
  exportStatusText.value = toExport.length > 1 ? `正在导出 ${toExport.length} 项...` : '正在导出...'
  try {
    const imageName = editor.activeLayer?.name?.replace(/\.[^.]+$/, '') ?? 'image'
    const namingOptions = {
      pattern: exp.filenamePattern,
      imageName,
    }
    const bw = exp.batchUseCustomSize ? exp.batchOutputWidth : null
    const bh = exp.batchUseCustomSize ? exp.batchOutputHeight : null
    const fit = exp.batchUseCustomSize ? exp.batchFitMode : undefined
    const fill = exp.batchFillColor

    const upscaleFn = await createUpscaleFn()

    const blob = await exportRegions(
      editor.layers, toExport,
      exp.exportFormat, exp.exportQuality,
      exp.exportDpr,
      editor.showOriginal,
      editor.textAnnotations,
      namingOptions,
      bw, bh, fit, fill,
      upscaleFn,
      exp.sharpenAmount,
    )
    downloadZip(blob)
  } catch (err) { console.error('Export failed:', err) }
  finally {
    isExporting.value = false
    exporting.value = false
    sharedUpscaleCleanup?.()
    sharedUpscaleCleanup = null
    exportStatusText.value = ''
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="top-half scrollbar">

    <!-- Layer panel -->
    <section class="section" v-if="editor.layers.length > 0">
      <div class="section-title">图层
        <button class="clear-all-btn" title="清空图层" @click="history.snapshot(); editor.layers.splice(0); editor.activeLayerId = null">清空</button>
      </div>
      <div class="layer-list scrollbar">
        <div
          v-for="(layer, idx) in editor.layers" :key="layer.id"
          class="layer-item"
          :class="{
            active: layer.id === editor.activeLayerId,
            'drag-over': dragOverIdx === idx,
          }"
          draggable="true"
          @click="editor.setActiveLayer(layer.id)"
          @dragstart="onLayerDragStart($event, idx)"
          @dragover.prevent="dragOverIdx = idx"
          @dragleave="onLayerDragLeave(idx)"
          @drop="onLayerDrop($event, idx)"
        >
          <span class="layer-visibility" @click.stop="history.snapshot(); editor.toggleLayerVisible(layer.id)">{{ layer.visible ? '👁' : '—' }}</span>
          <input type="checkbox" class="layer-check" :checked="editor.selectedLayerIds.has(layer.id)" @click.stop @change="editor.toggleLayerCheck(layer.id)" />
          <span class="layer-name" v-if="renamingId !== layer.id" @dblclick.stop="renamingId = layer.id; renameValue = layer.name">{{ layer.name }}</span>
          <input
            v-else
            class="layer-rename-input"
            v-model="renameValue"
            @blur="editor.renameLayer(layer.id, renameValue || layer.name); renamingId = null"
            @keyup.enter="editor.renameLayer(layer.id, renameValue || layer.name); renamingId = null"
            @click.stop
            ref="renameInput"
            autofocus
          />
          <span class="layer-order-btns">
            <button class="layer-order-btn" :disabled="idx === 0" @click.stop="history.snapshot(); editor.moveLayerUp(layer.id)">▲</button>
            <button class="layer-order-btn" :disabled="idx === editor.layers.length - 1" @click.stop="history.snapshot(); editor.moveLayerDown(layer.id)">▼</button>
          </span>
          <button class="layer-delete" title="删除图层" @click.stop="history.snapshot(); editor.removeLayer(layer.id)">×</button>
        </div>
      </div>
    </section>

    <!-- Brush settings -->
    <section class="section" v-if="editor.activeTool === 'brush'">
      <div class="section-title">画笔设置</div>
      <div class="field"><label>大小: {{ editor.brushSettings.size }}px</label><input type="range" min="1" max="100" v-model.number="editor.brushSettings.size" /></div>
      <div class="field"><label>颜色</label><input type="color" v-model="editor.brushSettings.color" class="color-input" /></div>
    </section>

    <!-- Eraser settings -->
    <section class="section" v-if="editor.activeTool === 'eraser'">
      <div class="section-title">橡皮设置</div>
      <div class="field"><label>大小: {{ editor.eraserSettings.size }}px</label><input type="range" min="1" max="150" v-model.number="editor.eraserSettings.size" /></div>
    </section>

    <!-- Magic wand settings -->
    <section class="section" v-if="editor.activeTool === 'magic-wand'">
      <div class="section-title">魔棒设置</div>
      <div class="field"><label>容差: {{ editor.magicWandTolerance }}</label><input type="range" min="1" max="100" v-model.number="editor.magicWandTolerance" /></div>
    </section>

    <!-- Region properties -->
    <section class="section" v-if="editor.selectedRegion">
      <div class="section-title">区域属性</div>
      <div class="field"><label>名称</label><input type="text" v-model="editName" @blur="updateName" @keyup.enter="updateName" /></div>
      <div class="field-row">
        <div class="field"><label>X (px)</label><input type="number" v-model.number="editX" @change="updatePosition" /></div>
        <div class="field"><label>Y (px)</label><input type="number" v-model.number="editY" @change="updatePosition" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>宽度 (px)</label><input type="number" v-model.number="editWidth" min="1" @focus="widthFocused = true" @blur="widthFocused = false; updateSize()" /></div>
        <div class="field"><label>高度 (px)</label><input type="number" v-model.number="editHeight" min="1" @focus="heightFocused = true" @blur="heightFocused = false; updateSize()" /></div>
      </div>
      <div class="field"><label>形状</label><div class="readonly-value">{{ shapeLabels[editor.selectedRegion.shape] ?? editor.selectedRegion.shape }}</div></div>
      <div class="field" v-if="editor.selectedRegion.shape === 'roundrect'">
        <label>圆角 (px)</label>
        <input type="number" v-model.number="editBorderRadius" min="0" @input="onBorderRadiusInput" @change="updateBorderRadius" />
      </div>
      <div class="btn-row">
        <button class="btn-primary preview-single-btn" @click="handlePreviewSingle">预览</button>
        <button class="btn-primary export-single-btn" :disabled="exportingSingle" @click="handleExportSingle">{{ exportingSingle ? (exportStatusText || '导出中...') : '导出此区域' }}</button>
      </div>
    </section>

    <!-- Text properties -->
    <section class="section" v-if="editor.selectedText">
      <div class="section-title">文字属性</div>
      <div class="field"><label>内容</label><input type="text" v-model="editText" placeholder="输入文字..." @input="applyTextEdits" @blur="commitTextEdits" /></div>
      <div class="field-row">
        <div class="field"><label>字号</label><input type="number" v-model.number="editFontSize" min="8" max="200" @input="applyTextEdits" /></div>
        <div class="field"><label>粗细</label><select v-model="editFontWeight" @change="applyTextEdits" class="select-input"><option value="normal">常规</option><option value="bold">粗体</option></select></div>
      </div>
      <div class="field"><label>颜色</label><input type="color" v-model="editFontColor" @input="applyTextEdits" class="color-input" /></div>
    </section>

    <!-- No selection -->
    <section class="section" v-if="!editor.selectedRegion && !editor.selectedText && editor.activeTool !== 'brush' && editor.activeTool !== 'eraser' && editor.activeTool !== 'magic-wand'">
      <div class="section-title">属性</div>
      <div class="empty">选择区域或文字以编辑属性</div>
    </section>

    <!-- Region transforms -->
    <section class="section" v-if="editor.selectedRegion || editor.selectedRegionIds.size > 0">
      <div class="section-title">
        区域变换
        <span v-if="editor.selectedRegionIds.size > 0" class="count">{{ editor.selectedRegionIds.size }}区</span>
      </div>
      <div class="transform-row">
        <button class="tf-btn" title="水平翻转" @click="handleFlipH">↔ 水平翻转</button>
        <button class="tf-btn" title="垂直翻转" @click="handleFlipV">↕ 垂直翻转</button>
      </div>
      <div class="transform-row">
        <button class="tf-btn" title="左转90°" @click="handleRotateLeft">↺ 左转90°</button>
        <button class="tf-btn" title="右转90°" @click="handleRotateRight">↻ 右转90°</button>
      </div>
      <div class="field-row" style="align-items: flex-end;">
        <div class="field" style="flex:1"><label>旋转角度</label><input type="number" v-model.number="rotateAngle" class="text-input" min="-360" max="360" /></div>
        <div class="field"><button class="tf-btn" @click="handleRotate">旋转</button></div>
      </div>
    </section>

    <!-- Batch cut -->
    <BatchCutPanel />

    <!-- Template -->
    <TemplatePanel />

    <!-- Export settings -->
    <section class="section">
      <div class="section-title">导出设置</div>
      <div class="field"><label>格式</label>
        <div class="radio-group">
          <label class="radio" v-for="fmt in (['png', 'jpeg', 'webp'] as ImageFormat[])" :key="fmt">
            <input type="radio" :value="fmt" v-model="exp.exportFormat" />{{ fmt.toUpperCase() }}
          </label>
        </div>
      </div>
      <div class="field" v-if="exp.exportFormat === 'jpeg' || exp.exportFormat === 'webp'"><label>质量: {{ exp.exportQuality }}%</label><input type="range" min="10" max="100" v-model.number="exp.exportQuality" /></div>
      <div class="field"><label>设备像素比: {{ exp.exportDpr }}x</label><input type="range" min="1" max="4" step="0.5" v-model.number="exp.exportDpr" /></div>
      <div class="field">
        <label class="checkbox-label">
          <input type="checkbox" v-model="exp.upscaleEnabled" />AI 超分 {{ exp.upscaleScale }}×
        </label>
        <div class="upscale-hint" v-if="exp.upscaleEnabled">首次需下载模型 ~7.5 MB，之后缓存</div>
      <div class="field">
        <label>锐化强度: {{ exp.sharpenAmount }}%</label>
        <input type="range" min="0" max="200" step="10" v-model.number="exp.sharpenAmount" />
      </div>
      </div>
      <div v-if="exportResolutionInfo" class="export-res-info">
        <div class="res-row">输出: <strong>{{ exportResolutionInfo.effectivePw }} × {{ exportResolutionInfo.effectivePh }}</strong> px</div>
        <div class="res-row">源图: {{ exportResolutionInfo.srcLabel }}</div>
        <div v-if="exportResolutionInfo.isDprCapped" class="res-warn">⚠ DPR 已从 {{ exp.exportDpr }}x 限制为 {{ exportResolutionInfo.effectiveDpr }}x（源图像素不足）</div>
        <div v-else-if="exportResolutionInfo.isOverUpscale" class="res-warn">⚠ 源图像素不足，建议降低 DPR</div>
      </div>
    </section>

    <!-- Batch size -->
    <ExportSizePanel />

    <!-- File naming -->
    <ExportNamingPanel />

    </div>

    <!-- Regions list + Batch export -->
    <div class="bottom-half">
    <section class="section region-group">
      <div class="section-title">裁剪区域 [{{ editor.regions.length }}]
        <button  class="clear-all-btn" title="一键清空" @click="history.snapshot(); editor.clearRegions()">清空</button>
      </div>
      <div v-if="editor.regions.length === 0" class="empty region-list">暂无区域</div>
      <div v-else class="region-list scrollbar">
        <div
          v-for="r in sortedRegions" :key="r.id"
          class="region-item" :class="{ selected: r.id === editor.selectedRegionId }"
          @click="selectRegion(r.id, $event)"
        >
          <input type="checkbox" :checked="editor.selectedRegionIds.has(r.id)" class="region-check" @click.stop @change="editor.toggleRegionCheck(r.id)" />
          <span class="region-shape-icon">{{ shapeIcons[r.shape] ?? '▭' }}</span>
          <span class="region-name">{{ r.name }}</span>
          <span class="region-dims">{{ Math.round(r.width) }}×{{ Math.round(r.height) }}</span>
          <button class="region-delete" title="删除" @click.stop="history.snapshot(); editor.deleteRegion(r.id)">×</button>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn-primary preview-batch-btn" :disabled="editor.regions.length === 0" @click="handlePreviewBatch">批量预览</button>
        <button class="btn-primary export-btn" :disabled="exporting || editor.regions.length === 0" @click="handleBatchExport">
          {{ exporting ? (exportStatusText || '导出中...') : `批量导出 ${checkedCount || editor.regions.length} 项` }}
        </button>
      </div>
    </section>
    </div>
  </aside>
  <PreviewModal ref="previewModalRef" />
  <ImageZoomModal :region="previewZoomRegion" v-model:show="previewZoomShow" />

  <!-- Export loading overlay -->
  <Teleport to="body">
    <div v-if="isExporting" class="export-overlay">
      <div class="export-overlay-card">
        <div class="export-spinner"></div>
        <div class="export-overlay-text">{{ exportStatusText || '正在导出...' }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sidebar { width: 240px; height: 100%; background: var(--bg-secondary); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.top-half { flex: 1; overflow-y: auto; border-bottom: 1px solid var(--border); }
.bottom-half { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.count { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 8px; font-size: 10px; color: var(--text-secondary); }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.field-row { display: flex; gap: 8px; }
.field-row .field { flex: 1; }
.readonly-value { padding: 6px 10px; background: var(--bg-primary); border-radius: var(--radius); color: var(--text-muted); font-size: 12px; }
.radio-group { display: flex; gap: 4px; }
.radio { flex: 1; display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 5px 8px; border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; border: 1px solid var(--border); }
.radio:has(input:checked) { border-color: var(--accent); color: var(--accent); }
.radio input { accent-color: var(--accent);  margin-right: 2px; vertical-align: bottom;}
.checkbox-label { display: flex !important; align-items: center; gap: 6px; cursor: pointer; font-size: 12px !important; }
.checkbox-label input { accent-color: var(--accent); }
.empty { font-size: 11px; color: var(--text-muted); }
.export-single-btn { flex: 1; }
.btn-row { display: flex; gap: 6px; }
.preview-single-btn { background: var(--bg-primary); color: var(--accent); border: 1px solid var(--accent); }
.preview-single-btn:hover { opacity: 0.85; }
.preview-batch-btn { background: var(--bg-primary); color: var(--accent); border: 1px solid var(--accent); padding: 8px 16px; }
.preview-batch-btn:hover { opacity: 0.85; }
.preview-batch-btn:disabled { opacity: 0.4; cursor: default; }
.export-btn { flex: 1; }
.color-input { width: 100%; height: 32px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; padding: 2px; }
.select-input { width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary); font-size: 12px; outline: none; }
.select-input:focus { border-color: var(--accent); }
.region-group { flex: 1; display: flex; flex-direction: column; min-height: 0; padding-bottom: 14px; }
.region-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.region-item { display: flex; align-items: center; gap: 5px; padding: 5px 6px; border-radius: var(--radius); cursor: pointer; transition: background 0.1s; font-size: 12px; flex-shrink: 0; }
.region-item:hover { background: var(--bg-hover); }
.region-item.selected { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.region-check { flex-shrink: 0; accent-color: var(--accent); cursor: pointer; width: 13px; height: 13px; }
.region-shape-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
.region-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.region-dims { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

.layer-list { display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
.layer-item { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: var(--radius); cursor: grab; font-size: 11px; }
.layer-item:active { cursor: grabbing; }
.layer-item:hover { background: var(--bg-hover); }
.layer-item.active { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.layer-item.drag-over { border-top: 2px solid var(--accent); }
.layer-visibility { cursor: pointer; font-size: 12px; flex-shrink: 0; }
.layer-check { flex-shrink: 0; accent-color: var(--accent); cursor: pointer; width: 13px; height: 13px; margin: 0; }
.layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer-rename-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--accent); border-radius: 3px; color: var(--text-primary); font-size: 11px; padding: 1px 4px; outline: none; min-width: 0; }
.layer-order-btns { display: flex; flex-shrink: 0; }
.layer-order-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 8px; padding: 0 2px; }
.layer-order-btn:hover { color: var(--text-primary); }
.layer-order-btn:disabled { opacity: 0.3; cursor: default; }
.layer-delete { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 0 3px; border-radius: 3px; }
.layer-delete:hover { background: rgba(229, 92, 92, 0.2); color: var(--danger); }
.region-delete {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 11px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.1s; line-height: 1;
}
.region-item:hover .region-delete { opacity: 1; }
.region-delete:hover { background: rgba(229, 92, 92, 0.2); color: var(--danger); }
.clear-all-btn {
  background: none; border: 1px solid var(--border); color: var(--text-muted);
  font-size: 10px; padding: 1px 8px; border-radius: 3px; cursor: pointer;
}
.clear-all-btn:hover { border-color: var(--danger); color: var(--danger); }
.export-btn { width: 100%; flex-shrink: 0; }
.transform-row { display: flex; gap: 6px; margin-bottom: 6px; }
.tf-btn {
  flex: 1; padding: 5px 8px; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text-secondary); font-size: 11px;
  cursor: pointer; white-space: nowrap;
}
.tf-btn:hover { border-color: var(--accent); color: var(--accent); }
.export-res-info {
  background: var(--bg-primary); border-radius: var(--radius); padding: 8px; margin-top: 4px;
}
.res-row { font-size: 11px; color: var(--text-secondary); padding: 1px 0; }
.res-row strong { color: var(--text-primary); }
.res-warn { font-size: 10px; color: #e5a400; margin-top: 4px; }
.upscale-hint { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

/* export overlay */
.export-overlay {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(0, 0, 0, 0.6);
  display: flex; align-items: center; justify-content: center;
  pointer-events: all; user-select: none;
}
.export-overlay-card {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 12px; padding: 32px 40px;
  display: flex; flex-direction: column; align-items: center; gap: 16px;
  min-width: 240px;
}
.export-overlay-text { font-size: 14px; color: var(--text-primary); text-align: center; }
.export-spinner {
  width: 36px; height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: export-spin 0.8s linear infinite;
}
@keyframes export-spin { to { transform: rotate(360deg); } }
</style>
