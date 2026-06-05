<script setup lang="ts">
import { useExportStore } from '../../stores/export'
import { PLATFORM_PRESETS } from '../../constants/platformPresets'
import type { BatchOutputFitMode } from '../../types'

const exp = useExportStore()

const fitOptions: { value: BatchOutputFitMode; label: string }[] = [
  { value: 'cover', label: '裁切填满' },
  { value: 'contain', label: '完整包含' },
  { value: 'stretch', label: '拉伸' },
  { value: 'original', label: '原始' },
]

const groupedPresets = (() => {
  const map = new Map<string, typeof PLATFORM_PRESETS>()
  for (const p of PLATFORM_PRESETS) {
    const list = map.get(p.group) ?? []
    list.push(p)
    if (!map.has(p.group)) map.set(p.group, list)
  }
  return [...map.entries()]
})()
</script>

<template>
  <section class="section">
    <div class="section-title">批量输出尺寸</div>

    <!-- platform presets -->
    <div class="field">
      <label>尺寸预设</label>
      <select class="select-input" v-model="exp.selectedPlatformPresetId">
        <option :value="null">— 自定义 —</option>
        <optgroup v-for="[group, items] in groupedPresets" :key="group" :label="group">
          <option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }}</option>
        </optgroup>
      </select>
    </div>

    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" v-model="exp.batchUseCustomSize" />批量导出使用统一尺寸
      </label>
    </div>

    <template v-if="exp.batchUseCustomSize">
      <div class="field-row">
        <div class="field">
          <label>宽度</label>
          <input type="number" v-model.number="exp.batchOutputWidth" min="1" class="text-input" />
        </div>
        <div class="field">
          <label>高度</label>
          <input type="number" v-model.number="exp.batchOutputHeight" min="1" class="text-input" />
        </div>
      </div>
      <div class="field">
        <label>适配</label>
        <select class="select-input" v-model="exp.batchFitMode">
          <option v-for="o in fitOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="field" v-if="exp.batchFitMode === 'contain'">
        <label>背景色</label>
        <input type="color" v-model="exp.batchFillColor" class="color-input" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.field-row { display: flex; gap: 8px; }
.field-row .field { flex: 1; }
.checkbox-label { display: flex !important; align-items: center; gap: 6px; cursor: pointer; font-size: 12px !important; }
.checkbox-label input { accent-color: var(--accent); }
.text-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary);
  font-size: 12px; outline: none; box-sizing: border-box;
}
.text-input:focus { border-color: var(--accent); }
.select-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary);
  font-size: 12px; outline: none;
}
.select-input:focus { border-color: var(--accent); }
.color-input { width: 100%; height: 32px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; padding: 2px; }
</style>
