<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import TopBar from './components/TopBar.vue'
import LeftSidebar from './components/LeftSidebar.vue'
import CanvasWorkspace from './components/CanvasWorkspace.vue'
import RightSidebar from './components/RightSidebar.vue'
import DeliveryBar from './components/DeliveryBar.vue'
import ImageCompressModal from './components/ImageCompressModal.vue'
import MattingWorkspace from './components/matting/MattingWorkspace.vue'
import { useEditorStore } from './stores/editor'
import { useHistoryStore } from './stores/history'
import { useMattingStore } from './stores/matting'
import {
  buildImportFeedback,
  getEditorLayerPixels,
  loadImageFromFile,
  validateEditorImageFiles,
  validateImageBeforeLayerAdd,
} from './utils/editorImageImport'

const editor = useEditorStore()
const history = useHistoryStore()
const matting = useMattingStore()
const canvasWorkspace = ref<InstanceType<typeof CanvasWorkspace> | null>(null)
const mattingWorkspace = ref<InstanceType<typeof MattingWorkspace> | null>(null)
const showImageCompressModal = ref(false)
let removeOpenFilesListener: (() => void) | undefined
let removeMenuCommandListener: (() => void) | undefined

type ElectronImageFile = { name: string; dataUrl: string }
type ElectronMenuCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all'

function addImageLayerFromDataUrl(dataUrl: string, name?: string) {
  const img = new Image()
  img.onload = () => {
    const check = validateImageBeforeLayerAdd(img, getEditorLayerPixels(editor.layers), name)
    if (!check.ok) {
      window.alert(check.message)
      return
    }
    if (check.message) window.alert(check.message)
    editor.addLayer(img, name)
    canvasWorkspace.value?.fitToCanvas()
  }
  img.src = dataUrl
}

async function handleUploadImage(files: File[]) {
  const check = validateEditorImageFiles(files, editor.layers.length)
  const rejected = [...check.rejected]
  const warnings = [...check.warnings]
  let addedCount = 0

  for (const file of check.accepted) {
    try {
      const img = await loadImageFromFile(file)
      const layerCheck = validateImageBeforeLayerAdd(img, getEditorLayerPixels(editor.layers), file.name)
      if (!layerCheck.ok) {
        rejected.push(layerCheck.message)
        continue
      }
      if (layerCheck.message) warnings.push(layerCheck.message)
      editor.addLayer(img, file.name)
      addedCount++
    } catch (err) {
      rejected.push(err instanceof Error ? err.message : `${file.name}: 图片解码失败`)
    }
  }
  if (addedCount > 0) canvasWorkspace.value?.fitToCanvas()

  const feedback = buildImportFeedback(rejected, [...new Set(warnings)])
  if (feedback) window.alert(feedback)
}

function getFocusedEditable(): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return null
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el
  return el.isContentEditable ? el : null
}

async function runNativeEditCommand(command: ElectronMenuCommand, el: HTMLInputElement | HTMLTextAreaElement | HTMLElement) {
  if (command === 'select-all') {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.select()
    } else {
      const range = document.createRange()
      range.selectNodeContents(el)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    return
  }

  if (command === 'paste' && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText()
      el.setRangeText(text, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return
    } catch {
      // Fall back to execCommand below.
    }
  }

  document.execCommand(command)
}

function selectAllCanvasRegions() {
  editor.selectedRegionIds = new Set(editor.regions.map(r => r.id))
  editor.selectedGridGroupIds = new Set(editor.gridGroups.map(g => g.id))
  editor.selectedRegionId = editor.regions[0]?.id ?? null
  editor.selectedGridGroupId = editor.gridGroups[0]?.id ?? null
  editor.selectedTextId = null
  canvasWorkspace.value?.scheduleRender()
}

function deleteSelectedCanvasObject() {
  if (editor.selectedRegionIds.size > 0 || editor.selectedGridGroupIds.size > 0) {
    history.snapshot()
    for (const id of [...editor.selectedRegionIds]) editor.deleteRegion(id)
    for (const id of [...editor.selectedGridGroupIds]) editor.deleteGridGroup(id)
    canvasWorkspace.value?.scheduleRender()
    return
  }
  if (editor.selectedGridGroupId) {
    canvasWorkspace.value?.deleteGridGroup(editor.selectedGridGroupId)
    return
  }
  if (editor.selectedRegionId) {
    canvasWorkspace.value?.deleteRegion(editor.selectedRegionId)
    return
  }
  if (editor.selectedTextId) {
    canvasWorkspace.value?.deleteText(editor.selectedTextId)
  }
}

function runCanvasEditCommand(command: ElectronMenuCommand) {
  const mattingActive = matting.stage !== 'idle'
  if (mattingActive) return

  if (command === 'undo') {
    history.undo()
    canvasWorkspace.value?.scheduleRender()
  } else if (command === 'redo') {
    history.redo()
    canvasWorkspace.value?.scheduleRender()
  } else if (command === 'copy') {
    canvasWorkspace.value?.copySelectedRegion()
  } else if (command === 'paste') {
    canvasWorkspace.value?.pasteRegion()
  } else if (command === 'cut') {
    canvasWorkspace.value?.copySelectedRegion()
    deleteSelectedCanvasObject()
  } else if (command === 'select-all') {
    selectAllCanvasRegions()
  }
}

async function handleMenuCommand(command: ElectronMenuCommand) {
  const editable = getFocusedEditable()
  if (editable) {
    await runNativeEditCommand(command, editable)
    return
  }

  runCanvasEditCommand(command)
}

function handleKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

  // 智能抠图模块打开时不处理编辑器的 Ctrl+Z/Y（模块内部独立处理）
  const mattingActive = matting.stage !== 'idle'
  const commandKey = e.ctrlKey || e.metaKey
  if (commandKey && !isInput) {
    const key = e.key.toLowerCase()
    const commandMap: Record<string, ElectronMenuCommand> = {
      z: 'undo',
      y: 'redo',
      c: 'copy',
      v: 'paste',
      x: 'cut',
      a: 'select-all',
    }
    const command = commandMap[key]
    if (command && !mattingActive) {
      e.preventDefault()
      runCanvasEditCommand(command)
      return
    }
  }
  if (e.key === 'Escape' && !mattingActive) { canvasWorkspace.value?.cancelCustomPolygon() }
  if (e.key === 'Enter' && !isInput) { canvasWorkspace.value?.finalizeCustomPolygon?.() }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
    // batch delete if multi-select has items
    if (editor.selectedRegionIds.size > 0 || editor.selectedGridGroupIds.size > 0) {
      history.snapshot()
      const ids = [...editor.selectedRegionIds]
      for (const id of ids) {
        editor.deleteRegion(id)
      }
      for (const id of [...editor.selectedGridGroupIds]) {
        editor.deleteGridGroup(id)
      }
      canvasWorkspace.value?.scheduleRender()
    } else {
      const sel = editor.selectedRegionId
      if (sel) canvasWorkspace.value?.deleteRegion(sel)
      else if (editor.selectedGridGroupId) canvasWorkspace.value?.deleteGridGroup(editor.selectedGridGroupId)
    }
  }
  // arrow key nudge
  if (!isInput && (editor.selectedRegionId || editor.selectedGridGroupId || editor.selectedRegionIds.size > 0 || editor.selectedGridGroupIds.size > 0)) {
    const step = e.shiftKey ? 10 : 1
    let dx = 0, dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    if (dx !== 0 || dy !== 0) {
      e.preventDefault()
      history.snapshot()
      // multi-select nudge
      if (editor.selectedRegionIds.size > 0 || editor.selectedGridGroupIds.size > 0) {
        for (const id of editor.selectedRegionIds) {
          const r = editor.regions.find(r => r.id === id)
          if (r) {
            r.x += dx; r.y += dy
            if (r.points) {
              for (const p of r.points) { p.x += dx; p.y += dy }
            }
          }
        }
        for (const id of editor.selectedGridGroupIds) {
          const g = editor.gridGroups.find(g => g.id === id)
          if (g) { g.x += dx; g.y += dy }
        }
      } else {
        const g = editor.gridGroups.find(g => g.id === editor.selectedGridGroupId)
        const r = editor.regions.find(r => r.id === editor.selectedRegionId)
        if (g) {
          g.x += dx; g.y += dy
        } else if (r) {
          r.x += dx; r.y += dy
          if (r.points) {
            for (const p of r.points) { p.x += dx; p.y += dy }
          }
        }
      }
      canvasWorkspace.value?.scheduleRender()
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  removeOpenFilesListener = window.electronAPI?.onOpenFiles?.((files: ElectronImageFile[]) => {
    for (const file of files) addImageLayerFromDataUrl(file.dataUrl, file.name)
  })
  removeMenuCommandListener = window.electronAPI?.onMenuCommand?.(handleMenuCommand)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  removeOpenFilesListener?.()
  removeMenuCommandListener?.()
})
</script>

<template>
  <div class="app-shell">
    <TopBar />
    <div class="app-body">
      <LeftSidebar
        @upload-image="handleUploadImage"
        @open-compress="showImageCompressModal = true"
        @open-matting="mattingWorkspace?.open()"
        @create-grid-group="canvasWorkspace?.createDefaultNGrid()"
      />
      <CanvasWorkspace ref="canvasWorkspace" />
      <RightSidebar />
    </div>
    <DeliveryBar />
    <ImageCompressModal v-model:show="showImageCompressModal" />
    <MattingWorkspace ref="mattingWorkspace" />
  </div>
</template>

<style scoped>
.app-shell { height: 100%; display: flex; flex-direction: column; }
.app-body { flex: 1; display: flex; overflow: hidden; }
</style>
