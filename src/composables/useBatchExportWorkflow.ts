import { computed, ref } from 'vue'
import type { CropRegion, ExportInspectionResult } from '../types'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useExport } from './useExport'
import { inspectExport } from './useExportInspection'

export function useBatchExportWorkflow() {
  const editor = useEditorStore()
  const exp = useExportStore()
  const { exportRegions, downloadZip } = useExport()

  const isExporting = ref(false)
  const exportStatusText = ref('')
  const showInspectionModal = ref(false)
  const inspectionExportWarning = ref('')
  const activeInspectionResult = ref<ExportInspectionResult | null>(null)
  let sharedUpscaleCleanup: (() => void) | null = null

  const exportImageName = computed(() => editor.activeLayer?.name?.replace(/\.[^.]+$/, '') ?? 'image')
  const regionIndexById = computed(() => Object.fromEntries(editor.regions.map((r, i) => [r.id, i + 1])))

  function checkedRegions(): CropRegion[] {
    if (editor.selectedRegionIds.size === 0) return editor.regions
    return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
  }

  const targetRegions = computed(() => checkedRegions())
  const targetCount = computed(() => targetRegions.value.length)
  const checkedCount = computed(() => editor.selectedRegionIds.size)
  const canPreview = computed(() => editor.imageLoaded && editor.regions.length > 0)

  const inspectionResult = computed(() => {
    const bw = exp.batchUseCustomSize ? exp.batchOutputWidth : null
    const bh = exp.batchUseCustomSize ? exp.batchOutputHeight : null
    return inspectExport({
      allRegions: editor.regions,
      targetRegions: targetRegions.value,
      selectedCount: editor.selectedRegionIds.size,
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
  const canExport = computed(() => canPreview.value && targetCount.value > 0 && !inspectionResult.value.hasBlockingIssues && !isExporting.value)

  async function createUpscaleFn(): Promise<((canvas: HTMLCanvasElement) => Promise<HTMLCanvasElement>) | undefined> {
    if (!exp.upscaleEnabled) return undefined
    const { loadModel, upscaleImage, destroy, progress } = (await import('./useSuperResolution')).useSuperResolution()
    sharedUpscaleCleanup = destroy

    exportStatusText.value = '加载超分模型...'
    await loadModel()
    exportStatusText.value = ''

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

  function openInspectionResult() {
    activeInspectionResult.value = null
    showInspectionModal.value = true
  }

  async function handleBatchExport() {
    if (!editor.imageLoaded || editor.regions.length === 0) return
    const toExport = checkedRegions()
    if (toExport.length === 0) return
    if (inspectionResult.value.hasBlockingIssues) {
      inspectionExportWarning.value = '导出体检发现阻断问题，请先查看检测结果。'
      activeInspectionResult.value = null
      showInspectionModal.value = true
      return
    }

    activeInspectionResult.value = null
    inspectionExportWarning.value = ''
    isExporting.value = true
    exportStatusText.value = toExport.length > 1 ? `正在导出 ${toExport.length} 项...` : '正在导出...'
    try {
      const namingOptions = {
        pattern: exp.filenamePattern,
        imageName: exportImageName.value,
        regionIndexById: regionIndexById.value,
      }
      const bw = exp.batchUseCustomSize ? exp.batchOutputWidth : null
      const bh = exp.batchUseCustomSize ? exp.batchOutputHeight : null
      const fit = exp.batchUseCustomSize ? exp.batchFitMode : undefined
      const fill = exp.batchFillColor
      const upscaleFn = await createUpscaleFn()

      const blob = await exportRegions(
        editor.layers, toExport,
        exp.exportFormat, exp.exportQuality, exp.exportDpr,
        editor.showOriginal,
        editor.textAnnotations,
        namingOptions,
        bw, bh, fit, fill,
        upscaleFn,
        exp.sharpenAmount,
      )
      downloadZip(blob)
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      isExporting.value = false
      sharedUpscaleCleanup?.()
      sharedUpscaleCleanup = null
      exportStatusText.value = ''
    }
  }

  return {
    checkedCount,
    targetCount,
    canPreview,
    canExport,
    isExporting,
    exportStatusText,
    inspectionResult,
    modalInspectionResult,
    showInspectionModal,
    inspectionExportWarning,
    openInspectionResult,
    handleBatchExport,
  }
}
