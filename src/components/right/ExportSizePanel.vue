<script setup lang="ts">
import { ref, watch } from 'vue'
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

const fillColorPresets = ['#ffffff', '#f5f5f5', '#000000', '#f7f1e8', '#e8eef6', '#f3ead7']
const fillColorText = ref(exp.batchFillColor)

watch(() => exp.batchFillColor, (color) => {
  if (color !== fillColorText.value) fillColorText.value = color
})

function normalizeHexColor(value: string) {
  const raw = value.trim().replace(/^#/, '')
  if (/^[\da-f]{3}$/i.test(raw)) {
    return `#${raw.split('').map(ch => ch + ch).join('')}`.toLowerCase()
  }
  if (/^[\da-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase()
  return exp.batchFillColor
}

function commitFillColorText() {
  const normalized = normalizeHexColor(fillColorText.value)
  fillColorText.value = normalized
  exp.batchFillColor = normalized
}

function setFillColor(color: string) {
  exp.batchFillColor = color
  fillColorText.value = color
}

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

    <div class="field">
      <label>尺寸预设</label>
      <select class="select-input" v-model="exp.selectedPlatformPresetId">
        <option :value="null">- 自定义 -</option>
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
        <label>背景填充色</label>
        <div class="fill-color-row">
          <input type="color" v-model="exp.batchFillColor" class="color-input" title="选择背景填充色" />
          <input
            type="text"
            v-model="fillColorText"
            class="text-input fill-color-text"
            maxlength="7"
            placeholder="#ffffff"
            @blur="commitFillColorText"
            @keyup.enter="commitFillColorText"
          />
        </div>
        <div class="fill-color-swatches">
          <button
            v-for="color in fillColorPresets"
            :key="color"
            type="button"
            class="fill-swatch"
            :class="{ active: exp.batchFillColor.toLowerCase() === color }"
            :style="{ backgroundColor: color }"
            :title="color"
            @click="setFillColor(color)"
          />
        </div>
        <div class="field-hint">完整包含时用于补齐输出画布空白，会随模板的“背景”配置保存。</div>
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
.fill-color-row { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 7px; align-items: center; }
.color-input {
  width: 44px; height: 32px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; padding: 2px;
}
.fill-color-text { height: 32px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; text-transform: lowercase; }
.fill-color-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin-top: 7px; }
.fill-swatch {
  height: 22px; border: 1px solid var(--border); border-radius: 5px;
  cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}
.fill-swatch.active { border-color: var(--accent); outline: 1px solid rgba(40, 199, 111, 0.32); }
.field-hint { margin-top: 6px; color: var(--text-muted); font-size: 10px; line-height: 1.4; }
</style>
