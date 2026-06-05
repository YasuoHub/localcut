<script setup lang="ts">
import { ref, computed } from 'vue'
import { useEditorStore } from '../../stores/editor'
import { useHistoryStore } from '../../stores/history'
import { useCropTemplates } from '../../composables/useCropTemplates'

const editor = useEditorStore()
const history = useHistoryStore()
const { templates, saveTemplate, applyTemplate, deleteTemplate, renameTemplate } = useCropTemplates()

const saveName = ref('')

const canSave = computed(() => {
  return editor.activeLayer && editor.regions.length > 0 && saveName.value.trim()
})

function handleSave() {
  if (!canSave.value) return
  saveTemplate(saveName.value.trim(), editor.regions, editor.activeLayer!)
  saveName.value = ''
}

const selectedTplId = ref<string | null>(null)

function handleApply() {
  if (!selectedTplId.value || !editor.activeLayer) return
  history.snapshot()
  const regions = applyTemplate(selectedTplId.value, editor.activeLayer!)
  editor.regions.push(...regions)
}

const renamingId = ref<string | null>(null)
const renameValue = ref('')

function startRename(id: string, name: string) {
  renamingId.value = id
  renameValue.value = name
}

function finishRename(id: string) {
  const name = renameValue.value.trim()
  if (name) renameTemplate(id, name)
  renamingId.value = null
}
</script>

<template>
  <section class="section">
    <div class="section-title">模板</div>

    <!-- save -->
    <div class="field-row">
      <div class="field" style="flex:1">
        <input type="text" v-model="saveName" class="text-input" placeholder="模板名" @keyup.enter="handleSave" />
      </div>
      <div class="field">
        <button class="btn-small" :disabled="!canSave" @click="handleSave">保存</button>
      </div>
    </div>

    <!-- list & apply -->
    <div v-if="templates.length > 0" class="template-list">
      <div
        v-for="tpl in templates"
        :key="tpl.id"
        class="template-item"
        :class="{ active: selectedTplId === tpl.id }"
        @click="selectedTplId = tpl.id"
      >
        <span class="tpl-name" v-if="renamingId !== tpl.id" @dblclick.stop="startRename(tpl.id, tpl.name)">{{ tpl.name }}</span>
        <input
          v-else
          class="tpl-rename-input"
          v-model="renameValue"
          @blur="finishRename(tpl.id)"
          @keyup.enter="finishRename(tpl.id)"
          @click.stop
          autofocus
        />
        <span class="tpl-regions">{{ tpl.regions.length }}区</span>
        <button class="tpl-delete" @click.stop="deleteTemplate(tpl.id)" title="删除模板">×</button>
      </div>
      <button class="btn-primary" style="margin-top:8px" :disabled="!editor.activeLayer || !selectedTplId" @click="handleApply">
        套用模板
      </button>
    </div>
    <div v-else class="empty">暂无模板，保存当前区域以创建模板</div>
  </section>
</template>

<style scoped>
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; }
.field { margin-bottom: 10px; }
.field-row { display: flex; gap: 8px; align-items: flex-end; }
.field-row .field { flex: 1; }
.text-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary);
  font-size: 12px; outline: none; box-sizing: border-box;
}
.text-input:focus { border-color: var(--accent); }
.btn-small {
  padding: 6px 12px; background: var(--accent); color: #fff;
  border: none; border-radius: var(--radius); font-size: 11px; cursor: pointer;
  white-space: nowrap;
  display:flex; align-items: center;
}
.btn-small:hover { opacity: 0.9; }
.btn-small:disabled { opacity: 0.5; cursor: default; }
.template-list { max-height: 160px; overflow-y: auto; }
.template-item {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  border-radius: var(--radius); cursor: pointer; font-size: 12px;
}
.template-item:hover { background: var(--bg-hover); }
.template-item.active { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.tpl-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tpl-regions { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }
.tpl-delete {
  background: none; border: none; color: var(--text-muted); cursor: pointer;
  font-size: 14px; padding: 0 3px; border-radius: 3px; flex-shrink: 0;
}
.tpl-delete:hover { background: rgba(229, 92, 92, 0.2); color: var(--danger); }
.tpl-rename-input {
  flex: 1; background: var(--bg-primary); border: 1px solid var(--accent);
  border-radius: 3px; color: var(--text-primary); font-size: 12px; padding: 1px 4px; outline: none;
}
.empty { font-size: 11px; color: var(--text-muted); }
.btn-primary {
  width: 100%; padding: 8px 12px; background: var(--accent); color: #fff;
  border: none; border-radius: var(--radius); font-size: 12px; font-weight: 500;
  cursor: pointer; transition: opacity 0.15s;
}
.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.5; cursor: default; }
</style>
