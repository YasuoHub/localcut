<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolType } from '../types'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()

const emit = defineEmits<{
  'upload-image': [files: File[]]
  'open-matting': []
  'create-preset': [preset: PresetCropSize]
}>()

function selectPreset(preset: PresetCropSize) { emit('create-preset', preset) }

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
      <button class="matting-entry-btn" @click="emit('open-matting')">
        <span class="matting-icon">✂</span>
        <span>智能抠图</span>
      </button>
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

    <section v-if="editor.activeTool === 'rect'" class="section preset-section">
      <div class="section-title">预设尺寸</div>
      <div class="preset-list">
        <button
          v-for="preset in presetCropSizes" :key="preset.id"
          class="preset-btn btn-ghost"
          :title="preset.name"
          @click="selectPreset(preset)"
        >
          <span class="preset-name">{{ preset.name }}</span>
          <span v-if="preset.width > 0" class="preset-size">{{ preset.width }}×{{ preset.height }}</span>
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
.matting-entry-btn {
  width: 100%; display: flex; align-items: center; justify-content: center;
  gap: 6px; padding: 10px; background: linear-gradient(135deg, rgba(79,195,247,0.15), rgba(129,140,248,0.15));
  border: 1px solid rgba(79,195,247,0.3); border-radius: var(--radius);
  color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.matting-entry-btn:hover {
  background: linear-gradient(135deg, rgba(79,195,247,0.25), rgba(129,140,248,0.25));
  border-color: rgba(79,195,247,0.5);
}
.matting-icon { font-size: 16px; }
.text-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.text-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.text-item { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: var(--radius); cursor: pointer; transition: background 0.1s; font-size: 12px; flex-shrink: 0; }
.text-item:hover { background: var(--bg-hover); }
.text-item.selected { background: rgba(79, 195, 247, 0.1); outline: 1px solid rgba(79, 195, 247, 0.3); }
.text-icon { font-size: 13px; font-weight: 700; width: 18px; text-align: center; flex-shrink: 0; color: var(--accent); }
.text-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.preset-section { max-height: 260px; display: flex; flex-direction: column; }
.preset-section .section-title { flex-shrink: 0; }
.preset-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; flex: 1; }
.preset-btn {
  display: flex; flex-direction: column; align-items: flex-start;
  padding: 6px 8px; width: 100%; gap: 1px;
  text-align: left; font-size: 11px;
}
.preset-btn:hover { background: var(--bg-hover); }
.preset-name { color: var(--text-primary); }
.preset-size { font-size: 10px; color: var(--text-muted); }
</style>
