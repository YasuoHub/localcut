import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CropRegion, TextAnnotation, ToolType, BrushSettings, EraserSettings } from '../types'

export const useEditorStore = defineStore('editor', () => {
  // ---- image / project state ----
  const imageLoaded = ref(false)
  const imageElement = ref<HTMLImageElement | null>(null)
  const workingCanvas = ref<HTMLCanvasElement | null>(null)

  // ---- regions ----
  const regions = ref<CropRegion[]>([])
  const selectedRegionId = ref<string | null>(null)
  const selectedRegionIds = ref<Set<string>>(new Set())

  // ---- text annotations ----
  const textAnnotations = ref<TextAnnotation[]>([])
  const selectedTextId = ref<string | null>(null)

  // ---- active tool ----
  const activeTool = ref<ToolType>('select')

  // ---- tool settings ----
  const brushSettings = ref<BrushSettings>({ size: 20, color: '#ff0000' })
  const eraserSettings = ref<EraserSettings>({ size: 30 })
  const magicWandTolerance = ref(20)

  // ---- canvas settings ----
  const constrainToImage = ref(false)
  const showOriginal = ref(false)

  // ---- computed ----
  const selectedRegion = computed<CropRegion | null>(() => {
    if (!selectedRegionId.value) return null
    return regions.value.find(r => r.id === selectedRegionId.value) ?? null
  })
  const selectedText = computed<TextAnnotation | null>(() => {
    if (!selectedTextId.value) return null
    return textAnnotations.value.find(t => t.id === selectedTextId.value) ?? null
  })

  // ---- actions ----
  function setTool(tool: ToolType) { activeTool.value = tool }

  function selectRegion(id: string | null) {
    selectedRegionId.value = id
    if (id) selectedTextId.value = null
  }
  function selectText(id: string | null) {
    selectedTextId.value = id
    if (id) selectedRegionId.value = null
  }

  function toggleRegionCheck(id: string) {
    const set = selectedRegionIds.value
    if (set.has(id)) set.delete(id)
    else set.add(id)
  }

  function deleteRegion(id: string) {
    const idx = regions.value.findIndex(r => r.id === id)
    if (idx !== -1) regions.value.splice(idx, 1)
    if (selectedRegionId.value === id) selectedRegionId.value = null
    selectedRegionIds.value.delete(id)
  }

  function deleteText(id: string) {
    const idx = textAnnotations.value.findIndex(t => t.id === id)
    if (idx !== -1) textAnnotations.value.splice(idx, 1)
    if (selectedTextId.value === id) selectedTextId.value = null
  }

  return {
    imageLoaded, imageElement, workingCanvas,
    regions, selectedRegionId, selectedRegionIds, selectedRegion,
    textAnnotations, selectedTextId, selectedText,
    activeTool,
    brushSettings, eraserSettings, magicWandTolerance,
    constrainToImage, showOriginal,
    setTool, selectRegion, selectText,
    toggleRegionCheck, deleteRegion, deleteText,
  }
})
