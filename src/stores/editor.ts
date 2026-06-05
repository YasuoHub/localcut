import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CropRegion, TextAnnotation, ToolType, BrushSettings, EraserSettings, ImageLayer } from '../types'

export const useEditorStore = defineStore('editor', () => {
  // ---- layers ----
  const layers = ref<ImageLayer[]>([])
  const activeLayerId = ref<string | null>(null)
  const prevActiveLayerId = ref<string | null>(null)

  const imageLoaded = computed(() => layers.value.length > 0)
  const activeLayer = computed(() => layers.value.find(l => l.id === activeLayerId.value) ?? null)

  function addLayer(img: HTMLImageElement, name?: string) {
    const id = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const wc = document.createElement('canvas')
    wc.width = img.naturalWidth
    wc.height = img.naturalHeight
    wc.getContext('2d')!.drawImage(img, 0, 0)
    const offset = layers.value.length * 30
    const layer: ImageLayer = {
      id, name: name || `图层 ${layers.value.length + 1}`,
      image: img,
      workingCanvas: wc,
      x: offset, y: offset,
      scaleX: 1, scaleY: 1,
      visible: true,
    }
    layers.value.push(layer)
    prevActiveLayerId.value = activeLayerId.value
    activeLayerId.value = id
    return layer
  }

  function removeLayer(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    if (idx === -1) return
    layers.value.splice(idx, 1)
    if (activeLayerId.value === id) {
      // prefer previous active, then previous in list, then any remaining
      if (prevActiveLayerId.value && layers.value.some(l => l.id === prevActiveLayerId.value)) {
        activeLayerId.value = prevActiveLayerId.value
      } else if (layers.value.length > 0) {
        activeLayerId.value = layers.value[Math.min(idx, layers.value.length - 1)].id
      } else {
        activeLayerId.value = null
      }
    }
  }

  function setActiveLayer(id: string) {
    if (layers.value.some(l => l.id === id) && activeLayerId.value !== id) {
      prevActiveLayerId.value = activeLayerId.value
      activeLayerId.value = id
    }
  }

  function renameLayer(id: string, name: string) {
    const layer = layers.value.find(l => l.id === id)
    if (layer) layer.name = name
  }

  function moveLayerUp(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    if (idx > 0) {
      const [item] = layers.value.splice(idx, 1)
      layers.value.splice(idx - 1, 0, item)
    }
  }

  function moveLayerDown(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    if (idx < layers.value.length - 1) {
      const [item] = layers.value.splice(idx, 1)
      layers.value.splice(idx + 1, 0, item)
    }
  }

  // ---- regions ----
  const regions = ref<CropRegion[]>([])
  const selectedRegionId = ref<string | null>(null)
  const selectedRegionIds = ref<Set<string>>(new Set())

  const selectedRegion = computed<CropRegion | null>(() => {
    if (!selectedRegionId.value) return null
    return regions.value.find(r => r.id === selectedRegionId.value) ?? null
  })

  function selectRegion(id: string | null) {
    selectedRegionId.value = id
    if (id) selectedTextId.value = null
  }

  function toggleRegionCheck(id: string) {
    const newSet = new Set(selectedRegionIds.value)
    if (newSet.has(id)) { newSet.delete(id) } else { newSet.add(id) }
    selectedRegionIds.value = newSet
  }

  function deleteRegion(id: string) {
    const idx = regions.value.findIndex(r => r.id === id)
    if (idx !== -1) regions.value.splice(idx, 1)
    if (selectedRegionId.value === id) selectedRegionId.value = null
    const newSet = new Set(selectedRegionIds.value)
    newSet.delete(id)
    selectedRegionIds.value = newSet
  }

  function clearRegions() {
    regions.value.splice(0)
    selectedRegionId.value = null
    selectedRegionIds.value = new Set()
  }

  function toggleLayerVisible(id: string) {
    const layer = layers.value.find(l => l.id === id)
    if (layer) layer.visible = !layer.visible
  }

  // ---- text annotations ----
  const textAnnotations = ref<TextAnnotation[]>([])
  const selectedTextId = ref<string | null>(null)

  const selectedText = computed<TextAnnotation | null>(() => {
    if (!selectedTextId.value) return null
    return textAnnotations.value.find(t => t.id === selectedTextId.value) ?? null
  })

  function selectText(id: string | null) {
    selectedTextId.value = id
    if (id) selectedRegionId.value = null
  }

  function deleteText(id: string) {
    const idx = textAnnotations.value.findIndex(t => t.id === id)
    if (idx !== -1) textAnnotations.value.splice(idx, 1)
    if (selectedTextId.value === id) selectedTextId.value = null
  }

  // ---- active tool ----
  const activeTool = ref<ToolType>('select')
  function setTool(tool: ToolType) { activeTool.value = tool }

  // ---- tool settings ----
  const brushSettings = ref<BrushSettings>({ size: 20, color: '#ff0000' })
  const eraserSettings = ref<EraserSettings>({ size: 30 })
  const magicWandTolerance = ref(20)

  // ---- canvas settings ----
  const constrainToImage = ref(false)
  const showOriginal = ref(false)

  // ---- render trigger ----
  const canvasVersion = ref(0)
  function invalidateCanvas() { canvasVersion.value++ }

  // ---- guide lines ----
  const hGuides = ref<number[]>([]) // y positions
  const vGuides = ref<number[]>([]) // x positions

  function addHGuide(y: number) {
    const rounded = Math.round(y)
    if (!hGuides.value.includes(rounded)) {
      hGuides.value = [...hGuides.value, rounded].sort((a, b) => a - b)
      invalidateCanvas()
    }
  }
  function addVGuide(x: number) {
    const rounded = Math.round(x)
    if (!vGuides.value.includes(rounded)) {
      vGuides.value = [...vGuides.value, rounded].sort((a, b) => a - b)
      invalidateCanvas()
    }
  }
  function removeHGuide(y: number) {
    hGuides.value = hGuides.value.filter(g => Math.abs(g - y) > 4)
    invalidateCanvas()
  }
  function removeVGuide(x: number) {
    vGuides.value = vGuides.value.filter(g => Math.abs(g - x) > 4)
    invalidateCanvas()
  }
  function clearGuides() {
    hGuides.value = []
    vGuides.value = []
    invalidateCanvas()
  }

  return {
    layers, activeLayerId, activeLayer, imageLoaded,
    addLayer, removeLayer, setActiveLayer, renameLayer, moveLayerUp, moveLayerDown, toggleLayerVisible,
    regions, selectedRegionId, selectedRegionIds, selectedRegion,
    selectRegion, toggleRegionCheck, deleteRegion, clearRegions,
    textAnnotations, selectedTextId, selectedText,
    selectText, deleteText,
    activeTool, setTool,
    brushSettings, eraserSettings, magicWandTolerance,
    constrainToImage, showOriginal,
    canvasVersion, invalidateCanvas,
    hGuides, vGuides, addHGuide, addVGuide, removeHGuide, removeVGuide, clearGuides,
  }
})
