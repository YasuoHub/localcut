<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { CropRegion } from '../types'
import { useExport } from '../composables/useExport'
import { useEditorStore } from '../stores/editor'

const props = defineProps<{
  region: CropRegion | null
  show: boolean
  /** Optional: list of regions for prev/next navigation */
  regions?: CropRegion[]
  currentIndex?: number
}>()
const emit = defineEmits<{ 'update:show': [v: boolean]; 'navigate': [region: CropRegion] }>()

const editor = useEditorStore()
const { renderRegionToCanvas } = useExport()

const MAX_PREVIEW_PX = 2400 // cap longest edge to avoid huge canvases

const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const spaceHeld = ref(false)
const panStart = ref({ x: 0, y: 0, px: 0, py: 0 })
const imgUrl = ref('')
const containerRef = ref<HTMLElement | null>(null)
const loading = ref(false)
const isZooming = ref(false)
let zoomDebounceTimer = 0

async function generatePreview() {
  if (!props.region) return
  // 释放旧 URL 避免内存泄漏
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value)
  loading.value = true
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  try {
    // 计算预览尺寸：最长边不超过 MAX_PREVIEW_PX
    const rw = props.region.width
    const rh = props.region.height
    const maxDim = Math.max(rw, rh)
    const dpr = maxDim > MAX_PREVIEW_PX ? 1 : 1 // 预览不需要 retina，统一用 1
    let tw = rw, th = rh
    if (maxDim > MAX_PREVIEW_PX) {
      const scale = MAX_PREVIEW_PX / maxDim
      tw = Math.round(rw * scale)
      th = Math.round(rh * scale)
    }

    const canvas = await renderRegionToCanvas(
      editor.layers, props.region!,
      tw, th, dpr, editor.showOriginal,
      editor.textAnnotations,
    )
    // 用 toBlob + ObjectURL 替代 toDataURL，异步编码不阻塞主线程
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (blob) imgUrl.value = URL.createObjectURL(blob)
  } finally {
    loading.value = false
  }
}

function fitAndCenter() {
  if (!containerRef.value || !props.region) return
  const cw = containerRef.value.clientWidth
  const ch = containerRef.value.clientHeight
  const maxDim = Math.max(props.region.width, props.region.height)
  const scale = maxDim > MAX_PREVIEW_PX ? MAX_PREVIEW_PX / maxDim : 1
  const iw = props.region.width * scale
  const ih = props.region.height * scale
  const margin = 0.8
  const fitZoom = Math.min(cw * margin / iw, ch * margin / ih, 1)
  zoom.value = Math.round(fitZoom * 100) / 100
  panX.value = Math.round((cw - iw * zoom.value) / 2)
  panY.value = Math.round((ch - ih * zoom.value) / 2)
}

function onImgLoad() { fitAndCenter() }

// 释放旧 URL
watch(() => props.region, () => {
  if (imgUrl.value) { URL.revokeObjectURL(imgUrl.value); imgUrl.value = '' }
})

watch(() => [props.region, props.show], ([r, s]) => {
  if (r && s) {
    zoom.value = 0.5
    panX.value = 0
    panY.value = 0
    generatePreview()
    requestAnimationFrame(() => fitAndCenter())
  }
})

function close() { emit('update:show', false) }

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect) return
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const oldZoom = zoom.value
  const factor = e.deltaY > 0 ? 0.9 : 1.1
  zoom.value = Math.max(0.1, Math.min(10, zoom.value * factor))
  panX.value = mx - (zoom.value / oldZoom) * (mx - panX.value)
  panY.value = my - (zoom.value / oldZoom) * (my - panY.value)
  // 缩放时用快速渲染模式
  isZooming.value = true
  clearTimeout(zoomDebounceTimer)
  zoomDebounceTimer = window.setTimeout(() => { isZooming.value = false }, 200)
}

function onMouseDown(e: MouseEvent) {
  if (!spaceHeld.value) return
  e.preventDefault()
  isPanning.value = true
  panStart.value = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value }
}

function onMouseMove(e: MouseEvent) {
  if (!isPanning.value) return
  panX.value = panStart.value.px + (e.clientX - panStart.value.x)
  panY.value = panStart.value.py + (e.clientY - panStart.value.y)
}

function onMouseUp() { isPanning.value = false }

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'Space' && !e.repeat && props.show) {
    e.preventDefault()
    spaceHeld.value = true
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') spaceHeld.value = false
}

onMounted(() => { window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp) })
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (imgUrl.value) URL.revokeObjectURL(imgUrl.value)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show && region" class="zoom-overlay" @click="close">
      <div class="zoom-panel" @click.stop @wheel="onWheel" ref="containerRef"
        @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @mouseleave="onMouseUp"
        :style="{ cursor: spaceHeld ? (isPanning ? 'grabbing' : 'grab') : 'default' }">
        <div v-if="loading" class="zoom-loading">加载中...</div>
        <img v-else :src="imgUrl"
          @load="onImgLoad"
          :style="{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom}) translateZ(0)`,
            transformOrigin: '0 0',
          }"
          class="zoom-img"
          :class="{ 'zooming-fast': isZooming }"
          draggable="false"
        />
        <div v-if="regions && regions.length > 1" class="zoom-nav">
          <button class="zoom-nav-btn"
            :disabled="(currentIndex ?? 0) <= 0"
            @click.stop="emit('navigate', regions[(currentIndex ?? 0) - 1])">◀ 上一张</button>
          <span class="zoom-nav-info">{{ (currentIndex ?? 0) + 1 }} / {{ regions.length }}</span>
          <button class="zoom-nav-btn"
            :disabled="(currentIndex ?? 0) >= regions.length - 1"
            @click.stop="emit('navigate', regions[(currentIndex ?? 0) + 1])">下一张 ▶</button>
        </div>
        <div class="zoom-info">
          {{ Math.round(zoom * 100) }}% | 滚轮缩放 | 空格+拖拽平移
        </div>
        <button class="zoom-close-btn" @click="close">&times;</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.zoom-overlay {
  position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
}
.zoom-panel {
  position: relative; width: 90vw; height: 85vh; overflow: hidden;
  background: var(--bg-primary); border-radius: var(--radius-lg);
  border: 1px solid var(--border);
}
.zoom-loading {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: var(--text-muted); font-size: 14px;
}
.zoom-img {
  position: absolute; top: 0; left: 0;
  image-rendering: auto;
  will-change: transform;
}
/* 缩放中降低渲染质量换性能，200ms 后恢复 */
.zoom-img.zooming-fast {
  image-rendering: pixelated;
}
.zoom-info {
  position: absolute; bottom: 8px; right: 12px;
  font-size: 11px; color: var(--text-muted);
  background: rgba(0,0,0,0.5); padding: 2px 8px; border-radius: 3px;
}
.zoom-close-btn {
  position: absolute; top: 8px; right: 12px;
  background: none; border: none; color: var(--text-muted); font-size: 24px;
  cursor: pointer; line-height: 1;
}
.zoom-close-btn:hover { color: var(--text-primary); }
.zoom-nav {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 12px;
}
.zoom-nav-btn {
  padding: 4px 12px; background: rgba(0,0,0,0.5); color: var(--text-secondary);
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 12px; cursor: pointer;
}
.zoom-nav-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
.zoom-nav-btn:disabled { opacity: 0.3; cursor: default; }
.zoom-nav-info { font-size: 11px; color: var(--text-muted); }
</style>
