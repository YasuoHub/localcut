import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ImageFormat, BatchOutputFitMode } from '../types'

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

  // naming
  const filenamePattern = ref('{imageName}_{regionName}_{index:3}')
  const selectedPlatformPresetId = ref<string | null>(null)

  function applyPlatformPreset(width: number, height: number) {
    batchUseCustomSize.value = true
    batchOutputWidth.value = width
    batchOutputHeight.value = height
  }

  return {
    exportFormat, exportQuality,
    exportOutputWidth, exportOutputHeight,
    exportLockAspect, exportDpr,
    customOutputSize,
    batchUseCustomSize, batchOutputWidth, batchOutputHeight,
    batchFitMode, batchFillColor,
    filenamePattern, selectedPlatformPresetId,
    applyPlatformPreset,
  }
})
