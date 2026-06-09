<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useExportStore } from '../../stores/export'
import { useHistoryStore } from '../../stores/history'
import { useCropTemplates } from '../../composables/useCropTemplates'
import type { CropTemplate, CropTemplateCategory, TemplateConflictMode } from '../../types'

const editor = useEditorStore()
const exp = useExportStore()
const history = useHistoryStore()
const {
  templates,
  saveTemplate,
  applyTemplate,
  deleteTemplate,
  renameTemplate,
  updateTemplateCategory,
  toggleFavorite,
  duplicateTemplate,
  exportTemplates,
  importTemplatesFromText,
} = useCropTemplates()

const categoryOptions: { value: CropTemplateCategory; label: string }[] = [
  { value: 'general', label: '通用' },
  { value: 'ecommerce-main', label: '电商主图' },
  { value: 'detail-long', label: '详情长图' },
  { value: 'store-decoration', label: '店铺装修' },
  { value: 'custom', label: '自定义' },
]

const conflictOptions: { value: TemplateConflictMode; label: string }[] = [
  { value: 'rename', label: '重命名' },
  { value: 'overwrite', label: '覆盖' },
  { value: 'skip', label: '跳过' },
]

const saveName = ref('')
const saveCategory = ref<CropTemplateCategory>('general')
const saveExportOptions = ref({
  size: true,
  fit: true,
  fill: true,
  naming: true,
  formatQuality: true,
})

const selectedTplId = ref<string | null>(null)
const applyMode = ref<'regions' | 'full'>('full')
const searchText = ref('')
const categoryFilter = ref<'all' | CropTemplateCategory>('all')
const selectedExportIds = ref<Set<string>>(new Set())
const importConflictMode = ref<TemplateConflictMode>('rename')
const importMessage = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const renamingId = ref<string | null>(null)
const renameValue = ref('')

const canSave = computed(() => Boolean(editor.activeLayer && editor.regions.length > 0 && saveName.value.trim()))

const selectedTemplate = computed(() => templates.value.find(t => t.id === selectedTplId.value) ?? null)

const sortedTemplates = computed(() => {
  const keyword = searchText.value.trim().toLowerCase()
  return [...templates.value]
    .filter(t => categoryFilter.value === 'all' || t.category === categoryFilter.value)
    .filter(t => !keyword || t.name.toLowerCase().includes(keyword))
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      const aRecent = a.lastUsedAt ?? a.createdAt
      const bRecent = b.lastUsedAt ?? b.createdAt
      return bRecent - aRecent
    })
})

const exportSelectionCount = computed(() => selectedExportIds.value.size)

function handleSave() {
  if (!canSave.value) return
  const exportSettings = exp.createTemplateExportSettings(saveExportOptions.value)
  const tpl = saveTemplate(saveName.value.trim(), editor.regions, editor.activeLayer!, {
    category: saveCategory.value,
    exportSettings: Object.keys(exportSettings).length > 0 ? exportSettings : undefined,
  })
  selectedTplId.value = tpl.id
  saveName.value = ''
}

function handleApply() {
  if (!selectedTplId.value || !editor.activeLayer) return
  const tpl = selectedTemplate.value
  history.snapshot()
  const regions = applyTemplate(selectedTplId.value, editor.activeLayer)
  editor.regions.push(...regions)
  editor.invalidateCanvas()
  if (applyMode.value === 'full' && tpl?.exportSettings) {
    exp.applyTemplateExportSettings(tpl.exportSettings)
  }
}

function startRename(id: string, name: string) {
  renamingId.value = id
  renameValue.value = name
}

function finishRename(id: string) {
  const name = renameValue.value.trim()
  if (name) renameTemplate(id, name)
  renamingId.value = null
}

function handleDelete(id: string) {
  const tpl = templates.value.find(t => t.id === id)
  if (!tpl) return
  if (!window.confirm(`确认删除模板「${tpl.name}」？`)) return
  deleteTemplate(id)
  if (selectedTplId.value === id) selectedTplId.value = null
  const next = new Set(selectedExportIds.value)
  next.delete(id)
  selectedExportIds.value = next
}

function handleDuplicate(id: string) {
  const copy = duplicateTemplate(id)
  if (copy) selectedTplId.value = copy.id
}

function toggleExportSelection(id: string) {
  const next = new Set(selectedExportIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedExportIds.value = next
}

function downloadTemplateBundle(ids: string[]) {
  const bundle = exportTemplates(ids)
  if (!bundle) return
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = bundle.templates.length === 1 ? 'template.localcut-template.json' : 'templates.localcut-templates.json'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function exportSelected() {
  downloadTemplateBundle([...selectedExportIds.value])
}

function exportAllVisible() {
  downloadTemplateBundle(sortedTemplates.value.map(t => t.id))
}

function triggerImport() {
  fileInput.value?.click()
}

function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    const result = importTemplatesFromText(String(reader.result ?? ''), importConflictMode.value)
    const warnings = result.issues.map(i => i.message).join('；')
    importMessage.value = `导入 ${result.imported} 个，覆盖 ${result.overwritten} 个，重命名 ${result.renamed} 个，跳过 ${result.skipped} 个。${warnings ? ` ${warnings}` : ''}`
    input.value = ''
  }
  reader.readAsText(file)
}

function categoryLabel(category: CropTemplateCategory) {
  return categoryOptions.find(item => item.value === category)?.label ?? '通用'
}

function templateSummary(tpl: CropTemplate) {
  const chunks = [`${tpl.regions.length}区`]
  const settings = tpl.exportSettings
  if (!settings) return chunks.join(' / ')

  if (settings.batchUseCustomSize && settings.batchOutputWidth && settings.batchOutputHeight) {
    chunks.push(`${settings.batchOutputWidth}x${settings.batchOutputHeight}`)
  }
  if (settings.batchFitMode) chunks.push(settings.batchFitMode)
  if (settings.exportFormat) chunks.push(settings.exportFormat.toUpperCase())
  if (settings.exportFormat && settings.exportFormat !== 'png' && settings.exportQuality) {
    chunks.push(`${settings.exportQuality}%`)
  }
  return chunks.join(' / ')
}
</script>

<template>
  <section class="section template-assets">
    <div class="section-title asset-title">
      <div>
        <span>模板资产</span>
        <span class="title-sub">保存布局与导出规格</span>
      </div>
    </div>

    <div class="asset-block create-block">
      <div class="block-head">
        <span>新建资产</span>
        <span>{{ editor.regions.length }}区</span>
      </div>
      <div class="save-line">
        <input type="text" v-model="saveName" class="text-input asset-name-input" placeholder="商品宫格 / 详情切片" @keyup.enter="handleSave" />
        <button class="btn-small save-btn" :disabled="!canSave" @click="handleSave">保存</button>
      </div>

      <select class="select-input compact-select" v-model="saveCategory">
        <option v-for="item in categoryOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>

      <div class="option-label">随模板保存</div>
      <div class="save-options">
        <label class="option-chip locked">
          <input type="checkbox" checked disabled />
          <span class="option-text">区域</span>
          <span class="template-save-help" title="必选。保存当前裁剪区域的名称、形状、位置、尺寸和自定义路径比例，套用到新图片时会按活动图层等比还原。" aria-label="区域说明" @click.prevent.stop>?</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" v-model="saveExportOptions.size" />
          <span class="option-text">尺寸</span>
          <span class="template-save-help" title="保存批量导出的统一尺寸设置，包括是否启用统一输出尺寸，以及输出宽度和高度。" aria-label="尺寸说明" @click.prevent.stop>?</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" v-model="saveExportOptions.fit" />
          <span class="option-text">适配</span>
          <span class="template-save-help" title="保存统一尺寸下的图片适配方式，例如覆盖、包含、拉伸或保持原始裁剪尺寸。" aria-label="适配说明" @click.prevent.stop>?</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" v-model="saveExportOptions.fill" />
          <span class="option-text">背景</span>
          <span class="template-save-help" title="保存导出背景填充色。常用于 contain 模式或透明区域需要补底色的商品图。" aria-label="背景说明" @click.prevent.stop>?</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" v-model="saveExportOptions.naming" />
          <span class="option-text">命名</span>
          <span class="template-save-help" title="保存文件命名规则，以及单图导出是否沿用批量命名规则，便于同版式素材保持交付文件名一致。" aria-label="命名说明" @click.prevent.stop>?</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" v-model="saveExportOptions.formatQuality" />
          <span class="option-text">格式</span>
          <span class="template-save-help" title="保存导出格式和质量参数，例如 PNG、JPG、WebP，以及 JPG/WebP 的压缩质量。" aria-label="格式说明" @click.prevent.stop>?</span>
        </label>
      </div>
    </div>

    <div class="asset-block library-block">
      <div class="block-head">
        <span>资产库</span>
        <span>{{ sortedTemplates.length }}项</span>
      </div>

      <div class="filter-grid">
        <input type="search" v-model="searchText" class="text-input search-input" placeholder="搜索模板" />
        <select class="select-input" v-model="categoryFilter">
          <option value="all">全部分类</option>
          <option v-for="item in categoryOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </div>

      <div class="library-action-groups">
        <div class="library-action-group">
          <div class="action-group-head">
            <span>导入模板</span>
            <span>同名时如何处理</span>
          </div>
          <div class="import-control-row">
            <button class="btn-ghost import-btn" @click="triggerImport">导入文件</button>
            <label class="conflict-field" title="只在导入模板文件时生效：当文件里的模板名称与当前资产库已有模板重名时，选择重命名、覆盖或跳过。">
              <span>同名处理</span>
              <select class="select-input conflict-select" v-model="importConflictMode">
                <option v-for="item in conflictOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="library-action-group">
          <div class="action-group-head">
            <span>导出模板</span>
            <span>{{ exportSelectionCount }} 项已选</span>
          </div>
          <div class="export-control-row">
            <button class="btn-ghost" :disabled="exportSelectionCount === 0" @click="exportSelected">导出选中</button>
            <button class="btn-ghost" :disabled="sortedTemplates.length === 0" @click="exportAllVisible">导出当前列表</button>
          </div>
        </div>
        <input ref="fileInput" type="file" accept=".json,.localcut-template.json,.localcut-templates.json,application/json" hidden @change="handleImportFile" />
      </div>

      <div v-if="importMessage" class="import-message">{{ importMessage }}</div>

      <div v-if="sortedTemplates.length > 0" class="template-list scrollbar">
        <div
          v-for="tpl in sortedTemplates"
          :key="tpl.id"
          class="template-item"
          :class="{ active: selectedTplId === tpl.id }"
          @click="selectedTplId = tpl.id"
        >
          <div class="tpl-select-col">
            <input
              type="checkbox"
              class="tpl-check"
              :checked="selectedExportIds.has(tpl.id)"
              title="加入导出"
              @click.stop
              @change="toggleExportSelection(tpl.id)"
            />
            <button class="star-btn" :class="{ active: tpl.favorite }" title="收藏" @click.stop="toggleFavorite(tpl.id)">★</button>
          </div>
          <div class="tpl-main">
            <div class="tpl-title-row">
              <span v-if="renamingId !== tpl.id" class="tpl-name" @dblclick.stop="startRename(tpl.id, tpl.name)">{{ tpl.name }}</span>
              <input
                v-else
                class="tpl-rename-input"
                v-model="renameValue"
                @blur="finishRename(tpl.id)"
                @keyup.enter="finishRename(tpl.id)"
                @click.stop
                autofocus
              />
            </div>
            <div class="tpl-meta">
              <span class="category-badge">{{ categoryLabel(tpl.category) }}</span>
              <span class="summary-text">{{ templateSummary(tpl) }}</span>
            </div>
          </div>
          <div class="tpl-actions">
            <button class="icon-btn" title="复制模板" @click.stop="handleDuplicate(tpl.id)">⧉</button>
            <button class="icon-btn danger" title="删除模板" @click.stop="handleDelete(tpl.id)">×</button>
          </div>
        </div>
      </div>
      <div v-else class="empty">暂无匹配模板，保存当前区域以创建模板</div>
    </div>

    <div v-if="selectedTemplate" class="asset-block selected-tools">
      <div class="block-head">
        <span>套用方式</span>
        <span>{{ selectedTemplate.exportSettings ? '含配置' : '仅区域' }}</span>
      </div>
      <select class="select-input compact-select" :value="selectedTemplate.category" @change="updateTemplateCategory(selectedTemplate.id, ($event.target as HTMLSelectElement).value as CropTemplateCategory)">
        <option v-for="item in categoryOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
      </select>
      <div class="apply-mode segmented">
        <label><input type="radio" value="regions" v-model="applyMode" /><span>只套区域</span></label>
        <label :class="{ disabled: !selectedTemplate.exportSettings }"><input type="radio" value="full" v-model="applyMode" :disabled="!selectedTemplate.exportSettings" /><span>区域+配置</span></label>
      </div>
      <button class="btn-primary apply-btn" :disabled="!editor.activeLayer" @click="handleApply">
        套用模板
      </button>
    </div>
  </section>
</template>

<style scoped>
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.template-assets { display: flex; flex-direction: column; gap: 10px; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); display: flex; align-items: flex-start; justify-content: space-between; }
.asset-title { margin-bottom: 0; }
.asset-title > div { display: flex; flex-direction: column; gap: 3px; }
.title-sub { font-size: 10px; font-weight: 400; letter-spacing: 0; color: var(--text-muted); opacity: 0.8; }
.asset-block {
  background: rgba(17, 17, 15, 0.72);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 9px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.block-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 7px; font-size: 10px; color: var(--text-muted);
}
.block-head span:first-child { color: var(--text-secondary); font-weight: 600; }
.create-block { border-color: rgba(40, 199, 111, 0.18); }
.library-block { padding-bottom: 9px; }
.field { margin-bottom: 10px; min-width: 0; }
.field-row { display: flex; gap: 8px; align-items: flex-end; }
.field-row .field { flex: 1; }
.field-compact { flex: 0 0 auto !important; }
.save-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; margin-bottom: 7px; }
.text-input,
.select-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 8px; color: var(--text-primary);
  font-size: 12px; outline: none; box-sizing: border-box;
}
.text-input:focus,
.select-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(40, 199, 111, 0.08);
}
.asset-name-input { font-weight: 600; }
.compact-select { height: 30px; margin-bottom: 8px; }
.option-label { margin: 8px 0 5px; color: var(--text-muted); font-size: 10px; }
.btn-small,
.btn-primary,
.btn-ghost {
  border: none; border-radius: 6px; font-size: 11px; cursor: pointer;
  white-space: nowrap; transition: opacity 0.15s, border-color 0.15s, color 0.15s;
}
.btn-small { padding: 6px 12px; background: var(--accent); color: #071018; font-weight: 700; }
.save-btn { height: 30px; }
.btn-primary { width: 100%; padding: 8px 12px; background: var(--accent); color: #071018; font-size: 12px; font-weight: 700; }
.btn-ghost { padding: 5px 7px; background: var(--bg-primary); color: var(--text-secondary); border: 1px solid var(--border); }
.btn-small:hover,
.btn-primary:hover,
.btn-ghost:hover { opacity: 0.95; border-color: rgba(40, 199, 111, 0.36); color: var(--text-primary); }
.btn-small:disabled,
.btn-primary:disabled,
.btn-ghost:disabled { opacity: 0.45; cursor: default; }
.save-options { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.option-chip {
  position: relative;
  height: 25px; display: flex; align-items: center; justify-content: center; gap: 4px;
  border: 1px solid var(--border); border-radius: 6px; background: rgba(34, 34, 30, 0.72);
  color: var(--text-muted); font-size: 10px; cursor: pointer; user-select: none;
}
.option-chip:has(input:checked) {
  color: var(--text-primary);
  border-color: rgba(40, 199, 111, 0.42);
  background: rgba(40, 199, 111, 0.1);
}
.option-chip.locked { color: var(--accent); cursor: default; }
.option-chip input { display: none; }
.option-text { line-height: 1; }
.template-save-help {
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 13px; height: 13px; border-radius: 50%;
  border: 1px solid var(--border); color: var(--text-muted);
  font-size: 9px; font-weight: 700; line-height: 1;
  opacity: 0; pointer-events: none;
  transition: opacity 0.12s, border-color 0.12s, color 0.12s;
}
.option-chip:hover .template-save-help { opacity: 1; pointer-events: auto; }
.template-save-help:hover { border-color: var(--accent); color: var(--accent); }
.tpl-check { accent-color: var(--accent); }
.filter-grid { display: grid; grid-template-columns: minmax(0, 1fr) 96px; gap: 6px; margin-bottom: 8px; }
.search-input { padding-left: 9px; }
.library-action-groups { display: flex; flex-direction: column; gap: 7px; }
.library-action-group {
  padding: 7px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
}
.action-group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 6px; color: var(--text-muted); font-size: 10px; line-height: 1.2;
}
.action-group-head span:first-child { color: var(--text-secondary); font-weight: 600; }
.action-group-head span:last-child {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.import-control-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 6px; align-items: end; }
.export-control-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.import-btn { height: 30px; }
.conflict-field {
  display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 5px; align-items: center;
  min-width: 0; color: var(--text-muted); font-size: 10px;
}
.conflict-select { height: 30px; font-size: 11px; padding-left: 6px; padding-right: 4px; }
.import-message {
  padding: 7px 8px; background: rgba(229, 164, 0, 0.08); border: 1px solid rgba(229, 164, 0, 0.18);
  border-radius: 6px; color: #d9b45a; font-size: 10px; line-height: 1.45; margin-top: 7px;
}
.template-list {
  max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;
  margin-top: 9px; padding: 9px 2px 0 0; border-top: 1px solid var(--border);
}
.template-item {
  display: flex; align-items: center; gap: 7px; padding: 8px 7px;
  border-radius: 6px; cursor: pointer; font-size: 12px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
}
.template-item:hover { background: var(--bg-hover); border-color: rgba(40, 199, 111, 0.22); }
.template-item.active {
  background: linear-gradient(90deg, rgba(40, 199, 111, 0.14), rgba(40, 199, 111, 0.04));
  border-color: rgba(40, 199, 111, 0.42);
}
.tpl-select-col { width: 18px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tpl-check { width: 13px; height: 13px; flex-shrink: 0; }
.star-btn,
.icon-btn {
  flex-shrink: 0; width: 20px; height: 20px; border: none; border-radius: 5px;
  background: transparent; color: var(--text-muted); cursor: pointer; line-height: 18px; padding: 0;
}
.star-btn { width: 18px; height: 18px; font-size: 12px; }
.star-btn.active { color: #e5a400; }
.star-btn:hover,
.icon-btn:hover { background: var(--bg-primary); color: var(--text-primary); }
.icon-btn.danger:hover { color: var(--danger); background: rgba(229, 92, 92, 0.16); }
.tpl-main { flex: 1; min-width: 0; }
.tpl-title-row { display: flex; min-width: 0; }
.tpl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--text-primary); }
.tpl-meta {
  display: flex; align-items: center; gap: 5px; overflow: hidden; margin-top: 5px;
  color: var(--text-muted); font-size: 10px; white-space: nowrap;
}
.category-badge {
  max-width: 58px; overflow: hidden; text-overflow: ellipsis;
  padding: 1px 5px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); color: var(--text-secondary);
}
.summary-text { overflow: hidden; text-overflow: ellipsis; }
.tpl-rename-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--accent);
  border-radius: 3px; color: var(--text-primary); font-size: 12px; padding: 1px 4px; outline: none;
}
.tpl-actions { display: flex; flex-direction: column; gap: 3px; opacity: 0.45; transition: opacity 0.15s; }
.template-item:hover .tpl-actions,
.template-item.active .tpl-actions { opacity: 1; }
.selected-tools {
  order: 4;
  border-color: rgba(40, 199, 111, 0.24);
  background: rgba(40, 199, 111, 0.06);
}
.segmented {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;
  background: var(--bg-primary); border: 1px solid var(--border); border-radius: 6px; padding: 3px;
}
.segmented label {
  display: flex; align-items: center; justify-content: center; min-height: 26px;
  border-radius: 5px; color: var(--text-muted); font-size: 11px; cursor: pointer;
}
.segmented label:has(input:checked) { background: rgba(40, 199, 111, 0.16); color: var(--text-primary); }
.segmented label.disabled { opacity: 0.42; cursor: default; }
.segmented input { display: none; }
.apply-btn { height: 32px; }
.library-block .empty {
  margin-top: 9px; padding-top: 9px; border-top: 1px solid var(--border);
}
.empty { font-size: 11px; color: var(--text-muted); }
</style>
