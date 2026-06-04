<script setup lang="ts">
import { ref } from 'vue'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()
const showShortcuts = ref(false)
const showSettings = ref(false)
</script>

<template>
  <header class="topbar">
    <span class="logo">LocalCut Pro</span>
    <div class="topbar-right">
      <button class="icon-btn btn-ghost" title="设置" @click="showSettings = !showSettings">&#9881;</button>
      <button class="help-btn btn-ghost" title="快捷键" @click="showShortcuts = !showShortcuts">?</button>
    </div>
    <Teleport to="body">
      <div v-if="showSettings" class="popover-overlay" @click="showSettings = false">
        <div class="popover-panel" @click.stop>
          <div class="popover-title">系统设置</div>
          <label class="setting-item"><input type="checkbox" v-model="editor.constrainToImage" />限制裁剪框在图片内</label>
        </div>
      </div>
      <div v-if="showShortcuts" class="popover-overlay" @click="showShortcuts = false">
        <div class="popover-panel" @click.stop>
          <div class="popover-title">快捷键</div>
          <div class="shortcut-item"><kbd>Ctrl+Z</kbd> 撤销</div>
          <div class="shortcut-item"><kbd>Ctrl+Y</kbd> 重做</div>
          <div class="shortcut-item"><kbd>Ctrl+C</kbd> 复制区域</div>
          <div class="shortcut-item"><kbd>Ctrl+V</kbd> 粘贴区域</div>
          <div class="shortcut-item"><kbd>Delete</kbd> 删除选中区域</div>
          <div class="shortcut-item"><kbd>方向键</kbd> 微移选中区域</div>
          <div class="shortcut-item"><kbd>Shift+方向键</kbd> 快速微移</div>
          <div class="shortcut-item"><kbd>Ctrl+双击</kbd> 切换图层</div>
          <div class="shortcut-item"><kbd>Enter</kbd> 完成多边形</div>
          <div class="shortcut-item"><kbd>Esc</kbd> 取消多边形</div>
          <div class="shortcut-item"><kbd>Space+拖拽</kbd> 平移画布</div>
          <div class="shortcut-item"><kbd>滚轮</kbd> 缩放画布</div>
        </div>
      </div>
    </Teleport>
  </header>
</template>

<style scoped>
.topbar { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.logo { font-weight: 700; font-size: 15px; color: var(--accent); letter-spacing: -0.3px; }
.topbar-right { display: flex; align-items: center; gap: 4px; }
.icon-btn { width: 28px; height: 28px; padding: 0; border-radius: 50%; font-size: 15px; color: var(--text-muted); display: flex; align-items: center; justify-content: center; }
.icon-btn:hover { color: var(--text-primary); border-color: var(--text-muted); }
.help-btn { width: 28px; height: 28px; padding: 0; border-radius: 50%; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.help-btn:hover { color: var(--text-primary); border-color: var(--text-muted); }
.popover-overlay { position: fixed; inset: 0; z-index: 9999; background: transparent; }
.popover-panel { position: fixed; top: 52px; right: 16px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; min-width: 180px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
.popover-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
.setting-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-primary); cursor: pointer; margin-bottom: 4px; }
.setting-item input { accent-color: var(--accent); }
.shortcut-item { font-size: 11px; color: var(--text-secondary); margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
.shortcut-item kbd { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px; font-size: 10px; font-family: inherit; min-width: 48px; text-align: center; }
</style>
