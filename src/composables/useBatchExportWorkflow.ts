import { computed, ref } from 'vue'
import type { CropRegion, ExportInspectionResult } from '../types'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useExport } from './useExport'
import { inspectExport } from './useExportInspection'
import { expandGridGroup } from './useGridGroups'
import { PERFORMANCE_LIMITS, estimateEncodedBytes, formatBytes, formatMegapixels, imagePixels } from '../constants/performanceLimits'

export function useBatchExportWorkflow() {
  const editor = useEditorStore()
  const exp = useExportStore()
  const { exportRegionsAndGridGroups, downloadZip } = useExport()

  const isExporting = ref(false)
  const exportStatusText = ref('')
  const showInspectionModal = ref(false)
  const inspectionExportWarning = ref('')
  const activeInspectionResult = ref<ExportInspectionResult | null>(null)
  let sharedUpscaleCleanup: (() => void) | null = null

  const exportImageName = computed(() => editor.activeLayer?.name?.replace(/\.[^.]+$/, '') ?? 'image')
  const expandedGridRegions = computed(() => editor.gridGroups.flatMap(group => expandGridGroup(group)))
  const allInspectableRegions = computed(() => [...editor.regions, ...expandedGridRegions.value])
  const regionIndexById = computed(() => Object.fromEntries(allInspectableRegions.value.map((r, i) => [r.id, i + 1])))

  function checkedRegions(): CropRegion[] {
    if (editor.selectedRegionIds.size === 0 && editor.selectedGridGroupIds.size === 0) return editor.regions
    return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
  }

  function checkedGridGroups() {
    if (editor.selectedGridGroupIds.size > 0) return editor.gridGroups.filter(g => editor.selectedGridGroupIds.has(g.id))
    return editor.selectedRegionIds.size === 0 ? editor.gridGroups : []
  }

  const targetRegions = computed(() => checkedRegions())
  const targetGridGroups = computed(() => checkedGridGroups())
  const targetInspectableRegions = computed(() => [
    ...targetRegions.value,
    ...targetGridGroups.value.flatMap(group => expandGridGroup(group)),
  ])
  const targetCount = computed(() => targetRegions.value.length + targetGridGroups.value.length)
  const checkedCount = computed(() => editor.selectedRegionIds.size + editor.selectedGridGroupIds.size)
  const canPreview = computed(() => editor.imageLoaded && (editor.regions.length > 0 || editor.gridGroups.length > 0))

  function projectedOutputPixels(region: CropRegion) {
    const baseWidth = exp.batchUseCustomSize && exp.batchOutputWidth ? exp.batchOutputWidth : region.width
    const baseHeight = exp.batchUseCustomSize && exp.batchOutputHeight ? exp.batchOutputHeight : region.height
    const upscaleFactor = exp.upscaleEnabled ? 2 : 1
    return imagePixels(baseWidth * upscaleFactor * exp.exportDpr, baseHeight * upscaleFactor * exp.exportDpr)
  }

  const performanceGate = computed(() => {
    const limits = PERFORMANCE_LIMITS.export
    const regions = targetInspectableRegions.value
    const outputPixels = regions.map(projectedOutputPixels)
    const itemCount = regions.length
    const totalPixels = outputPixels.reduce((sum, pixels) => sum + pixels, 0)
    const maxItemPixels = outputPixels.length > 0 ? Math.max(...outputPixels) : 0
    const estimatedZipBytes = estimateEncodedBytes(totalPixels, exp.exportFormat, exp.exportQuality)
    const blocking: string[] = []
    const warnings: string[] = []

    if (itemCount > limits.maxBatchItems) {
      blocking.push(`本次会导出 ${itemCount} 张图片，超过 ${limits.maxBatchItems} 张硬上限。请拆成多批导出。`)
    } else if (itemCount > limits.warnBatchItems) {
      warnings.push(`本次会导出 ${itemCount} 张图片，已接近建议上限 ${limits.warnBatchItems} 张。`)
    }

    if (exp.upscaleEnabled && itemCount > limits.aiUpscaleMaxBatchItems) {
      blocking.push(`开启 AI 超分时最多一次导出 ${limits.aiUpscaleMaxBatchItems} 张，请关闭超分或拆批。`)
    } else if (exp.upscaleEnabled && itemCount > limits.aiUpscaleWarnBatchItems) {
      warnings.push(`AI 超分会额外占用模型、tile 和 ImageData 内存，本次 ${itemCount} 张建议拆批。`)
    }

    if (maxItemPixels > limits.maxOutputPixelsPerItem) {
      blocking.push(`单张最大输出约 ${formatMegapixels(maxItemPixels)}，超过 ${formatMegapixels(limits.maxOutputPixelsPerItem)} 上限。请降低输出尺寸、DPR 或关闭超分。`)
    } else if (maxItemPixels > limits.warnOutputPixelsPerItem) {
      warnings.push(`单张最大输出约 ${formatMegapixels(maxItemPixels)}，导出时可能短暂卡顿。`)
    }

    if (exp.upscaleEnabled && maxItemPixels > limits.aiUpscaleMaxOutputPixelsPerItem) {
      blocking.push(`开启 AI 超分后单张最大输出约 ${formatMegapixels(maxItemPixels)}，超过超分安全上限 ${formatMegapixels(limits.aiUpscaleMaxOutputPixelsPerItem)}。`)
    }

    if (totalPixels > limits.maxTotalOutputPixels) {
      blocking.push(`本批总输出约 ${formatMegapixels(totalPixels)}，超过 ${formatMegapixels(limits.maxTotalOutputPixels)} 上限。请减少勾选区域或拆批。`)
    } else if (totalPixels > limits.warnTotalOutputPixels) {
      warnings.push(`本批总输出约 ${formatMegapixels(totalPixels)}，ZIP 生成时内存峰值会明显升高。`)
    }

    if (estimatedZipBytes > limits.zipHardLimitBytes) {
      blocking.push(`预计 ZIP 结果约 ${formatBytes(estimatedZipBytes)}，超过 ${formatBytes(limits.zipHardLimitBytes)} 安全上限。请拆批或降低格式质量。`)
    } else if (estimatedZipBytes > limits.zipWarningBytes) {
      warnings.push(`预计 ZIP 结果约 ${formatBytes(estimatedZipBytes)}，生成 ZIP 会额外占用一份内存。`)
    }

    return {
      blocking,
      warnings,
      itemCount,
      totalPixels,
      estimatedZipBytes,
      hasBlockingIssues: blocking.length > 0,
      hasWarnings: warnings.length > 0,
    }
  })

  const inspectionResult = computed(() => {
    const bw = exp.batchUseCustomSize ? exp.batchOutputWidth : null
    const bh = exp.batchUseCustomSize ? exp.batchOutputHeight : null
    return inspectExport({
      allRegions: allInspectableRegions.value,
      targetRegions: targetInspectableRegions.value,
      selectedCount: checkedCount.value,
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
    if (!editor.imageLoaded || (editor.regions.length === 0 && editor.gridGroups.length === 0)) return
    const toExport = checkedRegions()
    const groupsToExport = checkedGridGroups()
    if (toExport.length === 0 && groupsToExport.length === 0) return
    if (inspectionResult.value.hasBlockingIssues) {
      inspectionExportWarning.value = '导出体检发现阻断问题，请先查看检测结果。'
      activeInspectionResult.value = null
      showInspectionModal.value = true
      return
    }
    if (performanceGate.value.hasBlockingIssues) {
      window.alert(['本次导出超过性能安全上限：', ...performanceGate.value.blocking].join('\n'))
      return
    }
    if (performanceGate.value.hasWarnings) {
      const ok = window.confirm([
        '本次导出接近性能上限，可能出现明显卡顿。',
        ...performanceGate.value.warnings,
        '是否继续导出？',
      ].join('\n'))
      if (!ok) return
    }

    activeInspectionResult.value = null
    inspectionExportWarning.value = ''
    isExporting.value = true
    const topLevelCount = toExport.length + groupsToExport.length
    exportStatusText.value = topLevelCount > 1 ? `正在导出 ${topLevelCount} 项...` : '正在导出...'
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

      const blob = await exportRegionsAndGridGroups(
        editor.layers, toExport, groupsToExport,
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
    performanceGate,
    modalInspectionResult,
    showInspectionModal,
    inspectionExportWarning,
    openInspectionResult,
    handleBatchExport,
  }
}
