<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useExportStore } from '../../stores/export'
import { useEditorStore } from '../../stores/editor'
import { previewFilenames, validateFilenamePattern, makeFilenameContext } from '../../composables/useFilenamePattern'

const exp = useExportStore()
const editor = useEditorStore()

const variableDefs = [
  { key: 'imageName', label: '图片名' },
  { key: 'regionName', label: '区域名' },
  { key: 'index', label: '序号' },
  { key: 'index:3', label: '序号(3位)' },
  { key: 'width', label: '宽' },
  { key: 'height', label: '高' },
  { key: 'format', label: '格式' },
  { key: 'date', label: '日期' },
]

const pattern = ref(exp.filenamePattern)
watch(() => exp.filenamePattern, v => pattern.value = v)

function onPatternBlur() {
  const trimmed = pattern.value.trim()
  if (!trimmed) {
    pattern.value = '{imageName}_{regionName}'
  }
  exp.filenamePattern = pattern.value.trim() || '{imageName}_{regionName}'
}

function insertVariable(key: string) {
  pattern.value += `{${key}}`
}

const validation = computed(() => validateFilenamePattern(pattern.value))

const imageName = computed(() => {
  const al = editor.activeLayer
  if (!al) return 'image'
  // strip extension
  const dot = al.name.lastIndexOf('.')
  return dot > -1 ? al.name.slice(0, dot) : al.name
})

const previews = computed(() => {
  const ctxs = editor.regions.map((r, i) =>
    makeFilenameContext(imageName.value, r.name, i + 1, Math.round(r.width), Math.round(r.height), 'png'),
  )
  return previewFilenames(pattern.value, ctxs.length > 0 ? ctxs : [
    makeFilenameContext('demo', 'main', 1, 800, 800, 'png'),
    makeFilenameContext('demo', 'detail', 2, 800, 800, 'png'),
    makeFilenameContext('demo', 'badge', 3, 800, 800, 'png'),
  ], 'png')
})
</script>

<template>
  <section class="section">
    <div class="section-title">文件命名</div>
    <div class="field">
      <label>命名规则</label>
      <input
        type="text"
        v-model="pattern"
        @blur="onPatternBlur"
        @keyup.enter="onPatternBlur"
        class="text-input"
        placeholder="{imageName}_{regionName}_{index:3}"
      />
    </div>
    <div class="field">
      <label class="checkbox-label">
        <input type="checkbox" v-model="exp.singleUseFilenamePattern" />
        单张生效
      </label>
    </div>
    <div v-if="validation.unknownKeys.length" class="field warn">
      未知变量: {{ validation.unknownKeys.join(', ') }}
    </div>
    <div class="variables">
      <button
        v-for="v in variableDefs" :key="v.key"
        class="var-btn"
        @click="insertVariable(v.key)"
        :title="`插入 {${v.key}}`"
      >{{ v.label }}</button>
    </div>
    <div class="preview-box" v-if="previews.length > 0">
      <div class="preview-label">预览 (前3项)</div>
      <div v-for="(p, i) in previews.slice(0, 3)" :key="i" class="preview-name">{{ p }}</div>
      <div v-if="previews.length > 3" class="preview-more">... 共 {{ previews.length }} 项</div>
    </div>
  </section>
</template>

<style scoped>
.section { padding: 14px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 12px; }
.field { margin-bottom: 10px; }
.field label { display: block; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; }
.checkbox-label { display: flex !important; align-items: center; gap: 6px; cursor: pointer; }
.checkbox-label input { accent-color: var(--accent); }
.text-input {
  width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 6px 8px; color: var(--text-primary);
  font-size: 12px; outline: none; box-sizing: border-box;
}
.text-input:focus { border-color: var(--accent); }
.variables { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.var-btn {
  background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 3px; padding: 2px 8px; font-size: 10px; color: var(--text-secondary);
  cursor: pointer;
}
.var-btn:hover { border-color: var(--accent); color: var(--accent); }
.preview-box {
  background: var(--bg-primary); border-radius: var(--radius); padding: 8px;
  max-height: 100px; overflow-y: auto;
}
.preview-label { font-size: 10px; color: var(--text-muted); margin-bottom: 4px; }
.preview-name { font-size: 11px; color: var(--text-primary); padding: 1px 0; font-family: monospace; }
.preview-more { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.warn { color: #e5a400; font-size: 11px; }
</style>
