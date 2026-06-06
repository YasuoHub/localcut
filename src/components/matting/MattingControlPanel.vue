<script setup lang="ts">
import { useMattingStore } from '../../stores/matting'

const store = useMattingStore()

const emit = defineEmits<{
  'export-png': []
  'send-to-canvas': []
  'run-inference': []
  'cancel': []
  'undo': []
}>()
</script>

<template>
  <div class="matting-control-panel">
    <!-- Edge settings -->
    <div class="matting-section">
      <div class="matting-section-title">边缘精修</div>

      <div class="slider-group">
        <label class="slider-label">
          羽化 <span class="val">{{ store.edgeSettings.feather }}px</span>
        </label>
        <input
          type="range" min="0" max="50"
          v-model.number="store.edgeSettings.feather"
          class="slider"
        />
      </div>

      <div class="slider-group">
        <label class="slider-label">
          扩展 <span class="val">{{ store.edgeSettings.expand }}px</span>
        </label>
        <input
          type="range" min="0" max="30"
          v-model.number="store.edgeSettings.expand"
          class="slider"
        />
      </div>

      <div class="slider-group">
        <label class="slider-label">
          收缩 <span class="val">{{ store.edgeSettings.contract }}px</span>
        </label>
        <input
          type="range" min="0" max="30"
          v-model.number="store.edgeSettings.contract"
          class="slider"
        />
      </div>
    </div>

    <!-- Actions -->
    <div class="matting-section">
      <div class="matting-section-title">操作</div>

      <div class="action-list">
        <button
          class="action-btn"
          :disabled="store.isProcessing"
          @click="emit('undo')"
        >
          ↩ 撤销编辑
        </button>
        <button
          class="action-btn"
          :disabled="store.isProcessing"
          @click="emit('run-inference')"
        >
          🔄 重新推理
        </button>
        <button class="action-btn" @click="emit('export-png')">
          💾 导出透明 PNG
        </button>
        <button class="action-btn action-btn-accent" @click="emit('send-to-canvas')">
          📤 发送到画布
        </button>
      </div>
    </div>

    <!-- Progress during processing -->
    <div class="matting-section" v-if="store.isProcessing">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: store.progress.percent + '%' }" />
      </div>
      <div class="progress-text">{{ store.progress.message }}</div>
      <button class="action-btn cancel-btn" @click="emit('cancel')">取消</button>
    </div>

    <!-- Inference time -->
    <div class="matting-section" v-if="store.inferenceTime > 0 && !store.isProcessing">
      <div class="info-text">
        推理用时 {{ store.inferenceTime }}ms
        <span v-if="store.backend"> | {{ store.backend.toUpperCase() }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.matting-control-panel {
  display: flex; flex-direction: column; gap: 16px;
}
.matting-section {
  display: flex; flex-direction: column; gap: 8px;
}
.matting-section-title {
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  color: var(--text-muted);
}

.slider-group {
  display: flex; flex-direction: column; gap: 4px;
}
.slider-label {
  font-size: 11px; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: space-between;
}
.val { color: var(--accent); font-weight: 500; }

.slider {
  width: 100%; height: 4px; -webkit-appearance: none;
  background: var(--bg-primary); border-radius: 2px; outline: none; cursor: pointer;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: var(--accent); cursor: pointer;
}

.action-list {
  display: flex; flex-direction: column; gap: 5px;
}
.action-btn {
  padding: 8px 12px; background: var(--bg-primary); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 12px; cursor: pointer; text-align: left;
  transition: all 0.15s;
}
.action-btn:hover:not(:disabled) { border-color: var(--text-muted); }
.action-btn:disabled { opacity: 0.4; cursor: default; }
.action-btn-accent {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.action-btn-accent:hover:not(:disabled) { opacity: 0.9; }
.cancel-btn { color: #ef5350; border-color: rgba(239,83,80,0.3); }

.progress-bar {
  height: 4px; background: var(--bg-primary); border-radius: 2px; overflow: hidden;
}
.progress-fill {
  height: 100%; background: var(--accent); border-radius: 2px;
  transition: width 0.3s ease;
}
.progress-text { font-size: 11px; color: var(--text-secondary); }
.info-text { font-size: 11px; color: var(--text-muted); }
</style>
