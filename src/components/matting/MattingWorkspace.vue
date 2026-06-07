<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useMattingStore } from '../../stores/matting'
import { useEditorStore } from '../../stores/editor'
import { useMattingInference } from '../../composables/useMattingInference'
import MattingCanvas from './MattingCanvas.vue'
import MattingToolbar from './MattingToolbar.vue'
import MattingControlPanel from './MattingControlPanel.vue'
import { compositeResult, upscaleMask } from '../../utils/mattingImageUtils'
import type { MattingModelType } from '../../types'

const store = useMattingStore()
const editor = useEditorStore()
const { loadModel, runInference, cancel } = useMattingInference()

const show = ref(false)
const canvasComponent = ref<InstanceType<typeof MattingCanvas> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// 无需提前检测 WebGPU，FP16 始终可选。
// DXC/驱动层面的 WebGPU 失败 JavaScript 无法可靠探知。
// 如果 FP16 加载失败，Worker 会返回明确错误消息引导用户切 INT8。
const models = [
  { id: 'modnet' as MattingModelType, label: 'MODNet (INT8)', desc: '快速 (~6.6MB, <1s)' },
  { id: 'modnet-fp16' as MattingModelType, label: 'MODNet (FP16)', desc: '精细 (~13MB, 需 WebGPU)' },
]

const canRunInference = computed(() =>
  store.sourceImage !== null && !store.isProcessing,
)

const showEditingTools = computed(() =>
  store.stage === 'mask_editing' || store.stage === 'done',
)

function open() {
  store.reset()
  show.value = true
}

function close() {
  cancel()
  store.reset()
  show.value = false
}

function triggerUpload() {
  fileInput.value?.click()
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  const file = files[0]
  const reader = new FileReader()
  reader.onload = (ev) => {
    const img = new Image()
    img.onload = () => {
      store.setSourceImage(img, 'upload')
      requestAnimationFrame(() => canvasComponent.value?.render())
    }
    img.onerror = () => {
      store.lastError = '图片加载失败，请重试'
    }
    img.src = ev.target?.result as string
  }
  reader.onerror = () => {
    store.lastError = '文件读取失败'
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function useCurrentLayer(useEdited = false) {
  if (!editor.activeLayer) return
  const layer = editor.activeLayer
  let srcImg: HTMLImageElement
  if (useEdited && layer.workingCanvas) {
    // Use edited canvas as source
    srcImg = new Image()
    srcImg.src = layer.workingCanvas.toDataURL('image/png')
    srcImg.onload = () => {
      store.setSourceImage(srcImg, 'current-layer')
      requestAnimationFrame(() => canvasComponent.value?.render())
    }
    return
  }
  srcImg = layer.image
  store.setSourceImage(srcImg, 'current-layer')
  requestAnimationFrame(() => canvasComponent.value?.render())
}

// Keyboard shortcuts
function handleKeyDown(e: KeyboardEvent) {
  if (!show.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (store.stage !== 'mask_editing' && store.stage !== 'done') return
  if (e.key === '[' || e.key === ']') {
    e.preventDefault()
    const delta = e.key === '[' ? -4 : 4
    store.brush.size = Math.max(2, Math.min(200, store.brush.size + delta))
  }
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault()
    e.stopPropagation()
    canvasComponent.value?.undoMaskEdit()
  }
  if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault()
    e.stopPropagation()
    canvasComponent.value?.redoMaskEdit()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyDown))

async function handleRunInference() {
  if (!canRunInference.value) return
  try {
    await loadModel(store.selectedModel)
    if (store.stage === 'ready' && store.sourceImage) {
      await runInference()
    }
  } catch (err: any) {
    store.lastError = err.message || '推理失败'
  }
}

function handleExportPng() {
  const srcImg = store.sourceImage
  const mask = store.maskData
  const fullMask = store.fullMaskData
  const edited = store.maskEdited
  if (!srcImg || !mask) return
  editor.isHeavyProcessing = true

  requestAnimationFrame(() => {
    try {
      let resultCanvas: HTMLCanvasElement

      if (fullMask && !edited) {
        resultCanvas = compositeResult(srcImg, fullMask.data, fullMask.width, fullMask.height, Infinity)
      } else if (fullMask) {
        const { width: fullW, height: fullH } = fullMask
        const upscaledMask = upscaleMask(mask.data, mask.width, mask.height, fullW, fullH)
        resultCanvas = compositeResult(srcImg, upscaledMask, fullW, fullH, Infinity)
      } else {
        resultCanvas = compositeResult(srcImg, mask.data, mask.width, mask.height, Infinity)
      }

      resultCanvas.toBlob((blob) => {
        if (!blob) { editor.isHeavyProcessing = false; return }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `matting_${Date.now()}.png`
        a.click()
        URL.revokeObjectURL(url)
        editor.isHeavyProcessing = false
      }, 'image/png')
    } catch (err) {
      editor.isHeavyProcessing = false
    }
  })
}

function handleSendToCanvas() {
  const srcImg = store.sourceImage
  const mask = store.maskData
  const fullMask = store.fullMaskData
  const edited = store.maskEdited
  if (!srcImg || !mask) return
  editor.isHeavyProcessing = true

  requestAnimationFrame(() => {
    try {
      let resultCanvas: HTMLCanvasElement

      if (fullMask && !edited) {
        resultCanvas = compositeResult(srcImg, fullMask.data, fullMask.width, fullMask.height, Infinity)
      } else if (fullMask) {
        const { width: fullW, height: fullH } = fullMask
        const upscaledMask = upscaleMask(mask.data, mask.width, mask.height, fullW, fullH)
        resultCanvas = compositeResult(srcImg, upscaledMask, fullW, fullH, Infinity)
      } else {
        resultCanvas = compositeResult(srcImg, mask.data, mask.width, mask.height, Infinity)
      }

      const img = new Image()
      img.onload = () => {
        editor.addLayer(img, '抠图结果')
        editor.invalidateCanvas()
        editor.isHeavyProcessing = false
        close()
      }
      img.src = resultCanvas.toDataURL('image/png')
    } catch (err) {
      editor.isHeavyProcessing = false
    }
  })
}

function handleReset() {
  store.reset()
  canvasComponent.value?.render()
}

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="matting-overlay">
      <div class="matting-workspace">
        <!-- Header -->
        <div class="matting-header">
          <span class="matting-title">智能抠图</span>
          <div class="matting-header-actions">
            <span class="matting-model-tag" v-if="store.stage !== 'idle'">
              {{ store.selectedModel === 'modnet' ? 'MODNet INT8' : 'MODNet FP16' }}
            </span>
            <button class="matting-close" @click="close">&times;</button>
          </div>
        </div>

        <!-- Body -->
        <div class="matting-body">
          <!-- Left panel -->
          <div class="matting-left">
            <!-- Image input section (always visible) -->
            <div class="matting-section">
              <div class="matting-section-title">图片</div>
              <button class="matting-btn" @click="triggerUpload">
                📁 上传图片
              </button>
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style="display:none"
                @change="handleFileChange"
              />
              <button
                class="matting-btn"
                :disabled="!editor.activeLayer"
                @click="useCurrentLayer(false)"
                title="导入活动图层的原始图片"
              >
                📋 使用当前图层（原图）
              </button>
              <button
                class="matting-btn"
                :disabled="!editor.activeLayer || !editor.activeLayer?.workingCanvas"
                @click="useCurrentLayer(true)"
                title="导入活动图层编辑后的画面（含画笔/橡皮修改）"
              >
                ✏️ 使用当前图层（编辑后）
              </button>
            </div>

            <!-- Model selector (always visible when source image loaded) -->
            <div class="matting-section" v-if="store.sourceImage">
              <div class="matting-section-title">模型</div>
              <select
                class="matting-select"
                v-model="store.selectedModel"
                :disabled="store.isProcessing"
              >
                <option v-for="m in models" :key="m.id" :value="m.id">
                  {{ m.label }} - {{ m.desc }}
                </option>
              </select>
            </div>

            <!-- Run inference (before editing) -->
            <div class="matting-section" v-if="!showEditingTools && store.sourceImage">
              <button
                class="matting-btn matting-btn-primary"
                :disabled="!canRunInference"
                @click="handleRunInference"
              >
                <span v-if="store.isProcessing">⏳ {{ store.progress.message }}</span>
                <span v-else>🔮 一键抠图</span>
              </button>
              <button
                v-if="store.isProcessing"
                class="matting-btn matting-btn-cancel"
                @click="cancel"
              >
                取消
              </button>
            </div>

            <!-- Re-inference + quick actions (after editing) -->
            <template v-if="showEditingTools">
              <div class="matting-section">
                <div class="matting-section-title">推理</div>
                <button
                  class="matting-btn matting-btn-primary"
                  :disabled="store.isProcessing"
                  @click="handleRunInference"
                  :title="`使用 ${store.selectedModel === 'modnet' ? 'MODNet INT8' : 'MODNet FP16'} 重新推理`"
                >
                  🔄 重新推理
                  <span class="re-infer-model-tag">{{ store.selectedModel === 'modnet' ? 'INT8' : 'FP16' }}</span>
                </button>
                <button
                  v-if="store.isProcessing"
                  class="matting-btn matting-btn-cancel"
                  @click="cancel"
                >
                  取消
                </button>
              </div>

              <div class="matting-section">
                <div class="matting-section-title">快捷操作</div>
                <button class="matting-btn matting-btn-ghost" @click="handleReset">重置</button>
                <button class="matting-btn matting-btn-ghost" @click="close">关闭</button>
              </div>
            </template>

            <!-- Quick actions (before editing) -->
            <div class="matting-section" v-if="!showEditingTools && store.sourceImage">
              <div class="matting-section-title">快捷操作</div>
              <button class="matting-btn matting-btn-ghost" @click="handleReset">重置</button>
              <button class="matting-btn matting-btn-ghost" @click="close">关闭</button>
            </div>
          </div>

          <!-- Center canvas -->
          <div class="matting-center">
            <MattingCanvas ref="canvasComponent" />
            <div v-if="editor.isHeavyProcessing" class="matting-loading-overlay">
              <span class="matting-loading-text">处理中...</span>
            </div>
          </div>

          <!-- Right panel -->
          <div class="matting-right" v-if="store.sourceImage">
            <!-- Status -->
            <div class="matting-section">
              <div class="matting-section-title">状态</div>
              <div class="matting-status">
                <template v-if="store.stage === 'ready'">模型就绪 · 可以开始抠图</template>
                <template v-else-if="store.stage === 'mask_editing'">
                  抠图完成 · 可手动精修
                  <span v-if="store.inferenceTime" class="info-detail">
                    · {{ store.inferenceTime }}ms · {{ store.backend?.toUpperCase() }}
                  </span>
                </template>
                <template v-else-if="store.stage === 'done'">已完成</template>
                <template v-else-if="!store.isProcessing">准备中...</template>
              </div>
              <div v-if="store.sourceImage" class="current-model-info">
                当前模型：{{ store.selectedModel === 'modnet' ? 'MODNet INT8' : 'MODNet FP16' }}
              </div>
              <div v-if="store.lastError" class="matting-error">
                {{ store.lastError }}
                <button class="matting-error-close" @click="store.lastError = ''">&times;</button>
              </div>
            </div>

            <!-- Progress bar -->
            <div class="matting-section" v-if="store.isProcessing">
              <div class="progress-bar-wrap">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: store.progress.percent + '%' }" />
                </div>
                <span class="progress-label">{{ store.progress.percent }}%</span>
              </div>
            </div>

            <!-- Brush toolbar (after editing starts) -->
            <MattingToolbar v-if="showEditingTools" />

            <!-- Edge settings + undo (after editing starts) -->
            <MattingControlPanel
              v-if="showEditingTools"
              @undo="canvasComponent?.undoMaskEdit()"
            />

            <!-- Export actions -->
            <div class="matting-section matting-export-section" v-if="store.resultCanvas">
              <button class="matting-btn" @click="handleExportPng">
                💾 导出透明 PNG
              </button>
              <button class="matting-btn matting-btn-accent" @click="handleSendToCanvas">
                📤 发送到画布
              </button>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="matting-footer">
          <span v-if="store.sourceImage">
            图片 {{ store.sourceImage.naturalWidth }}×{{ store.sourceImage.naturalHeight }}
            <template v-if="store.backend"> · {{ store.backend.toUpperCase() }}</template>
          </span>
          <span v-else></span>
          <span class="shortcuts-hint">
            <template v-if="showEditingTools">画笔 [ ] 调整大小 · Ctrl+Z 撤销 · Ctrl+Y 重做 · </template>
            Esc 关闭
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.matting-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
}
.matting-workspace {
  width: 96vw; max-width: 1400px; height: 92vh;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: 0 12px 48px rgba(0,0,0,0.6);
  display: flex; flex-direction: column; overflow: hidden;
}

/* Header */
.matting-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; border-bottom: 1px solid var(--border);
  flex-shrink: 0; height: 48px;
}
.matting-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.matting-header-actions { display: flex; align-items: center; gap: 12px; }
.matting-model-tag {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  background: rgba(79,195,247,0.15); color: var(--accent);
}
.matting-close {
  background: none; border: none; color: var(--text-muted);
  font-size: 24px; cursor: pointer; line-height: 1; padding: 0 4px;
}
.matting-close:hover { color: var(--text-primary); }

/* Body */
.matting-body { flex: 1; display: flex; overflow: hidden; min-height: 0; }

/* Left panel */
.matting-left {
  width: 200px; border-right: 1px solid var(--border);
  padding: 12px; display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto; flex-shrink: 0;
}
.matting-section { display: flex; flex-direction: column; gap: 6px; }
.matting-section-title {
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  color: var(--text-muted);
}
.matting-btn {
  padding: 8px 12px; background: var(--bg-primary); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 12px; cursor: pointer; text-align: left;
  transition: background 0.15s, border-color 0.15s;
}
.matting-btn:hover:not(:disabled) { border-color: var(--text-muted); }
.matting-btn:disabled { opacity: 0.4; cursor: default; }
.matting-btn-primary {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.matting-btn-primary:hover:not(:disabled) { opacity: 0.9; }
.matting-btn-cancel {
  color: #ef5350; border-color: rgba(239,83,80,0.3);
}
.matting-btn-ghost {
  background: transparent; border: none; padding: 6px 12px;
  color: var(--text-secondary);
}
.matting-btn-ghost:hover:not(:disabled) { color: var(--text-primary); }
.matting-select {
  padding: 7px 8px; background: var(--bg-primary); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 12px; cursor: pointer;
}

.re-infer-model-tag {
  font-size: 10px; padding: 1px 5px; border-radius: 3px;
  background: rgba(255,255,255,0.2); margin-left: 4px;
}
.matting-btn-accent {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.matting-btn-accent:hover:not(:disabled) { opacity: 0.9; }

/* Center */
.matting-center {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
  position: relative;
}
.matting-loading-overlay {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); pointer-events: none;
}
.matting-loading-text {
  padding: 12px 24px; background: rgba(0,0,0,0.75);
  border-radius: var(--radius); color: var(--accent); font-size: 14px;
}

/* Right panel */
.matting-right {
  width: 220px; border-left: 1px solid var(--border);
  padding: 12px; display: flex; flex-direction: column; gap: 12px;
  overflow-y: auto; flex-shrink: 0;
}
.matting-export-section { margin-top: auto; }
.matting-status { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.current-model-info {
  font-size: 10px; color: var(--text-muted);
  padding: 3px 8px; background: rgba(79,195,247,0.08);
  border-radius: var(--radius); margin-top: 2px;
}
.info-detail { color: var(--text-muted); font-size: 11px; }

.progress-bar-wrap { display: flex; align-items: center; gap: 8px; }
.progress-bar {
  flex: 1; height: 4px; background: var(--bg-primary);
  border-radius: 2px; overflow: hidden;
}
.progress-fill {
  height: 100%; background: var(--accent); border-radius: 2px;
  transition: width 0.3s ease;
}
.progress-label { font-size: 11px; color: var(--text-muted); min-width: 36px; text-align: right; }

/* Footer */
.matting-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 16px; border-top: 1px solid var(--border);
  font-size: 11px; color: var(--text-muted); flex-shrink: 0; height: 28px;
}
.shortcuts-hint { color: var(--text-muted); font-size: 10px; }

.matting-error {
  margin-top: 6px; padding: 6px 10px;
  background: rgba(239,83,80,0.12); border: 1px solid rgba(239,83,80,0.3);
  border-radius: var(--radius); font-size: 11px; color: #ef5350;
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 8px; word-break: break-all;
}
.matting-error-close {
  background: none; border: none; color: #ef5350;
  font-size: 16px; cursor: pointer; padding: 0; line-height: 1;
  flex-shrink: 0;
}
</style>
