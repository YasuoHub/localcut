<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CropGridGroup, CropRegion, TextAnnotation, ImageFormat, ExportInspectionResult, ColorProcessScope } from '../types'
import { useExport } from '../composables/useExport'
import { inspectExport } from '../composables/useExportInspection'
import { expandGridGroup } from '../composables/useGridGroups'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useHistoryStore } from '../stores/history'
import { PLATFORM_PRESETS } from '../constants/platformPresets'
import {
  flipRegionHorizontal, flipRegionVertical,
  rotateRegionLeft90, rotateRegionRight90, rotateRegion,
} from '../composables/useRegionTransform'
import {
  applyColorProcess,
  buildColorProcessMask,
  normalizeRect,
} from '../utils/colorProcessing'
import ExportNamingPanel from './right/ExportNamingPanel.vue'
import ExportInspectionPanel from './right/ExportInspectionPanel.vue'
import ExportSizePanel from './right/ExportSizePanel.vue'
import BatchCutPanel from './right/BatchCutPanel.vue'
import TemplatePanel from './right/TemplatePanel.vue'
import ExportInspectionModal from './ExportInspectionModal.vue'
import ImageZoomModal from './ImageZoomModal.vue'
import PreviewModal from './PreviewModal.vue'

const editor = useEditorStore()
const exp = useExportStore()
const history = useHistoryStore()

type RightTab = 'properties' | 'batch' | 'templates' | 'export'
const activeTab = ref<RightTab>('properties')
const rightTabs: { id: RightTab; label: string }[] = [
  { id: 'properties', label: '属性' },
  { id: 'batch', label: '批量' },
  { id: 'templates', label: '模板' },
  { id: 'export', label: '导出' },
]

const sidebarRef = ref<HTMLElement | null>(null)
const listPanelPercent = ref(34)
const listCollapsed = ref(false)
const isResizingList = ref(false)
const listSearch = ref('')

const upperPanelStyle = computed(() => ({
  height: listCollapsed.value ? '100%' : `${100 - listPanelPercent.value}%`,
}))

const listPanelStyle = computed(() => ({
  height: `${listPanelPercent.value}%`,
}))

const selectedLayerCount = computed(() =>
  editor.layers.filter(layer => editor.selectedLayerIds.has(layer.id)).length,
)
const layerDeleteButtonText = computed(() =>
  selectedLayerCount.value > 0 ? `删除 ${selectedLayerCount.value} 项` : '删除全部',
)

function clampListPercent(value: number) {
  return Math.max(20, Math.min(80, value))
}

function onListResizeMove(e: PointerEvent) {
  const el = sidebarRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const next = ((rect.bottom - e.clientY) / rect.height) * 100
  listPanelPercent.value = clampListPercent(next)
}

function stopListResize() {
  isResizingList.value = false
  window.removeEventListener('pointermove', onListResizeMove)
  window.removeEventListener('pointerup', stopListResize)
}

function startListResize(e: PointerEvent) {
  e.preventDefault()
  listCollapsed.value = false
  isResizingList.value = true
  onListResizeMove(e)
  window.addEventListener('pointermove', onListResizeMove)
  window.addEventListener('pointerup', stopListResize)
}

onBeforeUnmount(stopListResize)

const { exportSingleRegion, exportSingleLayer, exportGridGroup, downloadZip, computeSourcePixelRatio } = useExport()

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

// ---- grid group editing ----
const editGridName = ref('')
const editGridX = ref(0)
const editGridY = ref(0)
const editGridWidth = ref(0)
const editGridHeight = ref(0)
const editGridRows = ref(3)
const editGridCols = ref(3)
const editGridGapX = ref(0)
const editGridGapY = ref(0)
const editGridBorderRadius = ref(0)
const gridWidthFocused = ref(false)
const gridHeightFocused = ref(false)

function syncFromGridGroup(group: CropGridGroup) {
  editGridName.value = group.name
  editGridX.value = Math.round(group.x)
  editGridY.value = Math.round(group.y)
  if (!gridWidthFocused.value) editGridWidth.value = Math.round(group.width)
  if (!gridHeightFocused.value) editGridHeight.value = Math.round(group.height)
  editGridRows.value = group.rows
  editGridCols.value = group.cols
  editGridGapX.value = Math.round(group.gapX)
  editGridGapY.value = Math.round(group.gapY)
  editGridBorderRadius.value = Math.round(group.borderRadius)
}

watch(() => editor.selectedGridGroup, (group, old) => {
  if (group && group.id !== old?.id) syncFromGridGroup(group)
}, { immediate: true })

watch(
  () => editor.selectedGridGroup
    ? `${editor.selectedGridGroup.x}|${editor.selectedGridGroup.y}|${editor.selectedGridGroup.width}|${editor.selectedGridGroup.height}|${editor.selectedGridGroup.rows}|${editor.selectedGridGroup.cols}|${editor.selectedGridGroup.gapX}|${editor.selectedGridGroup.gapY}|${editor.selectedGridGroup.borderRadius}`
    : null,
  () => {
    if (editor.selectedGridGroup) syncFromGridGroup(editor.selectedGridGroup)
  },
)

function updateGridName() {
  const group = editor.selectedGridGroup
  if (!group) return
  const name = editGridName.value.trim()
  if (!name) { editGridName.value = group.name; return }
  if (editor.gridGroups.some(g => g.id !== group.id && g.name === name)) {
    editGridName.value = group.name
    return
  }
  history.snapshot()
  group.name = name
  editor.invalidateCanvas()
}

function updateGridPosition() {
  const group = editor.selectedGridGroup
  if (!group) return
  if (Math.round(group.x) === editGridX.value && Math.round(group.y) === editGridY.value) return
  history.snapshot()
  group.x = editGridX.value
  group.y = editGridY.value
  editor.invalidateCanvas()
}

function updateGridSize() {
  const group = editor.selectedGridGroup
  if (!group) return
  const nextWidth = Math.max(1, editGridWidth.value)
  const nextHeight = Math.max(1, editGridHeight.value)
  if (Math.round(group.width) === nextWidth && Math.round(group.height) === nextHeight) return
  history.snapshot()
  group.width = nextWidth
  group.height = nextHeight
  editor.invalidateCanvas()
}

function updateGridLayout() {
  const group = editor.selectedGridGroup
  if (!group) return
  history.snapshot()
  group.rows = Math.max(1, Math.round(editGridRows.value))
  group.cols = Math.max(1, Math.round(editGridCols.value))
  group.gapX = Math.max(0, editGridGapX.value)
  group.gapY = Math.max(0, editGridGapY.value)
  group.borderRadius = Math.max(0, editGridBorderRadius.value)
  syncFromGridGroup(group)
  editor.invalidateCanvas()
}

function onGridLayoutInput() {
  const group = editor.selectedGridGroup
  if (!group) return
  group.rows = Math.max(1, Math.round(editGridRows.value))
  group.cols = Math.max(1, Math.round(editGridCols.value))
  group.gapX = Math.max(0, editGridGapX.value)
  group.gapY = Math.max(0, editGridGapY.value)
  group.borderRadius = Math.max(0, editGridBorderRadius.value)
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

// ---- layer color processing ----
const colorProcessMessage = ref('')
const colorProcessExpanded = ref(false)
const hasColorProcessPreview = computed(() => Boolean(editor.colorProcessPreview))

function getColorProcessRect() {
  const layer = editor.activeLayer
  const wc = layer?.workingCanvas
  if (!layer || !wc) return null

  if (editor.colorProcessScope === 'manual') {
    if (!editor.colorProcessManualRect) return null
    return normalizeRect(editor.colorProcessManualRect, wc.width, wc.height)
  }

  if (editor.colorProcessScope === 'selected-region') {
    const region = editor.selectedRegion
    if (!region) return null
    return normalizeRect({
      x: (region.x - layer.x) / layer.scaleX,
      y: (region.y - layer.y) / layer.scaleY,
      width: region.width / layer.scaleX,
      height: region.height / layer.scaleY,
    }, wc.width, wc.height)
  }

  return { x: 0, y: 0, width: wc.width, height: wc.height }
}

function getColorProcessOptions() {
  const rect = getColorProcessRect()
  if (!rect) return null
  return {
    sourceColor: editor.colorProcessSourceColor,
    targetColor: editor.colorProcessTargetColor,
    tolerance: editor.colorProcessTolerance,
    feather: editor.colorProcessFeather,
    action: editor.colorProcessAction,
    contiguous: editor.colorProcessContiguous,
    removeFringe: editor.colorProcessRemoveFringe,
    despeckle: editor.colorProcessDespeckle,
    rect,
    seed: editor.colorProcessContiguous ? editor.colorProcessSeedPoint : null,
  }
}

function setColorProcessScope(scope: ColorProcessScope) {
  if (editor.colorProcessScope === scope) return
  editor.colorProcessScope = scope
  if (editor.colorProcessManualRect) editor.setColorProcessManualRect(null)
  else editor.setColorProcessPreview(null)
  editor.cancelColorProcessCanvasMode()
  colorProcessMessage.value = ''
}

function previewColorProcess() {
  const layer = editor.activeLayer
  const wc = layer?.workingCanvas
  if (editor.colorProcessScope === 'manual' && !editor.colorProcessManualRect) {
    window.alert('请先点击“框选范围”，在画布上拖拽选择要处理的区域。')
    return
  }
  const options = getColorProcessOptions()
  if (!layer || !wc || !options) {
    colorProcessMessage.value = '请先选择图层和有效处理范围。'
    return
  }

  editor.isHeavyProcessing = true
  editor.heavyProcessingText = '正在生成颜色预览...'
  requestAnimationFrame(() => {
    try {
      const ctx = wc.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, wc.width, wc.height)
      const result = buildColorProcessMask(imageData, options)
      if (result.count === 0) {
        editor.setColorProcessPreview(null)
        colorProcessMessage.value = '没有命中颜色，请提高容差或重新取色。'
        return
      }
      const previewImageData = applyColorProcess(imageData, result.mask, options)
      const previewCanvas = document.createElement('canvas')
      previewCanvas.width = wc.width
      previewCanvas.height = wc.height
      previewCanvas.getContext('2d')!.putImageData(previewImageData, 0, 0)
      editor.setColorProcessPreview({
        layerId: layer.id,
        width: wc.width,
        height: wc.height,
        mask: result.mask,
        count: result.count,
        canvas: previewCanvas,
      })
      colorProcessMessage.value = '预览已生成，可取消预览或应用到图层。'
    } finally {
      editor.isHeavyProcessing = false
      editor.heavyProcessingText = ''
    }
  })
}

function applyColorProcessToLayer() {
  const layer = editor.activeLayer
  const wc = layer?.workingCanvas
  if (editor.colorProcessScope === 'manual' && !editor.colorProcessManualRect) {
    window.alert('请先点击“框选范围”，在画布上拖拽选择要处理的区域。')
    return
  }
  const options = getColorProcessOptions()
  if (!layer || !wc || !options) {
    colorProcessMessage.value = '请先选择图层和有效处理范围。'
    return
  }

  editor.isHeavyProcessing = true
  editor.heavyProcessingText = '正在应用颜色处理...'
  requestAnimationFrame(() => {
    try {
      const ctx = wc.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, wc.width, wc.height)
      const preview = editor.colorProcessPreview
      const maskResult = preview && preview.layerId === layer.id && preview.width === wc.width && preview.height === wc.height
        ? { mask: preview.mask, count: preview.count }
        : buildColorProcessMask(imageData, options)

      if (maskResult.count === 0) {
        colorProcessMessage.value = '没有命中颜色，未修改图层。'
        return
      }

      history.snapshot()
      const result = applyColorProcess(imageData, maskResult.mask, options)
      ctx.putImageData(result, 0, 0)
      editor.setColorProcessPreview(null)
      editor.setColorProcessManualRect(null)
      editor.cancelColorProcessCanvasMode()
      editor.invalidateCanvas()
      colorProcessMessage.value = '已应用到图层。'
    } finally {
      editor.isHeavyProcessing = false
      editor.heavyProcessingText = ''
    }
  })
}

function cancelColorProcessPreview() {
  editor.setColorProcessPreview(null)
  colorProcessMessage.value = ''
}

function toggleColorProcessPreview() {
  if (editor.colorProcessPreview) cancelColorProcessPreview()
  else previewColorProcess()
}

function clearColorProcessRange() {
  editor.setColorProcessManualRect(null)
  editor.setColorProcessPreview(null)
  colorProcessMessage.value = ''
}

watch(
  () => [
    editor.colorProcessSourceColor,
    editor.colorProcessTargetColor,
    editor.colorProcessTolerance,
    editor.colorProcessFeather,
    editor.colorProcessScope,
    editor.colorProcessAction,
    editor.colorProcessContiguous,
    editor.colorProcessRemoveFringe,
    editor.colorProcessDespeckle,
    editor.colorProcessManualRect,
  ],
  () => {
    if (editor.colorProcessPreview) {
      editor.setColorProcessPreview(null)
      colorProcessMessage.value = ''
    }
  },
  { deep: true },
)

watch(() => editor.activeLayerId, () => {
  colorProcessExpanded.value = false
  colorProcessMessage.value = ''
})

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
  const singleResult = inspectExport({
    allRegions: editor.regions,
    targetRegions: [region],
    selectedCount: 1,
    layers: editor.layers,
    activeLayer: editor.activeLayer,
    format: exp.exportFormat,
    filenamePattern: exp.singleUseFilenamePattern ? exp.filenamePattern : '{regionName}',
    imageName: exportImageName.value,
    regionIndexById: regionIndexById.value,
    settings: {
      ...exp.inspectionSettings,
      checkedCount: false,
      filenameDuplicate: false,
      unknownVariable: exp.singleUseFilenamePattern && exp.inspectionSettings.unknownVariable,
    },
    useCustomSize: Boolean(exp.exportOutputWidth || exp.exportOutputHeight),
    outputWidth: exp.exportOutputWidth,
    outputHeight: exp.exportOutputHeight,
    dpr: exp.exportDpr,
    upscaleEnabled: exp.upscaleEnabled,
  })
  if (singleResult.hasBlockingIssues) {
    inspectionExportWarning.value = '导出体检发现阻断问题，请先查看检测结果。'
    activeInspectionResult.value = singleResult
    showInspectionModal.value = true
    return
  }
  activeInspectionResult.value = null
  inspectionExportWarning.value = ''
  isExporting.value = true
  exportingSingle.value = true
  exportStatusText.value = '正在导出...'
  try {
    const upscaleFn = await createUpscaleFn()
    const singleRegionIndex = editor.regions.findIndex(r => r.id === region.id) + 1
    const namingOptions = exp.singleUseFilenamePattern
      ? {
          pattern: exp.filenamePattern,
          imageName: exportImageName.value,
          index: singleRegionIndex > 0 ? singleRegionIndex : 1,
        }
      : undefined
    await exportSingleRegion(
      editor.layers, region,
      exp.exportFormat, exp.exportQuality,
      exp.exportOutputWidth, exp.exportOutputHeight, exp.exportDpr,
      editor.showOriginal,
      editor.textAnnotations,
      upscaleFn,
      exp.sharpenAmount,
      namingOptions,
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

function zipSafeName(name: string) {
  return `${name.replace(/[\\/:*?"<>|]/g, '_') || 'grid-group'}.zip`
}

async function handleExportGridGroup() {
  const group = editor.selectedGridGroup
  if (!editor.imageLoaded || !group) return
  const cells = expandGridGroup(group)
  const cellIndexById = Object.fromEntries(cells.map((cell, index) => [cell.id, index + 1]))
  const singleResult = inspectExport({
    allRegions: cells,
    targetRegions: cells,
    selectedCount: cells.length,
    layers: editor.layers,
    activeLayer: editor.activeLayer,
    format: exp.exportFormat,
    filenamePattern: exp.singleUseFilenamePattern ? exp.filenamePattern : '{regionName}',
    imageName: exportImageName.value,
    regionIndexById: cellIndexById,
    settings: {
      ...exp.inspectionSettings,
      checkedCount: false,
      filenameDuplicate: true,
      unknownVariable: exp.singleUseFilenamePattern && exp.inspectionSettings.unknownVariable,
    },
    useCustomSize: Boolean(exp.exportOutputWidth || exp.exportOutputHeight),
    outputWidth: exp.exportOutputWidth,
    outputHeight: exp.exportOutputHeight,
    dpr: exp.exportDpr,
    upscaleEnabled: exp.upscaleEnabled,
  })
  if (singleResult.hasBlockingIssues) {
    inspectionExportWarning.value = '导出体检发现阻断问题，请先查看检测结果。'
    activeInspectionResult.value = singleResult
    showInspectionModal.value = true
    return
  }

  activeInspectionResult.value = null
  inspectionExportWarning.value = ''
  isExporting.value = true
  exportingSingle.value = true
  exportStatusText.value = '正在导出 N宫格...'
  try {
    const upscaleFn = await createUpscaleFn()
    const namingOptions = exp.singleUseFilenamePattern
      ? {
          pattern: exp.filenamePattern,
          imageName: exportImageName.value,
          regionIndexById: cellIndexById,
        }
      : undefined
    const blob = await exportGridGroup(
      editor.layers, group,
      exp.exportFormat, exp.exportQuality, exp.exportDpr,
      editor.showOriginal,
      editor.textAnnotations,
      namingOptions,
      exp.exportOutputWidth, exp.exportOutputHeight,
      undefined, undefined,
      upscaleFn,
      exp.sharpenAmount,
    )
    downloadZip(blob, zipSafeName(group.name))
  } catch (err) {
    console.error('Grid group export failed:', err)
  } finally {
    isExporting.value = false
    exportingSingle.value = false
    sharedUpscaleCleanup?.()
    sharedUpscaleCleanup = null
    exportStatusText.value = ''
  }
}

async function handleExportActiveLayer() {
  const layer = editor.activeLayer
  if (!layer || exportingSingle.value || isExporting.value) return

  activeInspectionResult.value = null
  inspectionExportWarning.value = ''
  isExporting.value = true
  exportingSingle.value = true
  exportStatusText.value = '正在导出图层...'
  try {
    const upscaleFn = await createUpscaleFn()
    const outputWidth = exp.batchUseCustomSize ? exp.batchOutputWidth : null
    const outputHeight = exp.batchUseCustomSize ? exp.batchOutputHeight : null
    const fit = exp.batchUseCustomSize ? exp.batchFitMode : undefined
    const namingOptions = exp.singleUseFilenamePattern
      ? {
          pattern: exp.filenamePattern,
          imageName: exportImageName.value,
          index: editor.layers.findIndex(item => item.id === layer.id) + 1 || 1,
        }
      : undefined

    await exportSingleLayer(
      layer,
      exp.exportFormat,
      exp.exportQuality,
      outputWidth,
      outputHeight,
      exp.exportDpr,
      editor.showOriginal,
      fit,
      exp.batchFillColor,
      upscaleFn,
      exp.sharpenAmount,
      namingOptions,
    )
  } catch (err) {
    console.error('Layer export failed:', err)
  } finally {
    isExporting.value = false
    exportingSingle.value = false
    sharedUpscaleCleanup?.()
    sharedUpscaleCleanup = null
    exportStatusText.value = ''
  }
}

// ---- preview ----
const previewZoomRegion = ref<CropRegion | null>(null)
const previewZoomShow = ref(false)
const gridPreviewModalRef = ref<InstanceType<typeof PreviewModal> | null>(null)
const previewGridGroupId = ref<string | null>(null)

function handlePreviewSingle() {
  const region = editor.selectedRegion
  if (!editor.imageLoaded || !region) return
  previewZoomRegion.value = region
  previewZoomShow.value = true
}

function handlePreviewGridGroup() {
  const group = editor.selectedGridGroup
  if (!editor.imageLoaded || !group) return
  const cells = expandGridGroup(group)
  previewGridGroupId.value = group.id
  gridPreviewModalRef.value?.open({
    regions: cells,
    title: `${group.name} 预览`,
    exportLabel: '导出 N宫格 ZIP',
  })
}

async function handleGridPreviewExport() {
  const groupId = previewGridGroupId.value
  const group = groupId ? editor.gridGroups.find(g => g.id === groupId) : editor.selectedGridGroup
  if (!group) return
  const previousGroupId = editor.selectedGridGroupId
  if (editor.selectedGridGroupId !== group.id) editor.selectGridGroup(group.id)
  await handleExportGridGroup()
  if (previousGroupId && previousGroupId !== group.id && editor.gridGroups.some(g => g.id === previousGroupId)) {
    editor.selectGridGroup(previousGroupId)
  }
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
const sortedGridGroups = computed(() => [...editor.gridGroups].reverse())
const sortedTexts = computed(() => [...editor.textAnnotations].reverse())
const listKeyword = computed(() => listSearch.value.trim().toLowerCase())
const filteredRegions = computed(() => {
  const keyword = listKeyword.value
  if (!keyword) return sortedRegions.value
  return sortedRegions.value.filter(region => region.name.toLowerCase().includes(keyword))
})
const filteredGridGroups = computed(() => {
  const keyword = listKeyword.value
  if (!keyword) return sortedGridGroups.value
  return sortedGridGroups.value.filter(group => group.name.toLowerCase().includes(keyword))
})
const filteredTexts = computed(() => {
  const keyword = listKeyword.value
  if (!keyword) return sortedTexts.value
  return sortedTexts.value.filter(text => text.text.toLowerCase().includes(keyword))
})

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
  editor.selectedGridGroupIds = new Set()
  editor.selectRegion(id)
  editor.activeTool = 'select'
}

function selectGridGroup(id: string) {
  editor.selectedGridGroupIds = new Set()
  editor.selectGridGroup(id)
  editor.activeTool = 'select'
}

function checkedRegions(): CropRegion[] {
  if (editor.selectedRegionIds.size === 0 && editor.selectedGridGroupIds.size === 0) return editor.regions
  return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
}

const showInspectionModal = ref(false)
const inspectionExportWarning = ref('')
const activeInspectionResult = ref<ExportInspectionResult | null>(null)

const exportImageName = computed(() => editor.activeLayer?.name?.replace(/\.[^.]+$/, '') ?? 'image')
const expandedGridRegions = computed(() => editor.gridGroups.flatMap(group => expandGridGroup(group)))
const inspectionAllRegions = computed(() => [...editor.regions, ...expandedGridRegions.value])
const regionIndexById = computed(() => Object.fromEntries(inspectionAllRegions.value.map((r, i) => [r.id, i + 1])))
const inspectionTargetRegions = computed(() => [
  ...checkedRegions(),
  ...(editor.selectedGridGroupIds.size > 0
    ? editor.gridGroups.filter(group => editor.selectedGridGroupIds.has(group.id)).flatMap(group => expandGridGroup(group))
    : editor.selectedRegionIds.size === 0 ? expandedGridRegions.value : []),
])
const inspectionResult = computed(() => {
  const bw = exp.batchUseCustomSize ? exp.batchOutputWidth : null
  const bh = exp.batchUseCustomSize ? exp.batchOutputHeight : null
  return inspectExport({
    allRegions: inspectionAllRegions.value,
    targetRegions: inspectionTargetRegions.value,
    selectedCount: editor.selectedRegionIds.size + editor.selectedGridGroupIds.size,
    layers: editor.layers,
    activeLayer: editor.activeLayer,
    format: exp.exportFormat,
    filenamePattern: exp.filenamePattern,
    imageName: exportImageName.value,
    regionIndexById: regionIndexById.value,
    settings: exp.inspectionSettings,
    useCustomSize: exp.batchUseCustomSize,
    outputWidth: bw,
    outputHeight: bh,
    fitMode: exp.batchUseCustomSize ? exp.batchFitMode : undefined,
    dpr: exp.exportDpr,
    upscaleEnabled: exp.upscaleEnabled,
  })
})
const modalInspectionResult = computed(() => activeInspectionResult.value ?? inspectionResult.value)

function openInspectionResult() {
  activeInspectionResult.value = null
  showInspectionModal.value = true
}

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

function deleteLayerSelection() {
  history.snapshot()
  if (selectedLayerCount.value === 0) {
    editor.clearLayers()
    return
  }
  const ids = editor.layers
    .filter(layer => editor.selectedLayerIds.has(layer.id))
    .map(layer => layer.id)
  for (const id of ids) editor.removeLayer(id)
}
</script>

<template>
  <aside ref="sidebarRef" class="sidebar" :class="{ resizing: isResizingList }">
    <div class="upper-panel" :style="upperPanelStyle">
      <div class="tab-bar">
        <button
          v-for="tab in rightTabs"
          :key="tab.id"
          class="tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="panel-body scrollbar">
      <template v-if="activeTab === 'properties'">
        <section class="section" v-if="editor.layers.length > 0">
          <div class="section-title">
            <span>图层</span>
            <div class="layer-title-actions">
              <button class="clear-all-btn" title="删除图层" @click="deleteLayerSelection">{{ layerDeleteButtonText }}</button>
            </div>
          </div>
          <div class="layer-list scrollbar">
            <div
              v-for="(layer, idx) in editor.layers" :key="layer.id"
              class="layer-item"
              :class="{ active: layer.id === editor.activeLayerId, 'drag-over': dragOverIdx === idx }"
              draggable="true"
              @click="editor.setActiveLayer(layer.id)"
              @dragstart="onLayerDragStart($event, idx)"
              @dragover.prevent="dragOverIdx = idx"
              @dragleave="onLayerDragLeave(idx)"
              @drop="onLayerDrop($event, idx)"
            >
              <span class="layer-visibility" :title="layer.visible ? '隐藏图层' : '显示图层'" @click.stop="history.snapshot(); editor.toggleLayerVisible(layer.id)">{{ layer.visible ? '◉' : '○' }}</span>
              <input type="checkbox" class="layer-check" :checked="editor.selectedLayerIds.has(layer.id)" @click.stop @change="editor.toggleLayerCheck(layer.id)" />
              <span class="layer-name" v-if="renamingId !== layer.id" @dblclick.stop="renamingId = layer.id; renameValue = layer.name">{{ layer.name }}</span>
              <input
                v-else
                class="layer-rename-input"
                v-model="renameValue"
                maxlength="100"
                @blur="editor.renameLayer(layer.id, renameValue || layer.name); renamingId = null"
                @keyup.enter="editor.renameLayer(layer.id, renameValue || layer.name); renamingId = null"
                @click.stop
                autofocus
              />
              <span class="layer-order-btns">
                <button class="layer-order-btn" :disabled="idx === 0" @click.stop="history.snapshot(); editor.moveLayerUp(layer.id)">▲</button>
                <button class="layer-order-btn" :disabled="idx === editor.layers.length - 1" @click.stop="history.snapshot(); editor.moveLayerDown(layer.id)">▼</button>
              </span>
              <button class="layer-delete" title="删除图层" @click.stop="history.snapshot(); editor.removeLayer(layer.id)">×</button>
            </div>
          </div>

          <div class="layer-tool-panel" v-if="editor.activeLayer">
            <button
              type="button"
              class="layer-tool-toggle"
              :class="{ expanded: colorProcessExpanded }"
              :aria-expanded="colorProcessExpanded"
              @click="colorProcessExpanded = !colorProcessExpanded"
            >
              <span class="tool-toggle-main">
                <span class="tool-chevron">›</span>
                <span>当前图层 · 颜色处理</span>
              </span>
              <span class="tool-toggle-meta">
                <span class="active-layer-name">{{ editor.activeLayer.name }}</span>
              </span>
            </button>

            <div v-if="colorProcessExpanded" class="color-process-panel">
              <div class="field">
                <label>处理目标</label>
                <div class="radio-group">
                  <label class="radio"><input type="radio" value="transparent" v-model="editor.colorProcessAction" />透明</label>
                  <label class="radio"><input type="radio" value="replace" v-model="editor.colorProcessAction" />替换色</label>
                </div>
              </div>

              <div class="color-fields-row" :class="{ compact: editor.colorProcessAction !== 'replace' }">
                <div class="field">
                  <label>源颜色</label>
                  <div class="color-pick-row">
                    <input type="color" v-model="editor.colorProcessSourceColor" class="color-input" />
                    <button class="tf-btn color-pick-btn" :class="{ active: editor.colorProcessPickingColor }" @click="editor.startColorPick()">
                      <svg class="pick-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14.5 4.5l5 5-9.6 9.6H5v-4.9l9.5-9.7Z" />
                        <path d="M13 6l5 5" />
                        <path d="M5 19h5" />
                      </svg>
                      <span>{{ editor.colorProcessPickingColor ? '取色中' : '吸色' }}</span>
                    </button>
                  </div>
                </div>
                <div class="field" v-if="editor.colorProcessAction === 'replace'">
                  <label>目标颜色</label>
                  <div class="color-pick-row">
                    <input type="color" v-model="editor.colorProcessTargetColor" class="color-input" />
                    <button class="tf-btn color-pick-btn" :class="{ active: editor.colorProcessPickingTargetColor }" @click="editor.startColorTargetPick()">
                      <svg class="pick-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14.5 4.5l5 5-9.6 9.6H5v-4.9l9.5-9.7Z" />
                        <path d="M13 6l5 5" />
                        <path d="M5 19h5" />
                      </svg>
                      <span>{{ editor.colorProcessPickingTargetColor ? '取色中' : '吸色' }}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div class="field">
                <label>处理范围</label>
                <div class="radio-group scope-radio-group">
                  <label class="radio">
                    <input type="radio" value="layer" :checked="editor.colorProcessScope === 'layer'" @change="setColorProcessScope('layer')" />整层
                  </label>
                  <label class="radio">
                    <input type="radio" value="selected-region" :checked="editor.colorProcessScope === 'selected-region'" :disabled="!editor.selectedRegion" @change="setColorProcessScope('selected-region')" />选区
                  </label>
                  <label class="radio">
                    <input type="radio" value="manual" :checked="editor.colorProcessScope === 'manual'" @change="setColorProcessScope('manual')" />框选
                  </label>
                </div>
              </div>

              <div v-if="editor.colorProcessScope === 'manual'" class="manual-range-row">
                <div class="range-readout">
                  <span v-if="editor.colorProcessManualRect">
                    框选 {{ Math.round(editor.colorProcessManualRect.width) }} x {{ Math.round(editor.colorProcessManualRect.height) }}
                  </span>
                  <span v-else>未设置框选范围</span>
                  <button v-if="editor.colorProcessManualRect" class="inline-clear-btn" @click="clearColorProcessRange">清除</button>
                </div>
                <button class="tf-btn range-select-btn" :class="{ active: editor.colorProcessSelectingRect }" @click="editor.startColorRectSelect()">
                  {{ editor.colorProcessSelectingRect ? '拖拽中' : '框选范围' }}
                </button>
              </div>

              <div class="field">
                <label>容差</label>
                <div class="size-control-row">
                  <input type="range" min="0" max="160" v-model.number="editor.colorProcessTolerance" />
                  <label class="numeric-value">
                    <input type="number" min="0" max="160" v-model.number="editor.colorProcessTolerance" />
                  </label>
                </div>
              </div>

              <div class="field">
                <label>边缘羽化</label>
                <div class="size-control-row">
                  <input type="range" min="0" max="12" v-model.number="editor.colorProcessFeather" />
                  <label class="numeric-value">
                    <input type="number" min="0" max="12" v-model.number="editor.colorProcessFeather" />
                    <span>px</span>
                  </label>
                </div>
              </div>

              <div class="color-check-grid">
                <label class="checkbox-label"><input type="checkbox" v-model="editor.colorProcessContiguous" />只处理连续区域</label>
                <label class="checkbox-label"><input type="checkbox" v-model="editor.colorProcessRemoveFringe" />去白边/去杂色</label>
                <label class="checkbox-label"><input type="checkbox" v-model="editor.colorProcessDespeckle" />清理孤立噪点</label>
              </div>

              <div class="btn-row color-action-row">
                <button
                  class="btn-primary preview-single-btn"
                  :class="{ 'cancel-mode': hasColorProcessPreview }"
                  :disabled="editor.isHeavyProcessing || exportingSingle"
                  @click="toggleColorProcessPreview"
                >
                  {{ hasColorProcessPreview ? '取消预览' : '预览' }}
                </button>
                <button class="btn-primary export-single-btn" :disabled="editor.isHeavyProcessing || exportingSingle" @click="applyColorProcessToLayer">应用到图层</button>
                <button
                  class="btn-primary export-layer-icon-btn"
                  type="button"
                  title="导出图层"
                  aria-label="导出图层"
                  :disabled="editor.isHeavyProcessing || exportingSingle"
                  @click="handleExportActiveLayer"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3v11" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 19h14" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="section" v-if="editor.activeTool === 'brush'">
          <div class="section-title">画笔设置</div>
          <div class="field">
            <div class="brush-control-row">
              <input
                type="color"
                v-model="editor.brushSettings.color"
                class="color-input brush-color-input"
                title="画笔颜色"
              />
              <input type="range" min="1" max="100" v-model.number="editor.brushSettings.size" />
              <label class="numeric-value">
                <input type="number" min="1" max="100" v-model.number="editor.brushSettings.size" />
                <span>px</span>
              </label>
            </div>
          </div>
        </section>

        <section class="section" v-if="editor.activeTool === 'eraser'">
          <div class="section-title">橡皮设置</div>
          <div class="field">
            <label>大小</label>
            <div class="size-control-row">
              <input type="range" min="1" max="150" v-model.number="editor.eraserSettings.size" />
              <label class="numeric-value">
                <input type="number" min="1" max="150" v-model.number="editor.eraserSettings.size" />
                <span>px</span>
              </label>
            </div>
          </div>
        </section>

        <section class="section" v-if="editor.activeTool === 'magic-wand'">
          <div class="section-title">魔棒设置</div>
          <div class="field">
            <label>容差</label>
            <div class="size-control-row">
              <input type="range" min="1" max="100" v-model.number="editor.magicWandTolerance" />
              <label class="numeric-value">
                <input type="number" min="1" max="100" v-model.number="editor.magicWandTolerance" />
              </label>
            </div>
          </div>
        </section>

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

        <section class="section" v-if="editor.selectedGridGroup">
          <div class="section-title">N宫格属性</div>
          <div class="field"><label>名称</label><input type="text" v-model="editGridName" @blur="updateGridName" @keyup.enter="updateGridName" /></div>
          <div class="field-row">
            <div class="field"><label>X (px)</label><input type="number" v-model.number="editGridX" @change="updateGridPosition" /></div>
            <div class="field"><label>Y (px)</label><input type="number" v-model.number="editGridY" @change="updateGridPosition" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>宽度 (px)</label><input type="number" v-model.number="editGridWidth" min="1" @focus="gridWidthFocused = true" @blur="gridWidthFocused = false; updateGridSize()" /></div>
            <div class="field"><label>高度 (px)</label><input type="number" v-model.number="editGridHeight" min="1" @focus="gridHeightFocused = true" @blur="gridHeightFocused = false; updateGridSize()" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>行数</label><input type="number" v-model.number="editGridRows" min="1" @input="onGridLayoutInput" @change="updateGridLayout" /></div>
            <div class="field"><label>列数</label><input type="number" v-model.number="editGridCols" min="1" @input="onGridLayoutInput" @change="updateGridLayout" /></div>
          </div>
          <div class="field-row">
            <div class="field"><label>横向间距</label><input type="number" v-model.number="editGridGapX" min="0" @input="onGridLayoutInput" @change="updateGridLayout" /></div>
            <div class="field"><label>纵向间距</label><input type="number" v-model.number="editGridGapY" min="0" @input="onGridLayoutInput" @change="updateGridLayout" /></div>
          </div>
          <div class="field"><label>圆角 (px)</label><input type="number" v-model.number="editGridBorderRadius" min="0" @input="onGridLayoutInput" @change="updateGridLayout" /></div>
          <div class="btn-row">
            <button class="btn-primary preview-single-btn" @click="handlePreviewGridGroup">预览 N宫格</button>
            <button class="btn-primary export-single-btn" :disabled="exportingSingle" @click="handleExportGridGroup">{{ exportingSingle ? (exportStatusText || '导出中...') : '导出 N宫格 ZIP' }}</button>
          </div>
        </section>

        <section class="section" v-if="editor.selectedText">
          <div class="section-title">文字属性</div>
          <div class="field"><label>内容</label><input type="text" v-model="editText" placeholder="输入文字..." @input="applyTextEdits" @blur="commitTextEdits" /></div>
          <div class="field-row">
            <div class="field"><label>字号</label><input type="number" v-model.number="editFontSize" min="8" max="200" @input="applyTextEdits" /></div>
            <div class="field"><label>粗细</label><select v-model="editFontWeight" @change="applyTextEdits" class="select-input"><option value="normal">常规</option><option value="bold">粗体</option></select></div>
          </div>
          <div class="field"><label>颜色</label><input type="color" v-model="editFontColor" @input="applyTextEdits" class="color-input" /></div>
        </section>

        <section class="section" v-if="!editor.selectedRegion && !editor.selectedGridGroup && !editor.selectedText && editor.activeTool !== 'brush' && editor.activeTool !== 'eraser' && editor.activeTool !== 'magic-wand'">
          <div class="section-title">属性</div>
          <div class="empty">选择区域、文字或图层以编辑属性</div>
        </section>

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
      </template>

      <template v-else-if="activeTab === 'batch'">
        <BatchCutPanel />
      </template>

      <template v-else-if="activeTab === 'templates'">
        <TemplatePanel />
      </template>

      <template v-else-if="activeTab === 'export'">
        <section class="section">
          <div class="section-title">导出设置</div>
          <div class="field"><label>格式</label>
            <div class="radio-group">
              <label class="radio" v-for="fmt in (['png', 'jpeg', 'webp'] as ImageFormat[])" :key="fmt">
                <input type="radio" :value="fmt" v-model="exp.exportFormat" />{{ fmt.toUpperCase() }}
              </label>
            </div>
          </div>
          <div class="field" v-if="exp.exportFormat === 'jpeg' || exp.exportFormat === 'webp'">
            <label>质量</label>
            <div class="size-control-row">
              <input type="range" min="10" max="100" v-model.number="exp.exportQuality" />
              <label class="numeric-value">
                <input type="number" min="10" max="100" v-model.number="exp.exportQuality" />
                <span>%</span>
              </label>
            </div>
          </div>
          <div class="field">
            <label>设备像素比</label>
            <div class="size-control-row">
              <input type="range" min="1" max="4" step="0.5" v-model.number="exp.exportDpr" />
              <label class="numeric-value">
                <input type="number" min="1" max="4" step="0.5" v-model.number="exp.exportDpr" />
                <span>x</span>
              </label>
            </div>
          </div>
          <div class="field">
            <label class="checkbox-label">
              <input type="checkbox" v-model="exp.upscaleEnabled" />AI 超分 {{ exp.upscaleScale }}×
            </label>
            <div class="upscale-hint" v-if="exp.upscaleEnabled">首次需下载模型 ~7.5 MB，之后缓存</div>
            <div class="field">
              <label>锐化强度</label>
              <div class="size-control-row">
                <input type="range" min="0" max="200" step="10" v-model.number="exp.sharpenAmount" />
                <label class="numeric-value">
                  <input type="number" min="0" max="200" step="10" v-model.number="exp.sharpenAmount" />
                  <span>%</span>
                </label>
              </div>
            </div>
          </div>
          <div v-if="exportResolutionInfo" class="export-res-info">
            <div class="res-row">输出: <strong>{{ exportResolutionInfo.effectivePw }} × {{ exportResolutionInfo.effectivePh }}</strong> px</div>
            <div class="res-row">源图: {{ exportResolutionInfo.srcLabel }}</div>
            <div v-if="exportResolutionInfo.isDprCapped" class="res-warn">DPR 已从 {{ exp.exportDpr }}x 限制为 {{ exportResolutionInfo.effectiveDpr }}x（源图像素不足）</div>
            <div v-else-if="exportResolutionInfo.isOverUpscale" class="res-warn">源图像素不足，建议降低 DPR</div>
          </div>
        </section>

        <ExportSizePanel />
        <ExportNamingPanel />
        <ExportInspectionPanel
          :result="inspectionResult"
          :export-warning="inspectionExportWarning"
          @open="openInspectionResult"
        />
      </template>
      </div>
    </div>

    <div v-if="listCollapsed" class="list-collapsed">
      <button class="expand-list-btn" @click="listCollapsed = false">展开卡片列表</button>
    </div>

    <section v-else class="list-panel" :style="listPanelStyle">
      <div class="list-resizer" title="拖动调整清单高度" @pointerdown="startListResize"></div>
      <div class="list-header">
        <div>
          <div class="list-title">卡片列表</div>
          <div class="list-meta">裁剪 {{ editor.regions.length }} / 文字 {{ editor.textAnnotations.length }}</div>
        </div>
        <button class="collapse-list-btn" title="收起卡片列表" @click="listCollapsed = true">收起</button>
      </div>
      <div class="list-search">
        <input v-model="listSearch" type="search" placeholder="裁剪框搜名称，文字框搜内容" />
      </div>
      <div class="list-scroll scrollbar">
        <div class="list-subtitle">
          <span>裁剪框</span>
          <button class="clear-all-btn" title="一键清空" @click="history.snapshot(); editor.clearRegions()">清空</button>
        </div>
        <div v-if="filteredRegions.length === 0" class="empty list-empty">暂无匹配裁剪框</div>
        <div v-else class="region-list">
          <div
            v-for="r in filteredRegions" :key="r.id"
            class="region-item" :class="{ selected: r.id === editor.selectedRegionId || editor.selectedRegionIds.has(r.id) }"
            @click="selectRegion(r.id, $event)"
          >
            <input type="checkbox" :checked="editor.selectedRegionIds.has(r.id)" class="region-check" @click.stop @change="editor.toggleRegionCheck(r.id)" />
            <span class="region-shape-icon">{{ shapeIcons[r.shape] ?? '▭' }}</span>
            <span class="region-name">{{ r.name }}</span>
            <span class="region-dims">{{ Math.round(r.width) }}×{{ Math.round(r.height) }}</span>
            <button class="region-delete" title="删除" @click.stop="history.snapshot(); editor.deleteRegion(r.id)">×</button>
          </div>
        </div>

        <div class="list-subtitle text-subtitle">
          <span>N宫格</span>
        </div>
        <div v-if="filteredGridGroups.length === 0" class="empty list-empty">暂无匹配 N宫格</div>
        <div v-else class="region-list">
          <div
            v-for="group in filteredGridGroups"
            :key="group.id"
            class="region-item"
            :class="{ selected: group.id === editor.selectedGridGroupId || editor.selectedGridGroupIds.has(group.id) }"
            @click="selectGridGroup(group.id)"
          >
            <input type="checkbox" :checked="editor.selectedGridGroupIds.has(group.id)" class="region-check" @click.stop @change="editor.toggleGridGroupCheck(group.id)" />
            <span class="region-shape-icon">#</span>
            <span class="region-name">{{ group.name }}</span>
            <span class="region-dims">{{ group.rows }}x{{ group.cols }}</span>
            <button class="region-delete" title="删除" @click.stop="history.snapshot(); editor.deleteGridGroup(group.id)">x</button>
          </div>
        </div>

        <div class="list-subtitle text-subtitle">
          <span>文字框</span>
        </div>
        <div v-if="filteredTexts.length === 0" class="empty list-empty">暂无匹配文字框</div>
        <div v-else class="text-list">
          <div
            v-for="t in filteredTexts"
            :key="t.id"
            class="text-item"
            :class="{ selected: t.id === editor.selectedTextId }"
            @click="editor.selectText(t.id)"
          >
            <span class="text-icon">T</span>
            <span class="text-name">{{ t.text || '未命名文字' }}</span>
            <button class="region-delete" title="删除文字" @click.stop="history.snapshot(); editor.deleteText(t.id)">×</button>
          </div>
        </div>
      </div>
    </section>
  </aside>
  <ExportInspectionModal v-model:show="showInspectionModal" :result="modalInspectionResult" />
  <ImageZoomModal :region="previewZoomRegion" v-model:show="previewZoomShow" />
  <PreviewModal ref="gridPreviewModalRef" @export="handleGridPreviewExport" />

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
.sidebar { width: 340px; height: 100%; background: var(--bg-secondary); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; user-select: auto; }
.sidebar.resizing { cursor: row-resize; user-select: none; }
.upper-panel { min-height: 20%; display: flex; flex-direction: column; overflow: hidden; }
.tab-bar { height: 38px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 5px 6px 4px; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-shrink: 0; }
.tab-btn { height: 28px; padding: 0 6px; background: transparent; border: 1px solid transparent; border-radius: var(--radius); color: var(--text-muted); font-size: 12px; }
.tab-btn:hover { background: var(--bg-hover); color: var(--text-secondary); }
.tab-btn.active { background: var(--bg-tertiary); color: var(--accent); border-color: rgba(40, 199, 111, 0.35); }
.panel-body { flex: 1; min-height: 0; overflow-y: auto; }
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.count { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 8px; font-size: 10px; color: var(--text-secondary); }
.layer-title-actions { display: inline-flex; align-items: center; gap: 6px; }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.field-row { display: flex; gap: 8px; }
.field-row .field { flex: 1; }
.size-control-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px;
  gap: 8px;
  align-items: center;
}
.brush-control-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 64px;
  gap: 8px;
  align-items: center;
}
.size-control-row input[type="range"] {
  min-width: 0;
}
.brush-control-row input[type="range"] {
  min-width: 0;
}
.field .numeric-value {
  height: 26px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  margin-bottom: 0;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.numeric-value input {
  min-width: 0;
  width: 100%;
  appearance: textfield;
  -moz-appearance: textfield;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: right;
  outline: none;
  font: inherit;
}
.numeric-value input::-webkit-outer-spin-button,
.numeric-value input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.numeric-value span {
  color: var(--text-muted);
  user-select: none;
}
.readonly-value { padding: 6px 10px; background: var(--bg-primary); border-radius: var(--radius); color: var(--text-muted); font-size: 12px; }
.radio-group { display: flex; gap: 4px; }
.radio { flex: 1; display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 5px 8px; border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; border: 1px solid var(--border); }
.radio:has(input:checked) { border-color: var(--accent); color: var(--accent); }
.radio input { accent-color: var(--accent);  margin-right: 2px; vertical-align: bottom;}
.checkbox-label { display: flex !important; align-items: center; gap: 6px; cursor: pointer; font-size: 12px !important; }
.checkbox-label input { accent-color: var(--accent); }
.empty { font-size: 11px; color: var(--text-muted); }
.export-single-btn { flex: 1; white-space: nowrap; }
.export-layer-icon-btn {
  width: 34px;
  min-width: 34px;
  height: 32px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.export-layer-icon-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.btn-row { display: flex; gap: 6px; }
.color-fields-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.color-fields-row.compact {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.color-pick-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}
.color-pick-btn {
  min-width: 0;
  width: 100%;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
}
.pick-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.preview-single-btn { flex: 1; background: var(--bg-primary); color: var(--accent); border: 1px solid var(--accent); }
.preview-single-btn:hover { opacity: 0.85; }
.preview-single-btn.cancel-mode {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border);
}
.preview-single-btn.cancel-mode:hover:not(:disabled) {
  border-color: var(--text-muted);
  color: var(--text-primary);
}
.preview-single-btn:disabled,
.export-single-btn:disabled,
.export-layer-icon-btn:disabled {
  opacity: 0.6;
  cursor: wait;
  color: var(--text-secondary);
}
.preview-single-btn:disabled {
  background: var(--bg-primary);
  border-color: var(--border-strong);
}
.export-single-btn:disabled,
.export-layer-icon-btn:disabled {
  background: var(--bg-tertiary);
}
.color-input { width: 100%; height: 32px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; padding: 2px; }
.brush-color-input { width: 36px; }
.color-input:disabled { opacity: 0.45; cursor: default; }
.color-tool-row,
.color-action-row {
  display: flex; gap: 6px; margin-bottom: 10px;
}
.scope-radio-group { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.scope-radio-group .radio:has(input:disabled) { opacity: 0.45; cursor: default; }
.manual-range-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) calc((100% - 8px) / 3);
  gap: 6px;
  align-items: center;
  margin: -3px 0 10px;
}
.range-readout {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  min-width: 0; min-height: 32px; padding: 6px 8px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-primary); color: var(--text-muted); font-size: 11px;
}
.range-readout span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.range-select-btn {
  width: 100%;
  height: 32px;
  padding: 0 8px;
}
.inline-clear-btn {
  border: none; background: transparent; color: var(--text-muted);
  font-size: 11px; cursor: pointer; padding: 0;
}
.inline-clear-btn:hover { color: var(--danger); }
.color-check-grid {
  display: grid; grid-template-columns: 1fr; gap: 6px;
  margin: 2px 0 10px; padding: 8px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-primary);
}
.tf-btn.active {
  border-color: rgba(40, 199, 111, 0.52);
  color: var(--accent);
  background: rgba(40, 199, 111, 0.1);
}
.select-input { width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary); font-size: 12px; outline: none; }
.select-input:focus { border-color: var(--accent); }
.region-list { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.region-item {
  display: flex; align-items: center; gap: 7px; padding: 8px 8px;
  border-radius: var(--radius); cursor: pointer; transition: background 0.1s, border-color 0.1s;
  font-size: 12px; flex-shrink: 0; background: var(--bg-primary); border: 1px solid var(--border);
}
.region-item:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.region-item.selected { background: rgba(40, 199, 111, 0.1); border-color: rgba(40, 199, 111, 0.45); outline: none; }
.region-check { flex-shrink: 0; accent-color: var(--accent); cursor: pointer; width: 13px; height: 13px; }
.region-shape-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
.region-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.region-dims { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

.text-list { display: flex; flex-direction: column; gap: 6px; }
.text-item {
  display: flex; align-items: center; gap: 7px; padding: 8px 8px;
  border-radius: var(--radius); cursor: pointer; transition: background 0.1s, border-color 0.1s;
  font-size: 12px; background: var(--bg-primary); border: 1px solid var(--border);
}
.text-item:hover { background: var(--bg-hover); border-color: var(--border-strong); }
.text-item.selected { background: rgba(40, 199, 111, 0.1); border-color: rgba(40, 199, 111, 0.42); outline: none; }
.text-icon { width: 18px; text-align: center; color: var(--accent); font-weight: 700; }
.text-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.list-collapsed { height: 34px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-top: 1px solid var(--border); background: var(--bg-secondary); }
.expand-list-btn,
.collapse-list-btn {
  height: 24px; padding: 0 9px; background: var(--bg-primary); border: 1px solid var(--border);
  color: var(--text-secondary); font-size: 11px;
}
.expand-list-btn:hover,
.collapse-list-btn:hover { border-color: var(--accent); color: var(--text-primary); }
.list-panel { min-height: 20%; max-height: 80%; flex-shrink: 0; position: relative; display: flex; flex-direction: column; border-top: 1px solid var(--border); background: var(--bg-secondary); }
.list-resizer { height: 8px; flex-shrink: 0; cursor: row-resize; position: relative; background: var(--bg-secondary); }
.list-resizer::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 3px;
  width: 46px;
  height: 2px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--border-strong);
}
.list-resizer:hover::before { background: var(--accent); }
.list-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px 6px; flex-shrink: 0; }
.list-title { font-size: 12px; font-weight: 700; color: var(--text-primary); }
.list-meta { margin-top: 2px; font-size: 10px; color: var(--text-muted); }
.list-search { padding: 0 10px 8px; flex-shrink: 0; }
.list-search input {
  width: 100%; height: 30px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-primary); color: var(--text-primary); padding: 0 9px; outline: none;
}
.list-search input:focus { border-color: var(--accent); }
.list-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 10px 12px; }
.list-subtitle { display: flex; align-items: center; justify-content: space-between; margin: 4px 0 5px; color: var(--text-muted); font-size: 11px; font-weight: 700; }
.text-subtitle { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.list-empty { padding: 7px 2px; }

.layer-list { display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
.layer-item { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: var(--radius); cursor: grab; font-size: 11px; }
.layer-item:active { cursor: grabbing; }
.layer-item:hover { background: var(--bg-hover); }
.layer-item.active { background: rgba(40, 199, 111, 0.1); outline: 1px solid rgba(40, 199, 111, 0.32); }
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
.layer-tool-panel {
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.layer-tool-toggle {
  width: 100%; min-height: 30px;
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px;
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-primary); color: var(--text-secondary);
  padding: 6px 8px; cursor: pointer; text-align: left;
}
.layer-tool-toggle:hover,
.layer-tool-toggle.expanded {
  border-color: rgba(40, 199, 111, 0.42);
  background: rgba(40, 199, 111, 0.06);
  color: var(--text-primary);
}
.tool-toggle-main,
.tool-toggle-meta {
  min-width: 0; display: flex; align-items: center; gap: 6px;
}
.tool-toggle-main { font-size: 11px; font-weight: 600; }
.tool-chevron {
  color: var(--text-muted); font-size: 13px; line-height: 1;
  transition: transform 0.14s, color 0.14s;
}
.layer-tool-toggle.expanded .tool-chevron {
  transform: rotate(90deg);
  color: var(--accent);
}
.tool-toggle-meta {
  justify-content: flex-end;
  max-width: 124px;
}
.active-layer-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text-muted); font-size: 10px; font-weight: 400;
}
.color-process-panel {
  padding: 10px 8px 0;
  border-left: 1px solid rgba(40, 199, 111, 0.22);
  margin-left: 10px;
}
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
