<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useBatchExportWorkflow } from '../composables/useBatchExportWorkflow'
import PreviewModal from './PreviewModal.vue'
import ExportInspectionModal from './ExportInspectionModal.vue'

const editor = useEditorStore()
const exp = useExportStore()
const previewModalRef = ref<InstanceType<typeof PreviewModal> | null>(null)

const {
  checkedCount,
  targetCount,
  canPreview,
  canExport,
  isExporting,
  exportStatusText,
  inspectionResult,
  modalInspectionResult,
  showInspectionModal,
  openInspectionResult,
  handleBatchExport,
} = useBatchExportWorkflow()

const targetLabel = computed(() => {
  if (!editor.imageLoaded) return '导入图片后可生成区域并导出'
  if (editor.regions.length === 0) return '暂无裁剪区域'
  if (checkedCount.value > 0) return `将导出已勾选 ${checkedCount.value} / 共 ${editor.regions.length} 项`
  return `将导出全部 ${editor.regions.length} 项`
})

const checkLabel = computed(() => {
  if (!editor.imageLoaded || editor.regions.length === 0) return '无可导出内容'
  const errors = inspectionResult.value.issues.filter(item => item.severity === 'error').length
  const warnings = inspectionResult.value.issues.filter(item => item.severity === 'warning').length
  if (errors > 0) return `无法导出：${errors} 个错误`
  if (warnings > 0) return `${warnings} 个警告`
  return '可导出'
})

const checkTone = computed(() => {
  if (!editor.imageLoaded || editor.regions.length === 0) return 'muted'
  if (inspectionResult.value.hasBlockingIssues) return 'danger'
  if (inspectionResult.value.issues.some(item => item.severity === 'warning')) return 'warning'
  return 'success'
})

const exportSummary = computed(() => {
  const format = exp.exportFormat.toUpperCase()
  const size = exp.batchUseCustomSize && exp.batchOutputWidth && exp.batchOutputHeight
    ? `${exp.batchOutputWidth}x${exp.batchOutputHeight} ${exp.batchFitMode}`
    : '原始尺寸'
  const enhance = [exp.upscaleEnabled ? `超分${exp.upscaleScale}x` : '', exp.sharpenAmount > 0 ? `锐化${exp.sharpenAmount}%` : '']
    .filter(Boolean)
    .join(' / ')
  return enhance ? `${format} / ${size} / ${enhance}` : `${format} / ${size}`
})

function openPreview() {
  if (!canPreview.value) return
  previewModalRef.value?.open()
}
</script>

<template>
  <footer class="delivery-bar">
    <div class="delivery-main">
      <div class="target-line">{{ targetLabel }}</div>
      <div class="summary-line">{{ exportSummary }}</div>
    </div>

    <button class="inspection-pill" :class="checkTone" @click="openInspectionResult">
      <span class="status-dot"></span>
      {{ checkLabel }}
    </button>

    <div class="delivery-actions">
      <button class="btn-ghost preview-btn" :disabled="!canPreview || isExporting" @click="openPreview">
        批量预览
      </button>
      <button class="btn-primary export-btn" :disabled="!canExport" @click="handleBatchExport">
        {{ isExporting ? (exportStatusText || `导出 ${targetCount} 项...`) : `导出 ZIP` }}
      </button>
    </div>
  </footer>

  <PreviewModal ref="previewModalRef" @export="handleBatchExport" />
  <ExportInspectionModal v-model:show="showInspectionModal" :result="modalInspectionResult" />

  <Teleport to="body">
    <div v-if="isExporting" class="export-overlay">
      <div class="export-overlay-card">
        <div class="export-spinner"></div>
        <div class="export-overlay-text">{{ exportStatusText || '正在导出...' }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.delivery-bar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 14px 0 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}

.delivery-main {
  min-width: 0;
  flex: 1;
}

.target-line {
  font-size: 13px;
  font-weight: 650;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.summary-line {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inspection-pill {
  height: 30px;
  min-width: 116px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-muted);
}

.inspection-pill.success { color: var(--accent); border-color: rgba(40, 199, 111, 0.35); }
.inspection-pill.success .status-dot { background: var(--accent); }
.inspection-pill.warning { color: var(--warning); border-color: rgba(230, 162, 60, 0.45); }
.inspection-pill.warning .status-dot { background: var(--warning); }
.inspection-pill.danger { color: var(--danger); border-color: rgba(230, 92, 92, 0.45); }
.inspection-pill.danger .status-dot { background: var(--danger); }

.delivery-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-btn,
.export-btn {
  height: 34px;
  padding: 0 14px;
  white-space: nowrap;
}

.export-btn {
  min-width: 104px;
}

.export-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: all;
  user-select: none;
}

.export-overlay-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 28px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 240px;
}

.export-overlay-text {
  font-size: 14px;
  color: var(--text-primary);
  text-align: center;
}

.export-spinner {
  width: 34px;
  height: 34px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: export-spin 0.8s linear infinite;
}

@keyframes export-spin {
  to { transform: rotate(360deg); }
}
</style>
