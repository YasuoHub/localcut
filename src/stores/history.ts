import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CropRegion, TextAnnotation, ImageLayer } from '../types'
import { useEditorStore } from './editor'

interface LayerState {
  id: string; name: string; x: number; y: number; scaleX: number; scaleY: number; visible: boolean
  image: HTMLImageElement
  workingCanvasImageData: ImageData | null
}

interface Snapshot {
  regions: CropRegion[]
  selectedRegionId: string | null
  textAnnotations: TextAnnotation[]
  selectedTextId: string | null
  layerStates: LayerState[]
  activeLayerId: string | null
}

export const useHistoryStore = defineStore('history', () => {
  const undoStack = ref<Snapshot[]>([])
  const redoStack = ref<Snapshot[]>([])
  const maxStack = 20

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function deepCloneRegions(list: CropRegion[]): CropRegion[] {
    return list.map(r => ({ ...r, points: r.points ? [...r.points] : undefined }))
  }
  function deepCloneTexts(list: TextAnnotation[]): TextAnnotation[] {
    return list.map(t => ({ ...t }))
  }

  function snapshotLayerStates(): LayerState[] {
    const editor = useEditorStore()
    return editor.layers.map(l => {
      let wcData: ImageData | null = null
      if (l.workingCanvas) {
        const ctx = l.workingCanvas.getContext('2d')
        if (ctx) wcData = ctx.getImageData(0, 0, l.workingCanvas.width, l.workingCanvas.height)
      }
      return { id: l.id, name: l.name, x: l.x, y: l.y, scaleX: l.scaleX, scaleY: l.scaleY, visible: l.visible, image: l.image, workingCanvasImageData: wcData }
    })
  }

  function restoreLayerStates(states: LayerState[]) {
    const editor = useEditorStore()
    // rebuild layers array from snapshot
    const newLayers: ImageLayer[] = states.map(s => {
      const wc = document.createElement('canvas')
      wc.width = s.image.naturalWidth
      wc.height = s.image.naturalHeight
      if (s.workingCanvasImageData) {
        const ctx = wc.getContext('2d')!
        ctx.putImageData(s.workingCanvasImageData, 0, 0)
      } else {
        wc.getContext('2d')!.drawImage(s.image, 0, 0)
      }
      return { id: s.id, name: s.name, image: s.image, workingCanvas: wc, x: s.x, y: s.y, scaleX: s.scaleX, scaleY: s.scaleY, visible: s.visible }
    })
    editor.layers.splice(0, editor.layers.length, ...newLayers)
  }

  function snapshot() {
    const editor = useEditorStore()
    undoStack.value.push({
      regions: deepCloneRegions(editor.regions),
      selectedRegionId: editor.selectedRegionId,
      textAnnotations: deepCloneTexts(editor.textAnnotations),
      selectedTextId: editor.selectedTextId,
      layerStates: snapshotLayerStates(),
      activeLayerId: editor.activeLayerId,
    })
    if (undoStack.value.length > maxStack) undoStack.value.shift()
    redoStack.value = []
  }

  function applySnapshot(s: Snapshot) {
    const editor = useEditorStore()
    editor.regions.splice(0, editor.regions.length, ...deepCloneRegions(s.regions))
    editor.selectedRegionId = s.selectedRegionId
    editor.textAnnotations.splice(0, editor.textAnnotations.length, ...deepCloneTexts(s.textAnnotations))
    editor.selectedTextId = s.selectedTextId
    restoreLayerStates(s.layerStates)
    editor.activeLayerId = s.activeLayerId
  }

  function undo() {
    if (undoStack.value.length === 0) return
    const editor = useEditorStore()
    redoStack.value.push({
      regions: deepCloneRegions(editor.regions),
      selectedRegionId: editor.selectedRegionId,
      textAnnotations: deepCloneTexts(editor.textAnnotations),
      selectedTextId: editor.selectedTextId,
      layerStates: snapshotLayerStates(),
      activeLayerId: editor.activeLayerId,
    })
    const prev = undoStack.value.pop()!
    applySnapshot(prev)
  }

  function redo() {
    if (redoStack.value.length === 0) return
    const editor = useEditorStore()
    undoStack.value.push({
      regions: deepCloneRegions(editor.regions),
      selectedRegionId: editor.selectedRegionId,
      textAnnotations: deepCloneTexts(editor.textAnnotations),
      selectedTextId: editor.selectedTextId,
      layerStates: snapshotLayerStates(),
      activeLayerId: editor.activeLayerId,
    })
    const next = redoStack.value.pop()!
    applySnapshot(next)
  }

  return { canUndo, canRedo, snapshot, undo, redo }
})
