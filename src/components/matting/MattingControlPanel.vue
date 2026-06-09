<script setup lang="ts">
import { useMattingStore } from '../../stores/matting'

const store = useMattingStore()

const emit = defineEmits<{
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
          <span class="label-with-tip">
            羽化
            <span class="tip-icon" title="对边缘进行高斯模糊，让抠图边缘过渡更加自然柔和，避免生硬的锯齿感">?</span>
          </span>
          <span class="numeric-value">
            <input type="number" min="0" max="50" v-model.number="store.edgeSettings.feather" />
            <span>px</span>
          </span>
        </label>
        <input
          type="range" min="0" max="50"
          v-model.number="store.edgeSettings.feather"
          class="slider"
        />
      </div>

      <div class="slider-group">
        <label class="slider-label">
          <span class="label-with-tip">
            扩展
            <span class="tip-icon" title="向外膨胀遮罩区域，扩大保留范围。可用于恢复被误删的边缘区域">?</span>
          </span>
          <span class="numeric-value">
            <input type="number" min="0" max="30" v-model.number="store.edgeSettings.expand" />
            <span>px</span>
          </span>
        </label>
        <input
          type="range" min="0" max="30"
          v-model.number="store.edgeSettings.expand"
          class="slider"
        />
      </div>

      <div class="slider-group">
        <label class="slider-label">
          <span class="label-with-tip">
            收缩
            <span class="tip-icon" title="向内收缩遮罩区域，缩小保留范围。可用于去除边缘残留的背景杂色">?</span>
          </span>
          <span class="numeric-value">
            <input type="number" min="0" max="30" v-model.number="store.edgeSettings.contract" />
            <span>px</span>
          </span>
        </label>
        <input
          type="range" min="0" max="30"
          v-model.number="store.edgeSettings.contract"
          class="slider"
        />
      </div>
    </div>

    <!-- Undo -->
    <div class="matting-section">
      <button
        class="action-btn"
        :disabled="store.isProcessing"
        @click="emit('undo')"
      >
        ↩ 撤销编辑
      </button>
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
  display: flex; flex-direction: column; gap: 18px;
}
.matting-section {
  display: flex; flex-direction: column; gap: 14px;
}
.matting-section-title {
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  color: var(--text-muted);
}

.slider-group {
  display: flex; flex-direction: column; gap: 9px;
  padding: 2px 0 4px;
}
.slider-label {
  font-size: 11px; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: space-between;
}
.label-with-tip {
  display: inline-flex; align-items: center; gap: 4px;
}
.tip-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--bg-primary); color: var(--text-muted);
  font-size: 9px; font-weight: 700; cursor: help;
  border: 1px solid var(--border); line-height: 1;
  transition: all 0.15s;
}
.tip-icon:hover {
  background: var(--accent); color: #fff; border-color: var(--accent);
}
.numeric-value {
  height: 24px;
  min-width: 62px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  color: var(--accent);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.numeric-value input {
  min-width: 0;
  width: 100%;
  appearance: textfield;
  -moz-appearance: textfield;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: right;
  outline: none;
  font: inherit;
}
.numeric-value input::-webkit-outer-spin-button,
.numeric-value input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.numeric-value span {
  color: var(--text-muted);
  user-select: none;
}

.action-btn {
  padding: 8px 12px; background: var(--bg-primary); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  font-size: 12px; cursor: pointer; text-align: left;
  transition: all 0.15s;
}
.action-btn:hover:not(:disabled) { border-color: var(--text-muted); }
.action-btn:disabled { opacity: 0.4; cursor: default; }

.info-text { font-size: 11px; color: var(--text-muted); }
</style>
