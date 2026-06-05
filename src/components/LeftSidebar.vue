<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolType } from '../types'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()

const emit = defineEmits<{ 'upload-image': [files: File[]] }>()

const tools: { id: ToolType; label: string; icon: string }[] = [
  { id: 'select', label: '选择', icon: '⊟' },
  { id: 'brush', label: '画笔', icon: '🖌' },
  { id: 'eraser', label: '橡皮', icon: '◼' },
  { id: 'rect', label: '矩形', icon: '▭' },
  { id: 'roundrect', label: '圆角矩形', icon: '▢' },
  { id: 'circle', label: '圆形', icon: '○' },
  { id: 'triangle', label: '三角形', icon: '△' },
  { id: 'diamond', label: '菱形', icon: '◇' },
  { id: 'star', label: '星形', icon: '☆' },
  { id: 'heart', label: '心形', icon: '♡' },
  { id: 'custom', label: '多边形', icon: '⬠' },
  { id: 'magic-wand', label: '魔棒', icon: '🪄' },
  { id: 'text', label: '文字', icon: 'T' },
]

function selectTool(tool: ToolType) { editor.setTool(tool) }
function selectText(id: string) { editor.selectText(id) }

const sortedTexts = computed(() => [...editor.textAnnotations].reverse())

const fileInput = ref<HTMLInputElement | null>(null)
function triggerUpload() { fileInput.value?.click() }
function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  emit('upload-image', Array.from(files))
  input.value = ''
}
</script>

<template>
  <aside class="sidebar scrollbar">
    <section class="section">
      <button class="btn-ghost upload-btn" @click="triggerUpload">上传图片</button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none" @change="handleFileChange" />
      <span v-if="editor.imageLoaded" class="status-ok">已就绪</span>
    </section>

    <section class="section">
      <div class="section-title">工具</div>
      <div class="tool-grid">
        <button
          v-for="tool in tools" :key="tool.id"
          class="tool-btn btn-ghost" :class="{ active: editor.activeTool === tool.id }"
          :title="tool.label" @click="selectTool(tool.id)"
        >
          <span class="tool-icon" :class="{ 'text-tool-icon': tool.id === 'text' }">{{ tool.icon }}</span>
          <span class="tool-label">{{ tool.label }}</span>
        </button>
      </div>
    </section>

    <section class="section text-section" v-if="editor.textAnnotations.length > 0">
      <div class="section-title">文字 <span class="count">{{ editor.textAnnotations.length }}</span></div>
      <div class="text-list scrollbar">
        <div
          v-for="t in sortedTexts" :key="t.id"
          class="text-item" :class="{ selected: t.id === editor.selectedTextId }"
          @click="selectText(t.id)"
        >
          <span class="text-icon">T</span>
          <span class="text-name">{{ t.text.slice(0, 14) }}{{ t.text.length > 14 ? '...' : '' }}</span>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.sidebar { width: 200px; background: var(--bg-secondary); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; flex-shrink: 0; }
.section { padding: 10px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.section-title { font-size: 11px; font-weight: 600; letter-spacing: 0.8px; color: var(--text-muted); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
.count { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 8px; font-size: 10px; color: var(--text-secondary); }
.upload-btn { width: 100%; }
.status-ok { display: block; font-size: 10px; color: #66bb6a; margin-top: 4px; text-align: center; }
.tool-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
.tool-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 4px; font-size: 10px; }
.tool-icon { font-size: 20px; text-align: center; }
.text-tool-icon { font-weight: 700; font-size: 18px; }
.tool-label { font-size: 10px; white-space: nowrap; }
.text-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.text-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.text-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: var(--radius); cursor: pointer; transition: background 0.1s; font-size: 12px; flex-shrink: 0; }
.text-item:hover { background: var(--bg-hover); }
.text-item.selected { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.text-icon { font-size: 13px; font-weight: 700; width: 18px; text-align: center; flex-shrink: 0; color: var(--accent); }
.text-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
</style>
