<script setup lang="ts">
import { useMattingStore } from '../../stores/matting'
import type { MaskBrushMode } from '../../types'

const store = useMattingStore()

const brushModes: { id: MaskBrushMode; label: string; icon: string }[] = [
  { id: 'keep', label: '保留', icon: '●' },
  { id: 'remove', label: '去除', icon: '○' },
]

function setBrushMode(mode: MaskBrushMode) {
  store.brush.mode = mode
}
</script>

<template>
  <div class="matting-toolbar">
    <div class="matting-section">
      <div class="matting-section-title">画笔模式</div>
      <div class="mode-toggle">
        <button
          v-for="m in brushModes" :key="m.id"
          class="mode-btn"
          :class="{ active: store.brush.mode === m.id }"
          :title="m.label"
          @click="setBrushMode(m.id)"
        >
          <span class="mode-icon" :class="m.id">{{ m.icon }}</span>
          <span class="mode-label">{{ m.label }}</span>
        </button>
      </div>
    </div>

    <div class="matting-section">
      <div class="matting-section-title">
        画笔大小
        <span class="numeric-value">
          <input type="number" min="2" max="200" v-model.number="store.brush.size" />
          <span>px</span>
        </span>
      </div>
      <input
        type="range"
        min="2"
        max="200"
        v-model.number="store.brush.size"
        class="slider"
      />
    </div>

  </div>
</template>

<style scoped>
.matting-toolbar {
  display: flex; flex-direction: column; gap: 18px;
}
.matting-section {
  display: flex; flex-direction: column; gap: 12px;
}
.matting-section-title {
  font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  color: var(--text-muted); display: flex; align-items: center;
  justify-content: space-between;
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
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 400;
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

.mode-toggle {
  display: flex; gap: 4px;
}
.mode-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  gap: 4px; padding: 10px 6px; background: var(--bg-primary);
  border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-secondary); font-size: 11px; cursor: pointer;
  transition: all 0.15s;
}
.mode-btn:hover { border-color: var(--text-muted); }
.mode-btn.active {
  border-color: var(--accent); background: rgba(79,195,247,0.1); color: var(--accent);
}
.mode-icon { font-size: 16px; }
.mode-icon.keep { color: #66bb6a; }
.mode-icon.remove { color: #ef5350; }
.mode-label { font-size: 10px; }

</style>
