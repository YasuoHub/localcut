import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  ColorProcessAction,
  ColorProcessRect,
  ColorProcessScope,
  CropRegion,
  CropGridGroup,
  TextAnnotation,
  ToolType,
  BrushSettings,
  EraserSettings,
  ImageLayer,
  ColorProcessPreview,
} from '../types'

export const useEditorStore = defineStore('editor', () => {
  const MAX_LAYER_NAME_LENGTH = 100

  function truncateLayerName(name: string) {
    return Array.from(name).slice(0, MAX_LAYER_NAME_LENGTH).join('')
  }

  // ---- layers ----
  const layers = ref<ImageLayer[]>([])
  const activeLayerId = ref<string | null>(null)
  const prevActiveLayerId = ref<string | null>(null)

  const imageLoaded = computed(() => layers.value.length > 0)
  const activeLayer = computed(() => layers.value.find(l => l.id === activeLayerId.value) ?? null)

  function formatLayerName(index: number, fileName?: string) {
    const trimmed = fileName?.trim()
    if (!trimmed) return `图层${index}`
    const chars = Array.from(trimmed)
    const shortName = chars.length > 10 ? `${chars.slice(0, 10).join('')}...` : trimmed
    return truncateLayerName(`图层${index}（${shortName}）`)
  }

  function addLayer(img: HTMLImageElement, name?: string) {
    const id = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const layerIndex = layers.value.length + 1
    const wc = document.createElement('canvas')
    wc.width = img.naturalWidth
    wc.height = img.naturalHeight
    wc.getContext('2d')!.drawImage(img, 0, 0)
    const layer: ImageLayer = {
      id, name: formatLayerName(layerIndex, name),
      image: img,
      workingCanvas: wc,
      x: layerInsertX.value, y: layerInsertY.value,
      scaleX: 1, scaleY: 1,
      visible: true,
    }
    layers.value.push(layer)
    // advance insert position
    if (layerArrangeDirection.value === 'horizontal') {
      layerInsertX.value += img.naturalWidth + layerArrangeGap.value
    } else {
      layerInsertY.value += img.naturalHeight + layerArrangeGap.value
    }
    prevActiveLayerId.value = activeLayerId.value
    activeLayerId.value = id
    return layer
  }

  function removeLayer(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    if (idx === -1) return
    layers.value.splice(idx, 1)
    const newSet = new Set(selectedLayerIds.value)
    newSet.delete(id)
    selectedLayerIds.value = newSet
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

  function clearLayers() {
    layers.value.splice(0)
    activeLayerId.value = null
    prevActiveLayerId.value = null
    selectedLayerIds.value = new Set()
  }

  function setActiveLayer(id: string) {
    if (layers.value.some(l => l.id === id) && activeLayerId.value !== id) {
      prevActiveLayerId.value = activeLayerId.value
      activeLayerId.value = id
    }
  }

  function renameLayer(id: string, name: string) {
    const layer = layers.value.find(l => l.id === id)
    if (layer) layer.name = truncateLayerName(name)
  }

  function moveLayer(fromIdx: number, toIdx: number) {
    if (fromIdx < 0 || fromIdx >= layers.value.length) return
    if (toIdx < 0 || toIdx >= layers.value.length) return
    if (fromIdx === toIdx) return
    const [item] = layers.value.splice(fromIdx, 1)
    layers.value.splice(toIdx, 0, item)
  }

  function moveLayerUp(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    moveLayer(idx, idx - 1)
  }

  function moveLayerDown(id: string) {
    const idx = layers.value.findIndex(l => l.id === id)
    moveLayer(idx, idx + 1)
  }

  // ---- regions ----
  const regions = ref<CropRegion[]>([])
  const gridGroups = ref<CropGridGroup[]>([])
  const selectedRegionId = ref<string | null>(null)
  const selectedGridGroupId = ref<string | null>(null)
  const selectedRegionIds = ref<Set<string>>(new Set())
  const selectedGridGroupIds = ref<Set<string>>(new Set())
  const selectedLayerIds = ref<Set<string>>(new Set())

  const selectedRegion = computed<CropRegion | null>(() => {
    if (!selectedRegionId.value) return null
    return regions.value.find(r => r.id === selectedRegionId.value) ?? null
  })

  const selectedGridGroup = computed<CropGridGroup | null>(() => {
    if (!selectedGridGroupId.value) return null
    return gridGroups.value.find(g => g.id === selectedGridGroupId.value) ?? null
  })

  function selectRegion(id: string | null) {
    selectedRegionId.value = id
    if (id) {
      selectedTextId.value = null
      selectedGridGroupId.value = null
    }
  }

  function selectGridGroup(id: string | null) {
    selectedGridGroupId.value = id
    if (id) {
      selectedRegionId.value = null
      selectedRegionIds.value = new Set()
      selectedTextId.value = null
    }
  }

  function toggleRegionCheck(id: string) {
    const newSet = new Set(selectedRegionIds.value)
    if (newSet.has(id)) { newSet.delete(id) } else { newSet.add(id) }
    selectedRegionIds.value = newSet
  }

  function toggleGridGroupCheck(id: string) {
    const newSet = new Set(selectedGridGroupIds.value)
    if (newSet.has(id)) { newSet.delete(id) } else { newSet.add(id) }
    selectedGridGroupIds.value = newSet
  }

  function deleteRegion(id: string) {
    const idx = regions.value.findIndex(r => r.id === id)
    if (idx !== -1) regions.value.splice(idx, 1)
    if (selectedRegionId.value === id) selectedRegionId.value = null
    const newSet = new Set(selectedRegionIds.value)
    newSet.delete(id)
    selectedRegionIds.value = newSet
  }

  function deleteGridGroup(id: string) {
    const idx = gridGroups.value.findIndex(g => g.id === id)
    if (idx !== -1) gridGroups.value.splice(idx, 1)
    if (selectedGridGroupId.value === id) selectedGridGroupId.value = null
    const newSet = new Set(selectedGridGroupIds.value)
    newSet.delete(id)
    selectedGridGroupIds.value = newSet
  }

  function clearRegions() {
    regions.value.splice(0)
    gridGroups.value.splice(0)
    selectedRegionId.value = null
    selectedGridGroupId.value = null
    selectedRegionIds.value = new Set()
    selectedGridGroupIds.value = new Set()
  }

  function toggleLayerCheck(id: string) {
    const newSet = new Set(selectedLayerIds.value)
    if (newSet.has(id)) { newSet.delete(id) } else { newSet.add(id) }
    selectedLayerIds.value = newSet
  }
  function clearSelectedLayers() {
    selectedLayerIds.value = new Set()
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
    if (id) {
      selectedRegionId.value = null
      selectedGridGroupId.value = null
    }
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

  // ---- layer color processing ----
  const colorProcessSourceColor = ref('#ffffff')
  const colorProcessTargetColor = ref('#ffffff')
  const colorProcessTolerance = ref(28)
  const colorProcessFeather = ref(1)
  const colorProcessScope = ref<ColorProcessScope>('layer')
  const colorProcessAction = ref<ColorProcessAction>('transparent')
  const colorProcessContiguous = ref(false)
  const colorProcessRemoveFringe = ref(true)
  const colorProcessDespeckle = ref(true)
  const colorProcessManualRect = ref<ColorProcessRect | null>(null)
  const colorProcessSeedPoint = ref<{ x: number; y: number } | null>(null)
  const colorProcessPickingColor = ref(false)
  const colorProcessPickingTargetColor = ref(false)
  const colorProcessSelectingRect = ref(false)
  const colorProcessPreview = ref<ColorProcessPreview | null>(null)

  function startColorPick() {
    colorProcessPickingColor.value = true
    colorProcessPickingTargetColor.value = false
    colorProcessSelectingRect.value = false
  }

  function startColorTargetPick() {
    colorProcessPickingColor.value = false
    colorProcessPickingTargetColor.value = true
    colorProcessSelectingRect.value = false
  }

  function startColorRectSelect() {
    colorProcessSelectingRect.value = true
    colorProcessPickingColor.value = false
    colorProcessPickingTargetColor.value = false
    colorProcessScope.value = 'manual'
  }

  function cancelColorProcessCanvasMode() {
    colorProcessPickingColor.value = false
    colorProcessPickingTargetColor.value = false
    colorProcessSelectingRect.value = false
  }

  function setColorProcessManualRect(rect: ColorProcessRect | null) {
    colorProcessManualRect.value = rect
    if (rect) colorProcessScope.value = 'manual'
    colorProcessPreview.value = null
    invalidateCanvas()
  }

  function setColorProcessPreview(preview: ColorProcessPreview | null) {
    colorProcessPreview.value = preview
    invalidateCanvas()
  }

  // ---- canvas settings ----
  const constrainToImage = ref(false)
  const showOriginal = ref(false)
  const showLayerNames = ref(true)
  const snapToGuides = ref(true)

  // 单图层模式下强制约束裁剪框在图层内
  const isSingleLayerMode = computed(() => layers.value.length === 1)

  // ---- layer arrangement ----
  const layerArrangeDirection = ref<'horizontal' | 'vertical'>('horizontal')
  const layerArrangeGap = ref(0)
  const layerInsertX = ref(0)
  const layerInsertY = ref(0)

  // ---- heavy processing indicator ----
  const isHeavyProcessing = ref(false)
  const heavyProcessingText = ref('')

  // ---- render trigger ----
  const canvasVersion = ref(0)
  function invalidateCanvas() { canvasVersion.value++ }

  // ---- guide lines ----
  const hGuides = ref<number[]>([]) // y positions
  const vGuides = ref<number[]>([]) // x positions
  const activeGuide = ref<{ axis: 'h' | 'v'; index: number; value: number } | null>(null)

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
  function moveHGuide(index: number, y: number) {
    if (index < 0 || index >= hGuides.value.length) return
    hGuides.value[index] = Math.round(y)
    activeGuide.value = { axis: 'h', index, value: hGuides.value[index] }
    invalidateCanvas()
  }
  function moveVGuide(index: number, x: number) {
    if (index < 0 || index >= vGuides.value.length) return
    vGuides.value[index] = Math.round(x)
    activeGuide.value = { axis: 'v', index, value: vGuides.value[index] }
    invalidateCanvas()
  }
  function sortGuides() {
    hGuides.value = [...new Set(hGuides.value.map(Math.round))].sort((a, b) => a - b)
    vGuides.value = [...new Set(vGuides.value.map(Math.round))].sort((a, b) => a - b)
    activeGuide.value = null
    invalidateCanvas()
  }
  function clearGuides() {
    hGuides.value = []
    vGuides.value = []
    activeGuide.value = null
    invalidateCanvas()
  }

  return {
    layers, activeLayerId, activeLayer, imageLoaded,
    addLayer, removeLayer, clearLayers, setActiveLayer, renameLayer, moveLayer, moveLayerUp, moveLayerDown, toggleLayerVisible,
    regions, gridGroups, selectedRegionId, selectedGridGroupId, selectedRegionIds, selectedGridGroupIds, selectedRegion, selectedGridGroup,
    selectRegion, selectGridGroup, toggleRegionCheck, toggleGridGroupCheck, deleteRegion, deleteGridGroup, clearRegions,
    selectedLayerIds, toggleLayerCheck, clearSelectedLayers,
    textAnnotations, selectedTextId, selectedText,
    selectText, deleteText,
    activeTool, setTool,
    brushSettings, eraserSettings, magicWandTolerance,
    colorProcessSourceColor, colorProcessTargetColor, colorProcessTolerance, colorProcessFeather,
    colorProcessScope, colorProcessAction, colorProcessContiguous,
    colorProcessRemoveFringe, colorProcessDespeckle,
    colorProcessManualRect, colorProcessSeedPoint,
    colorProcessPickingColor, colorProcessPickingTargetColor, colorProcessSelectingRect, colorProcessPreview,
    startColorPick, startColorTargetPick, startColorRectSelect, cancelColorProcessCanvasMode,
    setColorProcessManualRect, setColorProcessPreview,
    constrainToImage, showOriginal, showLayerNames, snapToGuides, isSingleLayerMode,
    isHeavyProcessing, heavyProcessingText,
    canvasVersion, invalidateCanvas,
    hGuides, vGuides, activeGuide,
    addHGuide, addVGuide, removeHGuide, removeVGuide, moveHGuide, moveVGuide, sortGuides, clearGuides,
    layerArrangeDirection, layerArrangeGap,
  }
})
