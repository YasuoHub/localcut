<script setup lang="ts">
import { ref } from 'vue'
import type { ToolType } from '../types'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()

const emit = defineEmits<{
  'upload-image': [files: File[]]
  'open-matting': []
}>()

type IconName =
  | 'import' | 'matting' | 'select' | 'brush' | 'eraser' | 'wand' | 'shapes' | 'text'
  | 'rect' | 'roundrect' | 'circle' | 'triangle' | 'diamond' | 'star' | 'heart' | 'polygon'

const iconPaths: Record<IconName, string[]> = {
  import: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 19h14', 'M5 16v3', 'M19 16v3'],
  matting: ['M4.5 7.5a2.5 2.5 0 1 0 0 .1', 'M4.5 16.5a2.5 2.5 0 1 0 0 .1', 'M7 8l12 8', 'M7 16l12-8'],
  select: ['M5 3l12 11-5.5 1.2L8.5 21 5 3z'],
  brush: ['M14 4l6 6-8.5 8.5H6v-5.5L14 4z', 'M14 4l2-2 6 6-2 2', 'M6 18c-1.2 0-2 .8-2 2h7'],
  eraser: ['M4 15l8-8 8 8-5 5H9l-5-5z', 'M9 20l-3-3', 'M13 11l5 5'],
  wand: ['M14 4l6 6-10 10-6-6L14 4z', 'M4 4l1.5 1.5', 'M20 20l-1.5-1.5', 'M21 4h-2', 'M5 21v-2'],
  shapes: ['M5 7h9v7H5z', 'M16 8l4 4-4 4', 'M8 18h8'],
  text: ['M5 5h14', 'M12 5v14', 'M9 19h6'],
  rect: ['M5 7h14v10H5z'],
  roundrect: ['M8 7h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z'],
  circle: ['M12 6a6 6 0 1 0 0 12a6 6 0 0 0 0-12z'],
  triangle: ['M12 5l8 14H4L12 5z'],
  diamond: ['M12 4l8 8-8 8-8-8 8-8z'],
  star: ['M12 4l2.2 5 5.3.5-4 3.6 1.2 5.2L12 16l-4.7 2.8 1.2-5.2-4-3.6 5.3-.5L12 4z'],
  heart: ['M12 19s-7-4.4-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 4.6-7 9-7 9z'],
  polygon: ['M7 6h7l5 5-2 7H8l-4-6 3-6z'],
}

const directTools: { id: ToolType; label: string; icon: IconName }[] = [
  { id: 'select', label: '选择', icon: 'select' },
  { id: 'brush', label: '画笔', icon: 'brush' },
  { id: 'eraser', label: '橡皮擦', icon: 'eraser' },
  { id: 'magic-wand', label: '魔棒', icon: 'wand' },
]

const shapeTools: { id: ToolType; label: string; icon: IconName }[] = [
  { id: 'rect', label: '矩形', icon: 'rect' },
  { id: 'roundrect', label: '圆角', icon: 'roundrect' },
  { id: 'circle', label: '圆形', icon: 'circle' },
  { id: 'triangle', label: '三角形', icon: 'triangle' },
  { id: 'diamond', label: '菱形', icon: 'diamond' },
  { id: 'star', label: '星形', icon: 'star' },
  { id: 'heart', label: '心形', icon: 'heart' },
  { id: 'custom', label: '多边形', icon: 'polygon' },
]

function selectTool(tool: ToolType) { editor.setTool(tool) }
function isShapeActive() { return shapeTools.some(tool => tool.id === editor.activeTool) }

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
  <aside class="sidebar">
    <section class="action-section">
      <button class="nav-btn command-btn" title="导入图片" @click="triggerUpload">
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.import" :key="path" :d="path" />
        </svg>
        <span class="tool-label">导入</span>
      </button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none" @change="handleFileChange" />

      <button class="nav-btn matting-btn" title="智能抠图" @click="emit('open-matting')">
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.matting" :key="path" :d="path" />
        </svg>
        <span class="tool-label">抠图</span>
      </button>
    </section>

    <section class="tool-section">
      <div class="section-label">工具</div>

      <button
        v-for="tool in directTools" :key="tool.id"
        class="nav-btn"
        :class="{ active: editor.activeTool === tool.id }"
        :disabled="!editor.imageLoaded"
        :title="editor.imageLoaded ? tool.label : `${tool.label}：请先导入图片`"
        @click="selectTool(tool.id)"
      >
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths[tool.icon]" :key="path" :d="path" />
        </svg>
        <span class="tool-label">{{ tool.label }}</span>
      </button>

      <div class="shape-group">
        <button
          class="nav-btn"
          :class="{ active: isShapeActive() }"
          :disabled="!editor.imageLoaded"
          :title="editor.imageLoaded ? '图形' : '图形：请先导入图片'"
          @click="selectTool('rect')"
        >
          <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="path in iconPaths.shapes" :key="path" :d="path" />
          </svg>
          <span class="tool-label">图形</span>
        </button>
        <div class="shape-popover">
          <button
            v-for="shape in shapeTools"
            :key="shape.id"
            class="shape-option"
            :class="{ active: editor.activeTool === shape.id }"
            :disabled="!editor.imageLoaded"
            :title="shape.label"
            @click="selectTool(shape.id)"
          >
            <svg class="shape-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path v-for="path in iconPaths[shape.icon]" :key="path" :d="path" />
            </svg>
            <small>{{ shape.label }}</small>
          </button>
        </div>
      </div>
    </section>

    <section class="tool-section">
      <div class="section-label">插入</div>
      <button
        class="nav-btn"
        :class="{ active: editor.activeTool === 'text' }"
        :disabled="!editor.imageLoaded"
        :title="editor.imageLoaded ? '文字' : '文字：请先导入图片'"
        @click="selectTool('text')"
      >
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.text" :key="path" :d="path" />
        </svg>
        <span class="tool-label">文字</span>
      </button>
    </section>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 82px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.action-section,
.tool-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px;
  border-bottom: 1px solid var(--border);
}

.section-label {
  padding: 3px 3px 1px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
}

.nav-btn {
  width: 100%;
  height: 48px;
  padding: 5px 4px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--text-secondary);
  text-align: center;
}

.nav-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: transparent;
}

.nav-btn.active {
  background: rgba(74, 168, 255, 0.09);
  color: #9dccff;
  border-color: transparent;
  box-shadow: inset 3px 0 0 rgba(74, 168, 255, 0.78);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.command-btn {
  color: var(--accent);
  border-color: transparent;
  background: rgba(40, 199, 111, 0.07);
}

.matting-btn {
  color: var(--text-secondary);
}

.tool-svg,
.shape-svg {
  width: 22px;
  height: 20px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tool-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  line-height: 1.1;
}

.shape-group {
  position: relative;
}

.shape-popover {
  position: absolute;
  left: calc(100% + 8px);
  top: 0;
  z-index: 50;
  width: 226px;
  display: none;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
}

.shape-group:hover .shape-popover,
.shape-group:focus-within .shape-popover {
  display: grid;
}

.shape-option {
  height: 54px;
  padding: 6px 7px 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: var(--radius);
}

.shape-option:hover:not(:disabled) {
  border-color: var(--selection);
  color: var(--text-primary);
}

.shape-option.active {
  color: var(--selection);
  border-color: rgba(74, 168, 255, 0.45);
  background: rgba(74, 168, 255, 0.1);
}

.shape-option small {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.1;
}
</style>
