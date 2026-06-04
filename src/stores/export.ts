import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ImageFormat } from '../types'

export const useExportStore = defineStore('export', () => {
  const exportFormat = ref<ImageFormat>('png')
  const exportQuality = ref(90)
  const exportOutputWidth = ref<number | null>(null)
  const exportOutputHeight = ref<number | null>(null)
  const exportLockAspect = ref(true)
  const exportDpr = ref(2)
  const customOutputSize = ref(false)

  return {
    exportFormat, exportQuality,
    exportOutputWidth, exportOutputHeight,
    exportLockAspect, exportDpr,
    customOutputSize,
  }
})
