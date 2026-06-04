import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CropRegion, TextAnnotation } from '../types'
import { useEditorStore } from './editor'

interface Snapshot {
  regions: CropRegion[]
  selectedRegionId: string | null
  textAnnotations: TextAnnotation[]
  selectedTextId: string | null
  workingCanvasImageData: ImageData | null
}

export const useHistoryStore = defineStore('history', () => {
  const undoStack = ref<Snapshot[]>([])
  const redoStack = ref<Snapshot[]>([])
  const maxStack = 50

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function deepCloneRegions(list: CropRegion[]): CropRegion[] {
    return list.map(r => ({ ...r, points: r.points ? [...r.points] : undefined }))
  }
  function deepCloneTexts(list: TextAnnotation[]): TextAnnotation[] {
    return list.map(t => ({ ...t }))
  }

  function snapshot() {
    const editor = useEditorStore()
    const wc = editor.workingCanvas
    let imageData: ImageData | null = null
    if (wc) {
      const ctx = wc.getContext('2d')
      if (ctx) imageData = ctx.getImageData(0, 0, wc.width, wc.height)
    }
    undoStack.value.push({
      regions: deepCloneRegions(editor.regions),
      selectedRegionId: editor.selectedRegionId,
      textAnnotations: deepCloneTexts(editor.textAnnotations),
      selectedTextId: editor.selectedTextId,
      workingCanvasImageData: imageData,
    })
    if (undoStack.value.length > maxStack) undoStack.value.shift()
    redoStack.value = []
  }

  function restoreWorkingCanvas(imageData: ImageData | null) {
    const editor = useEditorStore()
    const wc = editor.workingCanvas
    if (!wc || !imageData) return
    const ctx = wc.getContext('2d')
    if (ctx) ctx.putImageData(imageData, 0, 0)
  }

  function applySnapshot(s: Snapshot) {
    const editor = useEditorStore()
    editor.regions.splice(0, editor.regions.length, ...deepCloneRegions(s.regions))
    editor.selectedRegionId = s.selectedRegionId
    editor.textAnnotations.splice(0, editor.textAnnotations.length, ...deepCloneTexts(s.textAnnotations))
    editor.selectedTextId = s.selectedTextId
    restoreWorkingCanvas(s.workingCanvasImageData)
  }

  function undo() {
    if (undoStack.value.length === 0) return
    const editor = useEditorStore()
    const wc = editor.workingCanvas
    let imageData: ImageData | null = null
    if (wc) {
      const ctx = wc.getContext('2d')
      if (ctx) imageData = ctx.getImageData(0, 0, wc.width, wc.height)
    }
    redoStack.value.push({
      regions: deepCloneRegions(editor.regions),
      selectedRegionId: editor.selectedRegionId,
      textAnnotations: deepCloneTexts(editor.textAnnotations),
      selectedTextId: editor.selectedTextId,
      workingCanvasImageData: imageData,
    })
    const prev = undoStack.value.pop()!
    applySnapshot(prev)
  }

  function redo() {
    if (redoStack.value.length === 0) return
    const editor = useEditorStore()
    const wc = editor.workingCanvas
    let imageData: ImageData | null = null
    if (wc) {
      const ctx = wc.getContext('2d')
      if (ctx) imageData = ctx.getImageData(0, 0, wc.width, wc.height)
    }
    undoStack.value.push({
      regions: deepCloneRegions(editor.regions),
      selectedRegionId: editor.selectedRegionId,
      textAnnotations: deepCloneTexts(editor.textAnnotations),
      selectedTextId: editor.selectedTextId,
      workingCanvasImageData: imageData,
    })
    const next = redoStack.value.pop()!
    applySnapshot(next)
  }

  return { canUndo, canRedo, snapshot, undo, redo }
})
