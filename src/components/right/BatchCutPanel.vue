<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useHistoryStore } from '../../stores/history'
import { generateGridRegions, duplicateRegionBySpacing, generateSliceRegions, validateSliceOptions, generateGuideRegions } from '../../composables/useBatchRegions'
import type { DuplicateOptions } from '../../types'

const editor = useEditorStore()
const history = useHistoryStore()

// ---- grid ----
const grid = ref({
  rows: 3, cols: 4,
  startX: 0, startY: 0,
  cellWidth: 800, cellHeight: 800,
  gapX: 0, gapY: 0,
  namePrefix: 'grid',
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
