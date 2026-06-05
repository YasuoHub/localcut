<script setup lang="ts">
import { ref } from 'vue'
import type { CropRegion } from '../types'
import { useExport } from '../composables/useExport'
import { useEditorStore } from '../stores/editor'
import ImageZoomModal from './ImageZoomModal.vue'

const editor = useEditorStore()
const { renderRegionToCanvas } = useExport()

const show = ref(false)
const previews = ref<{ regionId: string; name: string; dataUrl: string }[]>([])
const zoomRegion = ref<CropRegion | null>(null)
const zoomIndex = ref(0)
const zoomRegions = ref<CropRegion[]>([])
const showZoom = ref(false)
const loading = ref(false)

function previewRegions(): CropRegion[] {
  if (editor.selectedRegionIds.size > 0) {
    return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
  }
  return editor.regions
}

function generateThumb(region: CropRegion): string {
  const w = region.width
  const h = region.height
  const maxDim = 200
  let tw = w, th = h
  if (w > h) { tw = maxDim; th = Math.round(h * maxDim / w) } else { th = maxDim; tw = Math.round(w * maxDim / h) }
  const canvas = renderRegionToCanvas(
    editor.layers, region,
    tw, th, 1, editor.showOriginal,
    editor.textAnnotations,
  )
  return canvas.toDataURL('image/png')
}

function open() {
  const regions = previewRegions()
  loading.value = true
  previews.value = []
  show.value = true
  requestAnimationFrame(() => {
    try {
      previews.value = regions.map(r => ({
        regionId: r.id,
        name: r.name,
        dataUrl: generateThumb(r),
      }))
    } finally { loading.value = false }
  })
}

function close() { show.value = false }

function openZoom(regionId: string) {
  const region = editor.regions.find(r => r.id === regionId)
  if (region) {
    const allRegions = previewRegions()
    const idx = allRegions.findIndex(r => r.id === regionId)
    zoomRegions.value = allRegions
    zoomIndex.value = idx >= 0 ? idx : 0
    zoomRegion.value = region
    showZoom.value = true
  }
}

function onNavigate(region: CropRegion) {
  const allRegions = zoomRegions.value
  const idx = allRegions.findIndex(r => r.id === region.id)
  zoomIndex.value = idx >= 0 ? idx : 0
  zoomRegion.value = region
}

function handleBatchExport() {
  // trigger the same batch export flow as the sidebar button
  const btn = document.querySelector('.export-btn') as HTMLButtonElement | null
  btn?.click()
}

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="preview-overlay">
      <div class="preview-panel" @click.stop>
        <div class="preview-header">
          <span class="preview-title">批量预览 ({{ previews.length }} 项)</span>
          <button class="preview-close" @click="close">&times;</button>
        </div>

        <div v-if="loading" class="preview-loading">生成预览中...</div>

        <div v-else class="preview-grid">
          <div
            v-for="p in previews" :key="p.regionId"
            class="preview-card"
            @click="openZoom(p.regionId)"
          >
            <div class="card-thumb-wrap">
              <img :src="p.dataUrl" class="card-thumb" />
            </div>
            <span class="card-name">{{ p.name }}</span>
          </div>
        </div>

        <div class="preview-footer">
          <button class="btn-secondary" @click="close">关闭</button>
          <button class="btn-primary" @click="handleBatchExport">批量导出</button>
        </div>
      </div>
    </div>
  </Teleport>

  <ImageZoomModal :region="zoomRegion" v-model:show="showZoom" :regions="zoomRegions" :current-index="zoomIndex" @navigate="onNavigate" />
</template>

<style scoped>
.preview-overlay {
  position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.preview-panel {
  width: 90vw; max-width: 960px; max-height: 85vh;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; overflow: hidden;
}
.preview-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.preview-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.preview-close {
  background: none; border: none; color: var(--text-muted); font-size: 22px;
  cursor: pointer; line-height: 1;
}
.preview-close:hover { color: var(--text-primary); }
.preview-loading {
  padding: 40px; text-align: center; color: var(--text-muted); font-size: 14px;
}
.preview-grid {
  flex: 1; overflow-y: auto; padding: 20px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
  align-content: start;
}
.preview-card {
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer; border-radius: 6px; padding: 8px;
  transition: background 0.15s;
}
.preview-card:hover { background: rgba(79,195,247,0.08); }
.card-thumb-wrap {
  width: 100%; aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  background: repeating-conic-gradient(#2a2a3a 0% 25%, #353545 0% 50%) 50% / 16px 16px;
  border-radius: 4px; overflow: hidden; margin-bottom: 6px;
}
.card-thumb {
  max-width: 100%; max-height: 100%; object-fit: contain;
}
.card-name {
  font-size: 11px; color: var(--text-secondary);
  text-align: center; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 100%; line-height: 1.4;
}
.preview-footer {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--border); flex-shrink: 0;justify-content: flex-end;
}
.btn-primary {
  padding: 8px 20px; background: var(--accent); color: #fff;
  border: none; border-radius: var(--radius); font-size: 13px; cursor: pointer;
}
.btn-primary:hover { opacity: 0.9; }
.btn-secondary {
  padding: 8px 20px; background: var(--bg-primary); color: var(--text-secondary);
  border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; cursor: pointer;
}
.btn-secondary:hover { border-color: var(--text-muted); }
</style>
