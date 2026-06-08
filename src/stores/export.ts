import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ImageFormat, BatchOutputFitMode, ExportInspectionSettings, CropTemplateExportSettings } from '../types'

export const useExportStore = defineStore('export', () => {
  const exportFormat = ref<ImageFormat>('png')
  const exportQuality = ref(90)
  const exportOutputWidth = ref<number | null>(null)
  const exportOutputHeight = ref<number | null>(null)
  const exportLockAspect = ref(true)
  const exportDpr = ref(2)
  const customOutputSize = ref(false)

  // batch export
  const batchUseCustomSize = ref(false)
  const batchOutputWidth = ref<number | null>(800)
  const batchOutputHeight = ref<number | null>(800)
  const batchFitMode = ref<BatchOutputFitMode>('cover')
  const batchFillColor = ref('#ffffff')

  // AI upscale
  const upscaleEnabled = ref(false)
  const upscaleScale = ref(2) // 2× or 4×

  // sharpening
  const sharpenAmount = ref(0) // 0 = off, 50 = subtle, 100 = standard, 200 = strong

  // naming
  const filenamePattern = ref('{imageName}_{regionName}_{index:3}')
  const singleUseFilenamePattern = ref(true)
  const selectedPlatformPresetId = ref<string | null>(null)

  // export inspection
  const inspectionSettings = ref<ExportInspectionSettings>({
    regionCount: true,
    checkedCount: true,
    outputSize: true,
    filenameDuplicate: true,
    unknownVariable: true,
    activeLayerBounds: true,
    visibleLayerCoverage: true,
    sourcePixels: true,
  })

  function applyPlatformPreset(width: number, height: number) {
    batchUseCustomSize.value = true
    batchOutputWidth.value = width
    batchOutputHeight.value = height
  }

  function createTemplateExportSettings(options: {
    size: boolean
    fit: boolean
    fill: boolean
    naming: boolean
    formatQuality: boolean
  }): CropTemplateExportSettings {
    const settings: CropTemplateExportSettings = {}
    if (options.size) {
      settings.batchUseCustomSize = batchUseCustomSize.value
      settings.batchOutputWidth = batchOutputWidth.value
      settings.batchOutputHeight = batchOutputHeight.value
    }
    if (options.fit) settings.batchFitMode = batchFitMode.value
    if (options.fill) settings.batchFillColor = batchFillColor.value
    if (options.naming) {
      settings.filenamePattern = filenamePattern.value
      settings.singleUseFilenamePattern = singleUseFilenamePattern.value
    }
    if (options.formatQuality) {
      settings.exportFormat = exportFormat.value
      settings.exportQuality = exportQuality.value
    }
    return settings
  }

  function applyTemplateExportSettings(settings: CropTemplateExportSettings) {
    if (typeof settings.batchUseCustomSize === 'boolean') batchUseCustomSize.value = settings.batchUseCustomSize
    if (settings.batchOutputWidth !== undefined) batchOutputWidth.value = settings.batchOutputWidth
    if (settings.batchOutputHeight !== undefined) batchOutputHeight.value = settings.batchOutputHeight
    if (settings.batchFitMode) batchFitMode.value = settings.batchFitMode
    if (settings.batchFillColor) batchFillColor.value = settings.batchFillColor
    if (settings.filenamePattern) filenamePattern.value = settings.filenamePattern
    if (typeof settings.singleUseFilenamePattern === 'boolean') singleUseFilenamePattern.value = settings.singleUseFilenamePattern
    if (settings.exportFormat) exportFormat.value = settings.exportFormat
    if (typeof settings.exportQuality === 'number') exportQuality.value = settings.exportQuality
  }

  return {
    exportFormat, exportQuality,
    exportOutputWidth, exportOutputHeight,
    exportLockAspect, exportDpr,
    customOutputSize,
    batchUseCustomSize, batchOutputWidth, batchOutputHeight,
    batchFitMode, batchFillColor,
    upscaleEnabled, upscaleScale,
    sharpenAmount,
    filenamePattern, singleUseFilenamePattern, selectedPlatformPresetId,
    inspectionSettings,
    applyPlatformPreset,
    createTemplateExportSettings,
    applyTemplateExportSettings,
  }
})
