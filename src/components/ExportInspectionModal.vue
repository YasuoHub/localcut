<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import type { CropRegion, ExportInspectionResult } from '../types'
import { useEditorStore } from '../stores/editor'
import { useExport } from '../composables/useExport'
import ImageZoomModal from './ImageZoomModal.vue'

const props = defineProps<{
  show: boolean
  result: ExportInspectionResult
}>()

const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const editor = useEditorStore()
const { renderRegionToCanvas } = useExport()

const loading = ref(false)
const previews = ref<{ region: CropRegion; dataUrl: string; issueText: string }[]>([])
const zoomRegion = ref<CropRegion | null>(null)
const zoomRegions = ref<CropRegion[]>([])
const zoomIndex = ref(0)
const showZoom = ref(false)

async function generateThumb(region: CropRegion): Promise<string> {
  if (region.width <= 0 || region.height <= 0) return ''
  const maxDim = 200
  let tw = region.width
  let th = region.height
  if (region.width > region.height) {
    tw = maxDim
    th = Math.max(1, Math.round(region.height * maxDim / region.width))
  } else {
    th = maxDim
    tw = Math.max(1, Math.round(region.width * maxDim / region.height))
  }
  const canvas = await renderRegionToCanvas(
    editor.layers,
    region,
    tw,
    th,
    1,
    editor.showOriginal,
    editor.textAnnotations,
  )
  return canvas.toDataURL('image/png')
}

async function refreshPreviews() {
  loading.value = true
  previews.value = []
  await nextTick()
  await new Promise(resolve => requestAnimationFrame(resolve))
  try {
    previews.value = await Promise.all(props.result.regionSummaries.map(async item => ({
      region: item.region,
      dataUrl: await generateThumb(item.region),
      issueText: item.issues.map(issue => issue.title).join('、'),
    })))
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:show', false)
}

function openRegion(region: CropRegion) {
  editor.selectRegion(region.id)
  editor.activeTool = 'select'
  zoomRegions.value = props.result.regionSummaries.map(item => item.region)
  zoomIndex.value = zoomRegions.value.findIndex(item => item.id === region.id)
  if (zoomIndex.value < 0) zoomIndex.value = 0
  zoomRegion.value = region
  showZoom.value = true
}

function onNavigate(region: CropRegion) {
  editor.selectRegion(region.id)
  const idx = zoomRegions.value.findIndex(item => item.id === region.id)
  zoomIndex.value = idx >= 0 ? idx : 0
  zoomRegion.value = region
}

watch(() => [props.show, props.result], ([show]) => {
  if (show) refreshPreviews()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="inspection-overlay">
      <div class="inspection-panel" @click.stop>
        <div class="inspection-header">
          <span class="inspection-title">检测结果 ({{ result.failedRegionCount }} 项)</span>
          <button class="inspection-close" @click="close">&times;</button>
        </div>

        <div v-if="result.globalIssues.length" class="global-list">
          <div v-for="item in result.globalIssues" :key="item.id" class="global-issue" :class="item.severity">
            <strong>{{ item.title }}</strong>
            <span>{{ item.detail }}</span>
          </div>
        </div>

        <div v-if="loading" class="inspection-loading">生成预览中...</div>

        <div v-else-if="previews.length > 0" class="inspection-grid">
          <div
            v-for="p in previews"
            :key="p.region.id"
            class="inspection-card"
            @click="openRegion(p.region)"
          >
            <div class="card-thumb-wrap">
              <img v-if="p.dataUrl" :src="p.dataUrl" class="card-thumb" />
              <div v-else class="empty-thumb">无法预览</div>
            </div>
            <span class="card-name">{{ p.region.name }}</span>
            <span class="card-issues">{{ p.issueText }}</span>
          </div>
        </div>

        <div v-else class="inspection-empty">没有发现未通过的裁剪框。</div>

        <div class="inspection-footer">
          <button class="btn-secondary" @click="close">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>

  <ImageZoomModal
    :region="zoomRegion"
    v-model:show="showZoom"
    :regions="zoomRegions"
    :current-index="zoomIndex"
    @navigate="onNavigate"
  />
</template>

<style scoped>
.inspection-overlay {
  position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.inspection-panel {
  width: 90vw; max-width: 960px; max-height: 85vh;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; overflow: hidden;
}
.inspection-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.inspection-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.inspection-close {
  background: none; border: none; color: var(--text-muted); font-size: 22px;
  cursor: pointer; line-height: 1;
}
.inspection-close:hover { color: var(--text-primary); }
.global-list { padding: 12px 16px 0; display: flex; flex-direction: column; gap: 6px; }
.global-issue {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border-radius: var(--radius); font-size: 12px;
  border: 1px solid var(--border); background: var(--bg-primary);
}
.global-issue.error { border-color: rgba(229, 92, 92, 0.55); color: #ffb4b4; }
.global-issue.warning { border-color: rgba(229, 164, 0, 0.55); color: #ffd078; }
.global-issue span { color: var(--text-secondary); line-height: 1.4; }
.inspection-loading,
.inspection-empty {
  padding: 40px; text-align: center; color: var(--text-muted); font-size: 14px;
}
.inspection-grid {
  flex: 1; overflow-y: auto; padding: 20px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
  align-content: start;
}
.inspection-card {
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer; border-radius: 6px; padding: 8px;
  transition: background 0.15s;
}
.inspection-card:hover { background: rgba(79,195,247,0.08); }
.card-thumb-wrap {
  width: 100%; aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  background: repeating-conic-gradient(#2a2a3a 0% 25%, #353545 0% 50%) 50% / 16px 16px;
  border-radius: 4px; overflow: hidden; margin-bottom: 6px;
}
.card-thumb { max-width: 100%; max-height: 100%; object-fit: contain; }
.empty-thumb { font-size: 11px; color: var(--text-muted); }
.card-name,
.card-issues {
  max-width: 100%; text-align: center; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; line-height: 1.4;
}
.card-name { font-size: 11px; color: var(--text-secondary); }
.card-issues { font-size: 10px; color: #ffb4b4; }
.inspection-footer {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--border); flex-shrink: 0; justify-content: flex-end;
}
.btn-secondary {
  padding: 8px 20px; background: var(--bg-primary); color: var(--text-secondary);
  border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; cursor: pointer;
}
.btn-secondary:hover { border-color: var(--text-muted); }
</style>
