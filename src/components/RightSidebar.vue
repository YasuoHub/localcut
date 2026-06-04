<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { CropRegion, TextAnnotation, ImageFormat } from '../types'
import { useExport } from '../composables/useExport'
import { useEditorStore } from '../stores/editor'
import { useExportStore } from '../stores/export'
import { useHistoryStore } from '../stores/history'

const editor = useEditorStore()
const exp = useExportStore()
const history = useHistoryStore()

const { exportSingleRegion, exportRegions, downloadZip } = useExport()

const shapeLabels: Record<string, string> = {
  rect: '矩形', circle: '圆形', triangle: '三角形', diamond: '菱形', star: '星形', heart: '心形', custom: '多边形',
}
const shapeIcons: Record<string, string> = {
  rect: '▭', circle: '○', triangle: '△', diamond: '◇', star: '☆', heart: '♡', custom: '⬠',
}

// ---- region editing (component-local form state) ----
const editName = ref('')
const editX = ref(0)
const editY = ref(0)
const editWidth = ref(0)
const editHeight = ref(0)
const widthFocused = ref(false)
const heightFocused = ref(false)

function syncFromRegion(r: CropRegion) {
  if (!widthFocused.value) editWidth.value = Math.round(r.width)
  if (!heightFocused.value) editHeight.value = Math.round(r.height)
  editX.value = Math.round(r.x)
  editY.value = Math.round(r.y)
}

watch(() => editor.selectedRegion, (r, old) => {
  if (r) {
    if (r.id !== old?.id) {
      editName.value = r.name
      editX.value = Math.round(r.x)
      editY.value = Math.round(r.y)
      editWidth.value = Math.round(r.width)
      editHeight.value = Math.round(r.height)
    }
    if (!exp.customOutputSize) {
      exp.exportOutputWidth = Math.round(r.width)
      exp.exportOutputHeight = Math.round(r.height)
    }
  }
}, { immediate: true })

watch(
  () => editor.selectedRegion ? `${editor.selectedRegion.width}|${editor.selectedRegion.height}|${editor.selectedRegion.x}|${editor.selectedRegion.y}` : null,
  () => {
    if (editor.selectedRegion) {
      syncFromRegion(editor.selectedRegion)
      if (!exp.customOutputSize) {
        exp.exportOutputWidth = Math.round(editor.selectedRegion.width)
        exp.exportOutputHeight = Math.round(editor.selectedRegion.height)
      }
    }
  },
)

function updateName() {
  if (!editor.selectedRegion) return
  const name = editName.value.trim()
  if (!name) { editName.value = editor.selectedRegion.name; return }
  if (editor.regions.some(r => r.id !== editor.selectedRegion!.id && r.name === name)) {
    editName.value = editor.selectedRegion.name
    return
  }
  history.snapshot()
  editor.selectedRegion.name = name
}
function updateSize() {
  if (!editor.selectedRegion) return
  const newW = Math.max(1, editWidth.value), newH = Math.max(1, editHeight.value)
  if (newW === Math.round(editor.selectedRegion.width) && newH === Math.round(editor.selectedRegion.height)) return
  history.snapshot()
  editor.selectedRegion.width = newW
  editor.selectedRegion.height = newH
}

function updatePosition() {
  if (!editor.selectedRegion) return
  const newX = editX.value, newY = editY.value
  if (newX === Math.round(editor.selectedRegion.x) && newY === Math.round(editor.selectedRegion.y)) return
  history.snapshot()
  editor.selectedRegion.x = newX
  editor.selectedRegion.y = newY
}

// ---- text editing (component-local form state) ----
const editText = ref('')
const editFontSize = ref(24)
const editFontColor = ref('#ffffff')
const editFontWeight = ref<'normal' | 'bold'>('bold')

watch(() => editor.selectedText, (t, old) => {
  if (t && t.id !== old?.id) {
    editText.value = t.text
    editFontSize.value = t.fontSize
    editFontColor.value = t.fontColor
    editFontWeight.value = t.fontWeight
  }
}, { immediate: true })

function updateText() {
  if (!editor.selectedText) return
  const trimmed = editText.value.trim()
  if (!trimmed) {
    editor.deleteText(editor.selectedText.id)
    return
  }
  history.snapshot()
  editor.selectedText.text = trimmed
  editor.selectedText.fontSize = editFontSize.value
  editor.selectedText.fontColor = editFontColor.value
  editor.selectedText.fontWeight = editFontWeight.value
}

// ---- single export ----
const exportingSingle = ref(false)
async function handleExportSingle() {
  const region = editor.selectedRegion
  if (!editor.imageLoaded || !region) return
  exportingSingle.value = true
  try {
    await exportSingleRegion(
      editor.layers, region,
      exp.exportFormat, exp.exportQuality,
      exp.exportOutputWidth, exp.exportOutputHeight, exp.exportDpr,
      editor.showOriginal,
      editor.textAnnotations,
    )
  } catch (err) { console.error('Export failed:', err) }
  finally { exportingSingle.value = false }
}

// ---- output size sync ----
function handleOutputWChange() {
  if (exp.exportLockAspect && editor.selectedRegion && exp.exportOutputWidth != null) {
    exp.exportOutputHeight = Math.round(exp.exportOutputWidth * editor.selectedRegion.height / editor.selectedRegion.width)
  }
}
function handleOutputHChange() {
  if (exp.exportLockAspect && editor.selectedRegion && exp.exportOutputHeight != null) {
    exp.exportOutputWidth = Math.round(exp.exportOutputHeight * editor.selectedRegion.width / editor.selectedRegion.height)
  }
}

// ---- region list ----
const sortedRegions = computed(() => [...editor.regions].reverse())
const checkedCount = computed(() => editor.selectedRegionIds.size)

function selectRegion(id: string) { editor.selectRegion(id); editor.activeTool = 'select' }

function checkedRegions(): CropRegion[] {
  if (editor.selectedRegionIds.size === 0) return editor.regions
  return editor.regions.filter(r => editor.selectedRegionIds.has(r.id))
}

const exporting = ref(false)

// layer rename state
const renamingId = ref<string | null>(null)
const renameValue = ref('')

async function handleBatchExport() {
  if (!editor.imageLoaded || editor.regions.length === 0) return
  const toExport = checkedRegions()
  if (toExport.length === 0) return
  exporting.value = true
  try {
    // 批量导出始终按裁剪框原始宽高，忽略自定义输出尺寸
    const blob = await exportRegions(
      editor.layers, toExport,
      exp.exportFormat, exp.exportQuality,
      null, null, exp.exportDpr,
      editor.showOriginal,
      editor.textAnnotations,
    )
    downloadZip(blob)
  } catch (err) { console.error('Export failed:', err) }
  finally { exporting.value = false }
}
</script>

<template>
  <aside class="sidebar">
    <div class="top-half scrollbar">

    <!-- Layer panel -->
    <section class="section" v-if="editor.layers.length > 0">
      <div class="section-title">图层</div>
      <div class="layer-list scrollbar">
        <div
          v-for="(layer, idx) in editor.layers" :key="layer.id"
          class="layer-item" :class="{ active: layer.id === editor.activeLayerId }"
          @click="editor.setActiveLayer(layer.id)"
        >
          <span class="layer-visibility" @click.stop="history.snapshot(); editor.toggleLayerVisible(layer.id)">{{ layer.visible ? '👁' : '—' }}</span>
          <span class="layer-name" v-if="renamingId !== layer.id" @dblclick.stop="renamingId = layer.id; renameValue = layer.name">{{ layer.name }}</span>
          <input
            v-else
            class="layer-rename-input"
            v-model="renameValue"
            @blur="editor.renameLayer(layer.id, renameValue || layer.name); renamingId = null"
            @keyup.enter="editor.renameLayer(layer.id, renameValue || layer.name); renamingId = null"
            @click.stop
            ref="renameInput"
            autofocus
          />
          <span class="layer-order-btns">
            <button class="layer-order-btn" :disabled="idx === 0" @click.stop="history.snapshot(); editor.moveLayerUp(layer.id)">▲</button>
            <button class="layer-order-btn" :disabled="idx === editor.layers.length - 1" @click.stop="history.snapshot(); editor.moveLayerDown(layer.id)">▼</button>
          </span>
          <button class="layer-delete" title="删除图层" @click.stop="history.snapshot(); editor.removeLayer(layer.id)">×</button>
        </div>
      </div>
    </section>

    <!-- Brush settings -->
    <section class="section" v-if="editor.activeTool === 'brush'">
      <div class="section-title">画笔设置</div>
      <div class="field"><label>大小: {{ editor.brushSettings.size }}px</label><input type="range" min="1" max="100" v-model.number="editor.brushSettings.size" /></div>
      <div class="field"><label>颜色</label><input type="color" v-model="editor.brushSettings.color" class="color-input" /></div>
    </section>

    <!-- Eraser settings -->
    <section class="section" v-if="editor.activeTool === 'eraser'">
      <div class="section-title">橡皮设置</div>
      <div class="field"><label>大小: {{ editor.eraserSettings.size }}px</label><input type="range" min="1" max="150" v-model.number="editor.eraserSettings.size" /></div>
    </section>

    <!-- Magic wand settings -->
    <section class="section" v-if="editor.activeTool === 'magic-wand'">
      <div class="section-title">魔棒设置</div>
      <div class="field"><label>容差: {{ editor.magicWandTolerance }}</label><input type="range" min="1" max="100" v-model.number="editor.magicWandTolerance" /></div>
    </section>

    <!-- Region properties -->
    <section class="section" v-if="editor.selectedRegion">
      <div class="section-title">区域属性</div>
      <div class="field"><label>名称</label><input type="text" v-model="editName" @blur="updateName" @keyup.enter="updateName" /></div>
      <div class="field-row">
        <div class="field"><label>X (px)</label><input type="number" v-model.number="editX" @change="updatePosition" /></div>
        <div class="field"><label>Y (px)</label><input type="number" v-model.number="editY" @change="updatePosition" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>宽度 (px)</label><input type="number" v-model.number="editWidth" min="1" @focus="widthFocused = true" @blur="widthFocused = false; updateSize()" /></div>
        <div class="field"><label>高度 (px)</label><input type="number" v-model.number="editHeight" min="1" @focus="heightFocused = true" @blur="heightFocused = false; updateSize()" /></div>
      </div>
      <div class="field"><label>形状</label><div class="readonly-value">{{ shapeLabels[editor.selectedRegion.shape] ?? editor.selectedRegion.shape }}</div></div>
      <button class="btn-primary export-single-btn" :disabled="exportingSingle" @click="handleExportSingle">{{ exportingSingle ? '导出中...' : '导出此区域' }}</button>
    </section>

    <!-- Text properties -->
    <section class="section" v-if="editor.selectedText">
      <div class="section-title">文字属性</div>
      <div class="field"><label>内容</label><input type="text" v-model="editText" placeholder="输入文字..." @blur="updateText" @keyup.enter="updateText" /></div>
      <div class="field-row">
        <div class="field"><label>字号</label><input type="number" v-model.number="editFontSize" min="8" max="200" @change="updateText" /></div>
        <div class="field"><label>粗细</label><select v-model="editFontWeight" @change="updateText" class="select-input"><option value="normal">常规</option><option value="bold">粗体</option></select></div>
      </div>
      <div class="field"><label>颜色</label><input type="color" v-model="editFontColor" @change="updateText" class="color-input" /></div>
    </section>

    <!-- No selection -->
    <section class="section" v-if="!editor.selectedRegion && !editor.selectedText && editor.activeTool !== 'brush' && editor.activeTool !== 'eraser' && editor.activeTool !== 'magic-wand'">
      <div class="section-title">属性</div>
      <div class="empty">选择区域或文字以编辑属性</div>
    </section>

    <!-- Export settings -->
    <section class="section">
      <div class="section-title">导出设置</div>
      <div class="field"><label>格式</label>
        <div class="radio-group">
          <label class="radio" v-for="fmt in (['png', 'jpeg', 'webp'] as ImageFormat[])" :key="fmt">
            <input type="radio" :value="fmt" v-model="exp.exportFormat" />{{ fmt.toUpperCase() }}
          </label>
        </div>
      </div>
      <div class="field" v-if="exp.exportFormat === 'jpeg' || exp.exportFormat === 'webp'"><label>质量: {{ exp.exportQuality }}%</label><input type="range" min="10" max="100" v-model.number="exp.exportQuality" /></div>
      <div class="field"><label class="checkbox-label"><input type="checkbox" v-model="exp.customOutputSize" />自定义输出尺寸</label></div>
      <div class="field-row">
        <div class="field"><label>输出宽度</label>
          <input v-if="exp.customOutputSize" type="number" v-model.number="exp.exportOutputWidth" min="1" @change="handleOutputWChange" />
          <div v-else class="readonly-value">{{ exp.exportOutputWidth ?? '—' }}</div>
        </div>
        <div class="field"><label>输出高度</label>
          <input v-if="exp.customOutputSize" type="number" v-model.number="exp.exportOutputHeight" min="1" @change="handleOutputHChange" />
          <div v-else class="readonly-value">{{ exp.exportOutputHeight ?? '—' }}</div>
        </div>
      </div>
      <div class="field" v-if="exp.customOutputSize"><label class="checkbox-label"><input type="checkbox" v-model="exp.exportLockAspect" />锁定宽高比</label></div>
      <div class="field"><label>设备像素比: {{ exp.exportDpr }}x</label><input type="range" min="1" max="4" step="0.5" v-model.number="exp.exportDpr" /></div>
    </section>

    </div>

    <!-- Regions list + Batch export -->
    <div class="bottom-half">
    <section class="section region-group">
      <div class="section-title">裁剪区域 [{{ editor.regions.length }}]
        <button  class="clear-all-btn" title="一键清空" @click="history.snapshot(); editor.clearRegions()">清空</button>
      </div>
      <div v-if="editor.regions.length === 0" class="empty">暂无区域</div>
      <div v-else class="region-list scrollbar">
        <div
          v-for="r in sortedRegions" :key="r.id"
          class="region-item" :class="{ selected: r.id === editor.selectedRegionId }"
          @click="selectRegion(r.id)"
        >
          <input type="checkbox" :checked="editor.selectedRegionIds.has(r.id)" class="region-check" @click.stop @change="editor.toggleRegionCheck(r.id)" />
          <span class="region-shape-icon">{{ shapeIcons[r.shape] ?? '▭' }}</span>
          <span class="region-name">{{ r.name }}</span>
          <span class="region-dims">{{ Math.round(r.width) }}×{{ Math.round(r.height) }}</span>
          <button class="region-delete" title="删除" @click.stop="history.snapshot(); editor.deleteRegion(r.id)">×</button>
        </div>
      </div>
      <button class="btn-primary export-btn" :disabled="exporting || editor.regions.length === 0" @click="handleBatchExport">
        {{ exporting ? '导出中...' : `批量导出 — ${checkedCount || editor.regions.length} 项` }}
      </button>
    </section>
    </div>
  </aside>
</template>

<style scoped>
.sidebar { width: 240px; height: 100%; background: var(--bg-secondary); border-left: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.top-half { flex: 1; overflow-y: auto; border-bottom: 1px solid var(--border); }
.bottom-half { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.count { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 8px; font-size: 10px; color: var(--text-secondary); }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.field-row { display: flex; gap: 8px; }
.field-row .field { flex: 1; }
.readonly-value { padding: 6px 10px; background: var(--bg-primary); border-radius: var(--radius); color: var(--text-muted); font-size: 12px; }
.radio-group { display: flex; gap: 4px; }
.radio { flex: 1; display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 5px 8px; border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; border: 1px solid var(--border); }
.radio:has(input:checked) { border-color: var(--accent); color: var(--accent); }
.radio input { accent-color: var(--accent);  margin-right: 2px; vertical-align: bottom;}
.checkbox-label { display: flex !important; align-items: center; gap: 6px; cursor: pointer; font-size: 12px !important; }
.checkbox-label input { accent-color: var(--accent); }
.empty { font-size: 11px; color: var(--text-muted); }
.export-single-btn { width: 100%; margin-top: 4px; }
.color-input { width: 100%; height: 32px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-primary); cursor: pointer; padding: 2px; }
.select-input { width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary); font-size: 12px; outline: none; }
.select-input:focus { border-color: var(--accent); }
.region-group { flex: 1; display: flex; flex-direction: column; min-height: 0; padding-bottom: 14px; }
.region-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.region-item { display: flex; align-items: center; gap: 5px; padding: 5px 6px; border-radius: var(--radius); cursor: pointer; transition: background 0.1s; font-size: 12px; flex-shrink: 0; }
.region-item:hover { background: var(--bg-hover); }
.region-item.selected { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.region-check { flex-shrink: 0; accent-color: var(--accent); cursor: pointer; width: 13px; height: 13px; }
.region-shape-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
.region-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.region-dims { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

.layer-list { display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
.layer-item { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: var(--radius); cursor: pointer; font-size: 11px; }
.layer-item:hover { background: var(--bg-hover); }
.layer-item.active { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.layer-visibility { cursor: pointer; font-size: 12px; flex-shrink: 0; }
.layer-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer-rename-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--accent); border-radius: 3px; color: var(--text-primary); font-size: 11px; padding: 1px 4px; outline: none; min-width: 0; }
.layer-order-btns { display: flex; flex-shrink: 0; }
.layer-order-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 8px; padding: 0 2px; }
.layer-order-btn:hover { color: var(--text-primary); }
.layer-order-btn:disabled { opacity: 0.3; cursor: default; }
.layer-delete { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 0 3px; border-radius: 3px; }
.layer-delete:hover { background: rgba(229, 92, 92, 0.2); color: var(--danger); }
.region-delete {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 11px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
  opacity: 0; transition: opacity 0.1s; line-height: 1;
}
.region-item:hover .region-delete { opacity: 1; }
.region-delete:hover { background: rgba(229, 92, 92, 0.2); color: var(--danger); }
.clear-all-btn {
  background: none; border: 1px solid var(--border); color: var(--text-muted);
  font-size: 10px; padding: 1px 8px; border-radius: 3px; cursor: pointer;
}
.clear-all-btn:hover { border-color: var(--danger); color: var(--danger); }
.export-btn { width: 100%; margin-top: 8px; flex-shrink: 0; }
</style>
