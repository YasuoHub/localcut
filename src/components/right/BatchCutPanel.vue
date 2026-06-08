<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useHistoryStore } from '../../stores/history'
import { generateGridRegions, duplicateRegionBySpacing, generateSliceRegions, validateSliceOptions, generateGuideRegions } from '../../composables/useBatchRegions'
import { nextRegionName } from '../../composables/shapeUtils'
import type { CropRegion, DuplicateOptions } from '../../types'

const editor = useEditorStore()
const history = useHistoryStore()

interface PresetCropSize {
  id: string
  name: string
  width: number
  height: number
}

const presetCropSizes: PresetCropSize[] = [
  { id: 'free', name: '自由裁剪', width: 0, height: 0 },
  { id: 'wechat_cover', name: '公众号首图', width: 900, height: 383 },
  { id: 'wechat_secondary', name: '公众号次图', width: 200, height: 200 },
  { id: 'moments_cover', name: '朋友圈封面', width: 1080, height: 1080 },
  { id: 'desktop_wallpaper', name: '电脑壁纸', width: 1920, height: 1080 },
  { id: 'logo_design', name: 'Logo 设计', width: 500, height: 500 },
  { id: 'square_main', name: '方形主图', width: 800, height: 800 },
  { id: 'vertical_main', name: '竖版主图', width: 800, height: 1200 },
  { id: 'pdd_store', name: '拼多多店铺首页', width: 750, height: 1000 },
  { id: 'photo_1r', name: '标准 1 寸 / 1R', width: 295, height: 413 },
  { id: 'photo_2r', name: '标准 2 寸 / 2R', width: 413, height: 626 },
  { id: 'id_card', name: '二代身份证', width: 358, height: 441 },
]

function createPresetRegion(preset: PresetCropSize) {
  if (preset.width === 0 || preset.height === 0) {
    editor.setTool('rect')
    return
  }

  const layer = editor.activeLayer
  if (!layer) return
  const imgW = layer.image.naturalWidth
  const imgH = layer.image.naturalHeight
  let rectW = imgW
  let rectH = Math.round(imgW * (preset.height / preset.width))
  const shouldConstrain = editor.isSingleLayerMode && editor.constrainToImage
  if (shouldConstrain && rectH > imgH) {
    rectH = imgH
    rectW = Math.round(imgH * (preset.width / preset.height))
  }

  history.snapshot()
  const region: CropRegion = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: nextRegionName(),
    x: 0,
    y: shouldConstrain ? Math.max(0, Math.round((imgH - rectH) / 2)) : Math.round((imgH - rectH) / 2),
    width: rectW,
    height: rectH,
    shape: 'rect',
  }
  editor.regions.push(region)
  editor.selectRegion(region.id)
  editor.invalidateCanvas()
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

    <details class="batch-detail">
      <summary class="batch-summary">快捷区域尺寸
        <span v-if="!editor.activeLayer" class="summary-hint">（需活动图层）</span>
      </summary>
      <div class="preset-grid">
        <button
          v-for="preset in presetCropSizes"
          :key="preset.id"
          class="preset-chip"
          :disabled="!editor.activeLayer && preset.width > 0"
          :title="preset.width > 0 ? `${preset.name} ${preset.width}x${preset.height}` : preset.name"
          @click="createPresetRegion(preset)"
        >
          <span>{{ preset.name }}</span>
          <small v-if="preset.width > 0">{{ preset.width }}x{{ preset.height }}</small>
        </button>
      </div>
    </details>

    <!-- Grid generation -->
    <details class="batch-detail" open>
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
.summary-hint { font-size: 10px; color: var(--text-muted); font-weight: 400; }
.batch-body { padding: 8px 0 0 0; }
.preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; padding-top: 8px; }
.preset-chip {
  min-height: 38px; padding: 5px 7px; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text-secondary); display: flex; flex-direction: column;
  align-items: flex-start; justify-content: center; gap: 2px; text-align: left; min-width: 0;
}
.preset-chip:hover { border-color: var(--accent); color: var(--text-primary); }
.preset-chip:disabled { opacity: 0.45; cursor: default; }
.preset-chip span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.preset-chip small { color: var(--text-muted); font-size: 10px; }
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
