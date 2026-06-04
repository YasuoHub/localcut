<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import TopBar from './components/TopBar.vue'
import LeftSidebar from './components/LeftSidebar.vue'
import CanvasWorkspace from './components/CanvasWorkspace.vue'
import RightSidebar from './components/RightSidebar.vue'
import { useEditorStore } from './stores/editor'
import { useHistoryStore } from './stores/history'

const editor = useEditorStore()
const history = useHistoryStore()
const canvasWorkspace = ref<InstanceType<typeof CanvasWorkspace> | null>(null)

function handleUploadImage(file: File) {
  const reader = new FileReader()
  reader.onload = (ev) => {
    const img = new Image()
    img.onload = () => editor.addLayer(img)
    img.src = ev.target?.result as string
  }
  reader.readAsDataURL(file)
}

function handleKeyDown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

  if (e.ctrlKey && e.key === 'z' && !isInput) { e.preventDefault(); history.undo(); canvasWorkspace.value?.scheduleRender() }
  if (e.ctrlKey && e.key === 'y' && !isInput) { e.preventDefault(); history.redo(); canvasWorkspace.value?.scheduleRender() }
  if (e.ctrlKey && e.key === 'c' && !isInput) { e.preventDefault(); canvasWorkspace.value?.copySelectedRegion() }
  if (e.ctrlKey && e.key === 'v' && !isInput) { e.preventDefault(); canvasWorkspace.value?.pasteRegion() }
  if (e.key === 'Escape') { canvasWorkspace.value?.cancelCustomPolygon() }
  if (e.key === 'Enter' && !isInput) { canvasWorkspace.value?.finalizeCustomPolygon?.() }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
    const sel = editor.selectedRegionId
    if (sel) canvasWorkspace.value?.deleteRegion(sel)
  }
  // arrow key nudge
  if (!isInput && editor.selectedRegionId) {
    const step = e.shiftKey ? 10 : 1
    let dx = 0, dy = 0
    if (e.key === 'ArrowLeft') dx = -step
    else if (e.key === 'ArrowRight') dx = step
    else if (e.key === 'ArrowUp') dy = -step
    else if (e.key === 'ArrowDown') dy = step
    if (dx !== 0 || dy !== 0) {
      e.preventDefault()
      const r = editor.regions.find(r => r.id === editor.selectedRegionId)
      if (r) {
        history.snapshot()
        r.x += dx; r.y += dy
        if (r.points) {
          for (const p of r.points) { p.x += dx; p.y += dy }
        }
        canvasWorkspace.value?.scheduleRender()
      }
    }
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyDown))
</script>

<template>
  <div class="app-shell">
    <TopBar />
    <div class="app-body">
      <LeftSidebar @upload-image="handleUploadImage" />
      <CanvasWorkspace ref="canvasWorkspace" />
      <RightSidebar />
    </div>
  </div>
</template>

<style scoped>
.app-shell { height: 100%; display: flex; flex-direction: column; }
.app-body { flex: 1; display: flex; overflow: hidden; }
</style>
