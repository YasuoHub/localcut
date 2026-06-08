<script setup lang="ts">
import { useExportStore } from '../../stores/export'
import type { ExportInspectionResult } from '../../types'

defineProps<{
  result: ExportInspectionResult
  exportWarning: string
}>()

const emit = defineEmits<{ open: [] }>()
const exp = useExportStore()

const checkItems = [
  { key: 'regionCount', label: '区域数量', tip: '检查当前是否没有任何裁剪区域。没有区域时批量导出无目标，会阻止导出。' },
  { key: 'checkedCount', label: '勾选数量', tip: '检查是否没有勾选区域。未勾选时会导出全部区域，用于避免误以为不会导出。' },
  { key: 'outputSize', label: '输出尺寸', tip: '启用统一输出尺寸时，检查宽高是否为空、0 或负数。尺寸无效会阻止导出。' },
  { key: 'filenameDuplicate', label: '文件名重名', tip: '按当前命名规则预生成文件名，检查多个裁剪框是否会得到相同文件名。重名会让交付文件名不可预测。' },
  { key: 'unknownVariable', label: '未知变量', tip: '检查命名规则里是否使用了不支持的变量，例如 {sku}。未知变量不会被替换，会阻止导出。' },
  { key: 'activeLayerBounds', label: '超出活动图层', tip: '检查裁剪框是否完全落在当前活动图层范围内。常用于发现模板套用或拖拽后的偏移。' },
  { key: 'visibleLayerCoverage', label: '未覆盖可见图层', tip: '检查裁剪框是否覆盖至少一个可见图层。未覆盖时导出可能为空图、透明图或纯背景。' },
  { key: 'sourcePixels', label: '源像素清晰度', tip: '根据源像素、输出尺寸和 DPR 判断是否会限制 DPR，或是否建议启用超分提升清晰度。' },
] as const
</script>

<template>
  <section class="section">
    <div class="section-title">导出体检</div>

    <div class="check-grid">
      <label v-for="item in checkItems" :key="item.key" class="check-item">
        <input type="checkbox" v-model="exp.inspectionSettings[item.key]" />
        <span class="check-text" :title="item.label">{{ item.label }}</span>
        <span class="help-icon" :title="item.tip" aria-label="检查说明" @click.prevent.stop>?</span>
      </label>
    </div>

    <div v-if="exportWarning" class="export-warning">{{ exportWarning }}</div>

    <button
      class="result-btn"
      :class="{ danger: result.failedRegionCount > 0, success: result.failedRegionCount === 0 }"
      @click="emit('open')"
    >
      检测结果（{{ result.failedRegionCount }}项）
    </button>
  </section>
</template>

<style scoped>
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; }
.check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 10px; }
.check-item {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: var(--text-secondary); line-height: 1.3;
  cursor: pointer; min-width: 0;
}
.check-item input { accent-color: var(--accent); flex-shrink: 0; }
.check-text {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.help-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; border-radius: 50%;
  border: 1px solid var(--border); color: var(--text-muted);
  font-size: 10px; line-height: 1; flex-shrink: 0;
  opacity: 0; pointer-events: none; transition: opacity 0.12s, border-color 0.12s, color 0.12s;
}
.check-item:hover .help-icon { opacity: 1; pointer-events: auto; }
.help-icon:hover { border-color: var(--accent); color: var(--accent); }
.export-warning {
  font-size: 11px; color: #ffb4b4; background: rgba(229, 92, 92, 0.12);
  border: 1px solid rgba(229, 92, 92, 0.35); border-radius: var(--radius);
  padding: 7px 8px; margin-bottom: 8px; line-height: 1.4;
}
.result-btn {
  width: 100%; border: none; border-radius: var(--radius);
  padding: 8px 10px; color: #fff; font-size: 12px; cursor: pointer;
}
.result-btn.success { background: #2e9d5b; }
.result-btn.danger { background: var(--danger); }
.result-btn:hover { opacity: 0.9; }
</style>
