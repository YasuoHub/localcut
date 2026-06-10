<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useHistoryStore } from '../../stores/history'
import { generateGridRegions, duplicateRegionBySpacing, generateSliceRegions, validateSliceOptions, generateGuideRegions } from '../../composables/useBatchRegions'
import { nextRegionName } from '../../composables/shapeUtils'
import { builtinQuickSizePresets, useQuickSizePresets, type QuickSizePreset } from '../../composables/useQuickSizePresets'
import type { CropRegion, DuplicateOptions } from '../../types'

const editor = useEditorStore()
const history = useHistoryStore()

const {
  presets: presetCropSizes,
  customPresets,
  addCustomPreset,
  deleteCustomPreset,
  exportConfig,
  importConfig,
} = useQuickSizePresets()

const selectedPresetId = ref(builtinQuickSizePresets[0]?.id ?? 'free')
const customSizeName = ref('')
const customSizeWidth = ref<number | null>(null)
const customSizeHeight = ref<number | null>(null)
const customSizeNameInput = ref<HTMLInputElement | null>(null)
const quickSizePopoverOpen = ref(false)
const quickSizeMenuOpen = ref(false)
const quickSizeFileInput = ref<HTMLInputElement | null>(null)
const quickSizeMessage = ref('')

function createPresetRegion(preset: QuickSizePreset) {
  selectedPresetId.value = preset.id
  if (preset.width === 0 || preset.height === 0) {
    editor.setTool('rect')
    return
  }

  const layer = editor.activeLayer
  if (!layer) return
  const layerW = layer.image.naturalWidth * layer.scaleX
  const layerH = layer.image.naturalHeight * layer.scaleY
  const rectW = preset.width
  const rectH = preset.height
  const shouldConstrain = editor.isSingleLayerMode && editor.constrainToImage
  let rectX = Math.round(layer.x + (layerW - rectW) / 2)
  let rectY = Math.round(layer.y + (layerH - rectH) / 2)
  if (shouldConstrain && rectW <= layerW) {
    rectX = Math.max(layer.x, Math.min(rectX, layer.x + layerW - rectW))
  }
  if (shouldConstrain && rectH <= layerH) {
    rectY = Math.max(layer.y, Math.min(rectY, layer.y + layerH - rectH))
  }

  history.snapshot()
  const region: CropRegion = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: nextRegionName(),
    x: rectX,
    y: rectY,
    width: rectW,
    height: rectH,
    shape: 'rect',
  }
  editor.regions.push(region)
  editor.selectRegion(region.id)
  editor.invalidateCanvas()
}

function handleAddCustomPreset() {
  const preset = addCustomPreset({
    name: customSizeName.value,
    width: Number(customSizeWidth.value),
    height: Number(customSizeHeight.value),
  })
  if (!preset) {
    quickSizeMessage.value = '请输入名称和有效宽高。'
    quickSizePopoverOpen.value = true
    return
  }
  selectedPresetId.value = preset.id
  customSizeName.value = ''
  customSizeWidth.value = null
  customSizeHeight.value = null
  quickSizePopoverOpen.value = false
  quickSizeMessage.value = '已添加自定义尺寸。'
}

function openQuickSizePopover() {
  quickSizePopoverOpen.value = true
  quickSizeMenuOpen.value = false
  quickSizeMessage.value = ''
  nextTick(() => customSizeNameInput.value?.focus())
}

function cancelAddCustomPreset() {
  quickSizePopoverOpen.value = false
  customSizeName.value = ''
  customSizeWidth.value = null
  customSizeHeight.value = null
  quickSizeMessage.value = ''
}

function handleDeleteCustomPreset(id: string) {
  if (!window.confirm('确认删除这个自定义快捷尺寸？')) return
  if (deleteCustomPreset(id)) {
    if (selectedPresetId.value === id) selectedPresetId.value = builtinQuickSizePresets[0]?.id ?? 'free'
    quickSizeMessage.value = '已删除自定义尺寸。'
  }
}

function exportQuickSizeConfig() {
  const bundle = exportConfig()
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'quick-size-presets.localcut-config.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  quickSizeMenuOpen.value = false
}

function triggerQuickSizeImport() {
  quickSizeMenuOpen.value = false
  quickSizeFileInput.value?.click()
}

function handleQuickSizeImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const imported = importConfig(String(reader.result ?? ''))
      quickSizeMessage.value = imported > 0 ? `已导入 ${imported} 个自定义尺寸。` : '没有可导入的新尺寸。'
    } catch (err) {
      quickSizeMessage.value = '配置文件解析失败。'
    } finally {
      input.value = ''
    }
  }
  reader.readAsText(file)
}

// ---- grid ----
const grid = ref({
  rows: 3, cols: 4,
  startX: 0, startY: 0,
  cellWidth: 800, cellHeight: 800,
  gapX: 0, gapY: 0,
  namePrefix: 'grid',
  borderRadius: 0,
})
const gridReplace = ref(false)

function handleGenerateGrid() {
  history.snapshot()
  const regions = generateGridRegions({ ...grid.value })
  if (gridReplace.value) editor.clearRegions()
  editor.regions.push(...regions)
}

// ---- duplicate ----
const dup = ref<DuplicateOptions>({
  count: 5, mode: 'horizontal',
  gapX: 20, gapY: 20,
  deltaX: 100, deltaY: 0,
})

function handleDuplicate() {
  const region = editor.selectedRegion
  if (!region) return
  history.snapshot()
  const regions = duplicateRegionBySpacing(region, dup.value)
  editor.regions.push(...regions)
}

// ---- slice ----
const slice = ref({
  startY: 0,
  endY: null as number | null,
  sliceHeight: 1000,
  overlap: 0,
  namePrefix: 'slice',
})

const sliceError = ref<string | null>(null)

function handleGenerateSlice() {
  const layer = editor.activeLayer
  const err = validateSliceOptions(slice.value, layer)
  if (err) { sliceError.value = err; return }
  sliceError.value = null
  history.snapshot()
  const regions = generateSliceRegions(layer!, slice.value)
  editor.regions.push(...regions)
}

function handleGuidSlice() {
  const layer = editor.activeLayer
  if (!layer) return
  if (editor.hGuides.length === 0 && editor.vGuides.length === 0) return
  history.snapshot()
  const regions = generateGuideRegions(editor.hGuides, editor.vGuides, layer)
  editor.regions.push(...regions)
}
</script>

<template>
  <section class="section">
    <div class="section-title">批量切图</div>

    <details class="batch-detail" open>
      <summary class="batch-summary quick-size-summary">
        <span class="summary-main">
          快捷尺寸
          <span v-if="!editor.activeLayer" class="summary-hint">（需活动图层）</span>
        </span>
        <span class="quick-size-title-actions" @click.stop>
          <button
            class="quick-size-menu-btn"
            type="button"
            title="快捷尺寸配置"
            aria-label="快捷尺寸配置"
            :aria-expanded="quickSizeMenuOpen"
            @click.prevent.stop="quickSizeMenuOpen = !quickSizeMenuOpen"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          <div v-if="quickSizeMenuOpen" class="quick-size-menu" @click.stop>
            <button type="button" class="quick-size-menu-item" @click="triggerQuickSizeImport">导入配置</button>
            <button
              type="button"
              class="quick-size-menu-item"
              :disabled="customPresets.length === 0"
              @click="exportQuickSizeConfig"
            >
              导出配置
            </button>
          </div>
        </span>
      </summary>
      <div class="preset-grid">
        <div
          v-for="preset in presetCropSizes"
          :key="preset.id"
          class="preset-item"
          :class="{ selected: selectedPresetId === preset.id, custom: preset.custom }"
        >
          <button
            class="preset-chip"
            :disabled="!editor.activeLayer && preset.width > 0"
            :title="preset.width > 0 ? `${preset.name} ${preset.width}x${preset.height}` : preset.name"
            @click="createPresetRegion(preset)"
          >
            <span>{{ preset.name }}</span>
            <small v-if="preset.width > 0">{{ preset.width }}x{{ preset.height }}</small>
          </button>
          <button
            v-if="preset.custom"
            class="preset-delete"
            title="删除自定义尺寸"
            @click.stop="handleDeleteCustomPreset(preset.id)"
          >
            ×
          </button>
        </div>
        <div class="preset-item quick-size-add-item">
          <button
            class="preset-chip add-preset-card"
            type="button"
            :class="{ active: quickSizePopoverOpen }"
            title="添加快捷尺寸"
            aria-label="添加快捷尺寸"
            :aria-expanded="quickSizePopoverOpen"
            @click="openQuickSizePopover"
          >
            <svg class="add-preset-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <form
            v-if="quickSizePopoverOpen"
            class="quick-size-popover"
            @submit.prevent="handleAddCustomPreset"
            @keydown.esc.stop.prevent="cancelAddCustomPreset"
          >
            <label class="popover-field">
              <span>名称</span>
              <input ref="customSizeNameInput" type="text" v-model="customSizeName" class="text-input" placeholder="例：详情页横图" />
            </label>
            <div class="popover-size-row">
              <label class="popover-field">
                <span>宽</span>
                <input type="number" v-model.number="customSizeWidth" class="text-input" min="1" placeholder="800" />
              </label>
              <label class="popover-field">
                <span>高</span>
                <input type="number" v-model.number="customSizeHeight" class="text-input" min="1" placeholder="800" />
              </label>
            </div>
            <div v-if="quickSizeMessage" class="quick-size-message popover-message">{{ quickSizeMessage }}</div>
            <div class="popover-actions">
              <button class="btn-ghost" type="button" @click="cancelAddCustomPreset">取消</button>
              <button class="btn-primary" type="submit">添加</button>
            </div>
          </form>
        </div>
      </div>
      <input ref="quickSizeFileInput" type="file" accept=".json,.localcut-config.json,application/json" hidden @change="handleQuickSizeImport" />
      <div v-if="quickSizeMessage && !quickSizePopoverOpen" class="quick-size-message">{{ quickSizeMessage }}</div>
    </details>

    <!-- Grid generation -->
    <details class="batch-detail">
      <summary class="batch-summary">网格生成</summary>
      <div class="batch-body">
        <div class="field-row">
          <div class="field"><label>行数</label><input type="number" v-model.number="grid.rows" min="1" class="text-input" /></div>
          <div class="field"><label>列数</label><input type="number" v-model.number="grid.cols" min="1" class="text-input" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>开始 X</label><input type="number" v-model.number="grid.startX" class="text-input" /></div>
          <div class="field"><label>开始 Y</label><input type="number" v-model.number="grid.startY" class="text-input" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>单元宽</label><input type="number" v-model.number="grid.cellWidth" min="1" class="text-input" /></div>
          <div class="field"><label>单元高</label><input type="number" v-model.number="grid.cellHeight" min="1" class="text-input" /></div>
        </div>
        <div class="field-row">
          <div class="field"><label>横间距</label><input type="number" v-model.number="grid.gapX" min="0" class="text-input" /></div>
          <div class="field"><label>纵间距</label><input type="number" v-model.number="grid.gapY" min="0" class="text-input" /></div>
        </div>
        <div class="field">
          <label>命名前缀</label>
          <input type="text" v-model="grid.namePrefix" class="text-input" />
        </div>
        <div class="field">
          <label>圆角</label>
          <input type="number" v-model.number="grid.borderRadius" min="0" class="text-input" placeholder="0=直角" />
        </div>
        <div class="field">
          <label class="checkbox-label">
            <input type="checkbox" v-model="gridReplace" />替换现有区域
          </label>
        </div>
        <button class="btn-primary" @click="handleGenerateGrid">
          生成 {{ grid.rows * grid.cols }} 个网格区域
        </button>
      </div>
    </details>

    <!-- Duplicate -->
    <details class="batch-detail" :open="!!editor.selectedRegion">
      <summary class="batch-summary">等距复制
        <span v-if="!editor.selectedRegion" class="summary-hint">（选择区域后可用）</span>
      </summary>
      <div class="batch-body" v-if="editor.selectedRegion">
        <div class="field"><label>方向</label>
          <select class="select-input" v-model="dup.mode">
            <option value="horizontal">横向</option>
            <option value="vertical">纵向</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div class="field"><label>数量</label><input type="number" v-model.number="dup.count" min="1" class="text-input" /></div>
        <template v-if="dup.mode === 'custom'">
          <div class="field-row">
            <div class="field"><label>X 偏移</label><input type="number" v-model.number="dup.deltaX" class="text-input" /></div>
            <div class="field"><label>Y 偏移</label><input type="number" v-model.number="dup.deltaY" class="text-input" /></div>
          </div>
        </template>
        <template v-else>
          <div class="field"><label>间距</label><input type="number" v-model.number="dup.gapX" min="0" class="text-input" /></div>
        </template>
        <button class="btn-primary" @click="handleDuplicate">复制 {{ dup.count }} 个</button>
      </div>
    </details>

    <!-- Slice -->
    <details class="batch-detail">
      <summary class="batch-summary">长图切片
        <span v-if="!editor.activeLayer" class="summary-hint">（需活动图层）</span>
      </summary>
      <div class="batch-body">
        <div class="field"><label>切片高度</label><input type="number" v-model.number="slice.sliceHeight" min="1" class="text-input" /></div>
        <div class="field-row">
          <div class="field"><label>开始 Y</label><input type="number" v-model.number="slice.startY" min="0" class="text-input" /></div>
          <div class="field"><label>结束 Y</label><input type="number" v-model.number="slice.endY" placeholder="自动" class="text-input" /></div>
        </div>
        <div class="field"><label>重叠</label><input type="number" v-model.number="slice.overlap" min="0" class="text-input" /></div>
        <div class="field"><label>命名前缀</label><input type="text" v-model="slice.namePrefix" class="text-input" /></div>
        <div v-if="sliceError" class="field warn">{{ sliceError }}</div>
        <button class="btn-primary" @click="handleGenerateSlice" :disabled="!editor.activeLayer">生成切片</button>
      </div>
    </details>

    <!-- Guide-based slicing -->
    <details class="batch-detail" :open="editor.hGuides.length > 0 || editor.vGuides.length > 0">
      <summary class="batch-summary">参考线切片
        <span class="summary-hint" v-if="editor.hGuides.length === 0 && editor.vGuides.length === 0">（Ctrl+点击标尺添加参考线）</span>
        <span class="summary-hint" v-else>（{{ editor.hGuides.length }}横 {{ editor.vGuides.length }}竖）</span>
      </summary>
      <div class="batch-body">
        <div class="field hint">参考线交叉区域将生成裁剪框</div>
        <button class="btn-primary" @click="handleGuidSlice" :disabled="!editor.activeLayer || (editor.hGuides.length === 0 && editor.vGuides.length === 0)">从参考线生成切片</button>
      </div>
    </details>
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
.batch-detail { margin-bottom: 6px; }
.batch-summary {
  font-size: 12px; font-weight: 500; color: var(--text-secondary);
  cursor: pointer; padding: 4px 0; user-select: none;
}
.batch-summary:hover { color: var(--text-primary); }
.quick-size-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  position: relative;
}
.summary-main {
  min-width: 0;
}
.summary-hint { font-size: 10px; color: var(--text-muted); font-weight: 400; }
.quick-size-title-actions {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.quick-size-menu-btn {
  width: 24px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-muted);
}
.quick-size-menu-btn:hover,
.quick-size-menu-btn[aria-expanded="true"] {
  border-color: rgba(40, 199, 111, 0.4);
  background: rgba(40, 199, 111, 0.08);
  color: var(--accent);
}
.quick-size-menu-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
}
.quick-size-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 112px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-secondary);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
}
.quick-size-menu-item {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  padding: 0 9px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  text-align: left;
}
.quick-size-menu-item:hover:not(:disabled) {
  background: rgba(40, 199, 111, 0.08);
  color: var(--text-primary);
}
.quick-size-menu-item:disabled {
  opacity: 0.45;
  cursor: default;
}
.batch-body { padding: 8px 0 0 0; }
.preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; padding-top: 8px; }
.preset-item { position: relative; min-width: 0; }
.preset-item.selected .preset-chip {
  border-color: rgba(40, 199, 111, 0.58);
  background: rgba(40, 199, 111, 0.08);
  color: var(--text-primary);
}
.preset-chip {
  width: 100%;
  min-height: 38px; padding: 5px 7px; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text-secondary); display: flex; flex-direction: column;
  align-items: flex-start; justify-content: center; gap: 2px; text-align: left; min-width: 0;
}
.preset-chip:hover { border-color: var(--accent); color: var(--text-primary); }
.preset-chip:disabled { opacity: 0.45; cursor: default; }
.preset-chip span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.preset-chip small { color: var(--text-muted); font-size: 10px; }
.preset-delete {
  position: absolute; top: 3px; right: 3px;
  width: 16px; height: 16px; border: none; border-radius: 3px;
  background: rgba(0, 0, 0, 0.38); color: var(--text-muted);
  font-size: 12px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity 0.12s, color 0.12s, background 0.12s;
}
.preset-item:hover .preset-delete { opacity: 1; }
.preset-delete:hover { color: var(--danger); background: rgba(229, 92, 92, 0.16); }
.quick-size-add-item { z-index: 2; }
.add-preset-card {
  align-items: center;
  border-style: dashed;
  color: var(--text-muted);
}
.add-preset-card:hover,
.add-preset-card.active {
  border-color: var(--accent);
  background: rgba(40, 199, 111, 0.08);
  color: var(--text-primary);
}
.add-preset-icon {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.quick-size-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 20;
  width: min(236px, calc(200% + 5px));
  padding: 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
}
.quick-size-popover::before {
  content: '';
  position: absolute;
  top: -6px;
  right: 18px;
  width: 10px;
  height: 10px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  border-top: 1px solid var(--border);
  transform: rotate(45deg);
}
.quick-size-add-item:nth-child(odd) .quick-size-popover {
  left: 0;
  right: auto;
}
.quick-size-add-item:nth-child(odd) .quick-size-popover::before {
  left: 18px;
  right: auto;
}
.popover-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.popover-field span {
  color: var(--text-muted);
  font-size: 10px;
}
.popover-size-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 8px;
}
.popover-message { margin-top: 8px; color: #e5a400; }
.popover-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
.btn-ghost {
  min-height: 30px; padding: 6px 8px; background: var(--bg-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-secondary); font-size: 11px; cursor: pointer;
}
.btn-ghost:hover { border-color: var(--accent); color: var(--text-primary); }
.btn-ghost:disabled { opacity: 0.45; cursor: default; }
.quick-size-message { margin-top: 6px; color: var(--text-muted); font-size: 10px; line-height: 1.4; }
.warn { color: #e5a400; font-size: 11px; }
.hint { color: var(--text-muted); font-size: 10px; }
.btn-primary {
  width: 100%; padding: 8px 12px; background: var(--accent); color: #fff;
  border: none; border-radius: var(--radius); font-size: 12px; font-weight: 500;
  cursor: pointer; transition: opacity 0.15s;
}
.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
</style>
