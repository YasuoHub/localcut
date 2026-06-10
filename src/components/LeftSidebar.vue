<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import type { ToolType } from '../types'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()

const emit = defineEmits<{
  'upload-image': [files: File[]]
  'open-compress': []
  'open-matting': []
  'create-grid-group': []
}>()

type IconName =
  | 'import' | 'compress' | 'matting' | 'select' | 'brush' | 'eraser' | 'wand' | 'shapes' | 'text'
  | 'grid' | 'rect' | 'roundrect' | 'circle' | 'triangle' | 'diamond' | 'star' | 'heart' | 'polygon'

const iconPaths: Record<IconName, string[]> = {
  import: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 19h14', 'M5 16v3', 'M19 16v3'],
  compress: ['M4 6h16v12H4z', 'M8 10h8', 'M10 14h4', 'M7 3v3', 'M17 3v3', 'M7 18v3', 'M17 18v3'],
  matting: ['M4.5 7.5a2.5 2.5 0 1 0 0 .1', 'M4.5 16.5a2.5 2.5 0 1 0 0 .1', 'M7 8l12 8', 'M7 16l12-8'],
  select: ['M5 3l12 11-5.5 1.2L8.5 21 5 3z'],
  brush: ['M14 4l6 6-8.5 8.5H6v-5.5L14 4z', 'M14 4l2-2 6 6-2 2', 'M6 18c-1.2 0-2 .8-2 2h7'],
  eraser: ['M4 15l8-8 8 8-5 5H9l-5-5z', 'M9 20l-3-3', 'M13 11l5 5'],
  wand: ['M14 4l6 6-10 10-6-6L14 4z', 'M4 4l1.5 1.5', 'M20 20l-1.5-1.5', 'M21 4h-2', 'M5 21v-2'],
  shapes: ['M5 7h9v7H5z', 'M16 8l4 4-4 4', 'M8 18h8'],
  text: ['M5 5h14', 'M12 5v14', 'M9 19h6'],
  grid: ['M5 5h14v14H5z', 'M5 9.7h14', 'M5 14.3h14', 'M9.7 5v14', 'M14.3 5v14'],
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
const shapeGroupRef = ref<HTMLElement | null>(null)
const shapePopoverRef = ref<HTMLElement | null>(null)
const shapePopoverStyle = ref<Record<string, string>>({ left: '78px', top: '0px', maxHeight: 'none' })
const shapePopoverOpen = ref(false)
let shapePopoverCloseTimer: number | null = null

function updateShapePopoverPosition() {
  const trigger = shapeGroupRef.value
  if (!trigger) return
  const popover = shapePopoverRef.value
  const rect = trigger.getBoundingClientRect()
  const margin = 8
  const gap = 10
  const popoverWidth = popover?.offsetWidth || 238
  const popoverHeight = popover?.scrollHeight || popover?.offsetHeight || 310
  const viewportHeight = window.innerHeight
  const left = Math.min(rect.right + gap, window.innerWidth - popoverWidth - margin)
  let top = Math.max(margin, rect.top - 8)
  let maxHeight = 'none'
  if (popoverHeight + margin * 2 > viewportHeight) {
    top = margin
    maxHeight = `${Math.max(120, viewportHeight - margin * 2)}px`
  } else if (top + popoverHeight + margin > viewportHeight) {
    top = viewportHeight - popoverHeight - margin
  }
  shapePopoverStyle.value = {
    left: `${Math.max(margin, left)}px`,
    top: `${top}px`,
    maxHeight,
  }
}

function openShapePopover() {
  if (!editor.imageLoaded) return
  if (shapePopoverCloseTimer) {
    window.clearTimeout(shapePopoverCloseTimer)
    shapePopoverCloseTimer = null
  }
  shapePopoverOpen.value = true
  updateShapePopoverPosition()
  nextTick(updateShapePopoverPosition)
}

function scheduleShapePopoverClose() {
  if (shapePopoverCloseTimer) window.clearTimeout(shapePopoverCloseTimer)
  shapePopoverCloseTimer = window.setTimeout(() => {
    shapePopoverOpen.value = false
    shapePopoverCloseTimer = null
  }, 160)
}

function selectShapeTool(tool: ToolType) {
  selectTool(tool)
  shapePopoverOpen.value = false
}

onBeforeUnmount(() => {
  if (shapePopoverCloseTimer) window.clearTimeout(shapePopoverCloseTimer)
})

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
  <aside class="sidebar" @scroll="updateShapePopoverPosition">
    <section class="action-section">
      <button class="nav-btn command-btn" title="导入图片" @click="triggerUpload">
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.import" :key="path" :d="path" />
        </svg>
        <span class="tool-label">导入</span>
      </button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none" @change="handleFileChange" />

      <button class="nav-btn compress-btn" title="图片压缩" @click="emit('open-compress')">
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.compress" :key="path" :d="path" />
        </svg>
        <span class="tool-label">压缩</span>
      </button>

      <button class="nav-btn matting-btn" title="智能抠图" @click="emit('open-matting')">
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.matting" :key="path" :d="path" />
        </svg>
        <span class="tool-label">AI抠图</span>
      </button>
    </section>

    <section class="tool-section">
      <div class="section-label"></div>

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

      <div
        ref="shapeGroupRef"
        class="shape-group"
        :class="{ 'is-open': shapePopoverOpen }"
        @mouseenter="openShapePopover"
        @mouseleave="scheduleShapePopoverClose"
        @focusin="openShapePopover"
        @focusout="scheduleShapePopoverClose"
      >
        <button
          class="nav-btn"
          :class="{ active: isShapeActive() }"
          :disabled="!editor.imageLoaded"
          :title="editor.imageLoaded ? '图形' : '图形：请先导入图片'"
          :aria-expanded="shapePopoverOpen"
          aria-haspopup="menu"
          @click="selectTool('rect')"
        >
          <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="path in iconPaths.shapes" :key="path" :d="path" />
          </svg>
          <span class="tool-label">图形</span>
        </button>
        <div
          ref="shapePopoverRef"
          class="shape-popover"
          :style="shapePopoverStyle"
          role="menu"
          aria-label="图形选择"
          @mouseenter="openShapePopover"
          @mouseleave="scheduleShapePopoverClose"
        >
          <div class="shape-popover-head">
            <span>图形</span>
            <small>选择绘制形状</small>
          </div>
          <button
            v-for="shape in shapeTools"
            :key="shape.id"
            class="shape-option"
            :class="{ active: editor.activeTool === shape.id }"
            :disabled="!editor.imageLoaded"
            :title="shape.label"
            role="menuitem"
            @click="selectShapeTool(shape.id)"
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
      <div class="section-label"></div>
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
      <button
        class="nav-btn"
        :disabled="!editor.imageLoaded"
        title="N宫格"
        @click="emit('create-grid-group')"
      >
        <svg class="tool-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path v-for="path in iconPaths.grid" :key="path" :d="path" />
        </svg>
        <span class="tool-label">N宫格</span>
      </button>
    </section>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 68px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: visible;
  background:
    linear-gradient(180deg, rgba(10, 16, 14, 0.9), transparent 38%),
    var(--bg-secondary);
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
  flex-shrink: 0;
  gap: 5px;
  padding: 6px 5px;
  border-bottom: 1px solid var(--border);
}

.section-label {
  padding: 2px 2px 1px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
}

.nav-btn {
  width: 100%;
  height: 46px;
  padding: 4px 3px 3px;
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
  background: rgba(40, 199, 111, 0.07);
  color: var(--text-primary);
  border-color: rgba(40, 199, 111, 0.2);
}

.nav-btn.active {
  background:
    linear-gradient(180deg, rgba(40, 199, 111, 0.16), rgba(40, 199, 111, 0.08));
  color: var(--accent-hover);
  border-color: var(--accent);
  box-shadow:
    inset 0 0 0 1px rgba(40, 199, 111, 0.28),
    0 0 18px rgba(40, 199, 111, 0.14);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.command-btn {
  color: var(--accent);
  border-color: rgba(40, 199, 111, 0.18);
  background:
    linear-gradient(180deg, rgba(40, 199, 111, 0.12), rgba(40, 199, 111, 0.05));
}

.matting-btn {
  color: var(--text-secondary);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.01));
  border-color: rgba(255, 255, 255, 0.045);
}

.compress-btn {
  color: var(--text-secondary);
  background:
    linear-gradient(180deg, rgba(74, 168, 255, 0.09), rgba(74, 168, 255, 0.025));
  border-color: rgba(74, 168, 255, 0.16);
}

.compress-btn:hover:not(:disabled) {
  color: #8fc6ff;
  background:
    linear-gradient(180deg, rgba(74, 168, 255, 0.14), rgba(74, 168, 255, 0.055));
  border-color: rgba(74, 168, 255, 0.34);
}

.matting-btn:hover:not(:disabled) {
  color: var(--accent-hover);
  background:
    linear-gradient(180deg, rgba(40, 199, 111, 0.12), rgba(40, 199, 111, 0.055));
  border-color: rgba(40, 199, 111, 0.28);
}

.tool-svg,
.shape-svg {
  width: 21px;
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
  width: 100%;
}

.shape-group::after {
  content: '';
  position: absolute;
  left: calc(100% - 2px);
  top: 0;
  z-index: 49;
  width: 22px;
  height: 100%;
  pointer-events: auto;
}

.shape-popover {
  position: fixed;
  z-index: 50;
  width: 238px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  padding: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 34%),
    var(--bg-secondary);
  border: 1px solid rgba(74, 72, 63, 0.92);
  border-radius: var(--radius-lg);
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.48),
    inset 0 1px 0 rgba(255, 255, 255, 0.035);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(-4px) scale(0.98);
  transform-origin: left top;
  transition:
    opacity 0.12s ease,
    transform 0.12s ease,
    visibility 0s linear 0.12s;
}

.shape-group:hover .shape-popover,
.shape-group:focus-within .shape-popover,
.shape-group.is-open .shape-popover {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateX(0) scale(1);
  transition-delay: 0s;
}

.shape-popover::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 25px;
  width: 10px;
  height: 10px;
  background: var(--bg-secondary);
  border-left: 1px solid rgba(74, 72, 63, 0.92);
  border-bottom: 1px solid rgba(74, 72, 63, 0.92);
  transform: rotate(45deg);
}

.shape-popover-head {
  grid-column: 1 / -1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px 2px;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.shape-popover-head small {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 500;
}

.shape-option {
  height: 56px;
  padding: 7px 7px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent),
    var(--bg-primary);
  border: 1px solid rgba(52, 51, 45, 0.96);
  color: var(--text-secondary);
  border-radius: var(--radius);
  transition:
    background 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease,
    transform 0.14s ease;
}

.shape-option:hover:not(:disabled) {
  border-color: rgba(40, 199, 111, 0.58);
  color: var(--text-primary);
  background:
    linear-gradient(180deg, rgba(40, 199, 111, 0.11), rgba(40, 199, 111, 0.045));
  transform: translateY(-1px);
}

.shape-option.active {
  color: var(--accent-hover);
  border-color: var(--accent);
  background:
    linear-gradient(180deg, rgba(40, 199, 111, 0.18), rgba(40, 199, 111, 0.08));
  box-shadow:
    inset 0 0 0 1px rgba(40, 199, 111, 0.22),
    0 8px 20px rgba(40, 199, 111, 0.08);
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
