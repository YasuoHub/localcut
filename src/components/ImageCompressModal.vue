<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  compressImageFile,
  createCompressionJob,
  downloadCompressedImage,
  downloadCompressedImages,
  formatBytes,
  formatSavings,
  getImageCompressionLimitText,
  IMAGE_COMPRESSION_LIMITS,
  isCompressibleImage,
  type CompressionOutputFormat,
  type ImageCompressionJob,
} from '../composables/useImageCompression'

const show = defineModel<boolean>('show', { default: false })

type FormatOption = {
  value: CompressionOutputFormat
  label: string
  note: string
}

type PreviewMode = 'source' | 'result'

interface PreviewState {
  title: string
  subtitle: string
  url: string
}

const formatOptions: FormatOption[] = [
  { value: 'original', label: '保持原格式', note: '按原 PNG / JPG / WebP 输出' },
  { value: 'webp', label: 'WebP', note: '体积更小，适合网页与电商上传' },
  { value: 'jpeg', label: 'JPG', note: '通用兼容，透明区域会铺白底' },
  { value: 'png', label: 'PNG', note: '保留透明，但质量滑杆不生效' },
]

const fileInput = ref<HTMLInputElement | null>(null)
const jobs = ref<ImageCompressionJob[]>([])
const outputFormat = ref<CompressionOutputFormat>('webp')
const quality = ref(78)
const isProcessing = ref(false)
const dragActive = ref(false)
const message = ref('')
const preview = ref<PreviewState | null>(null)
let previewUrl: string | null = null

const hasFiles = computed(() => jobs.value.length > 0)
const doneJobs = computed(() => jobs.value.filter(job => job.status === 'done' && job.resultBlob))
const failedJobs = computed(() => jobs.value.filter(job => job.status === 'error'))
const totalOriginalSize = computed(() => jobs.value.reduce((sum, job) => sum + job.originalSize, 0))
const totalOutputSize = computed(() => doneJobs.value.reduce((sum, job) => sum + (job.outputSize ?? 0), 0))
const limitText = computed(() => getImageCompressionLimitText())
const canCompress = computed(() => hasFiles.value && !isProcessing.value)
const canDownload = computed(() => doneJobs.value.length > 0 && !isProcessing.value)
const qualityDisabled = computed(() => outputFormat.value === 'png')
const compressionHint = computed(() => {
  if (outputFormat.value === 'png') return 'PNG 会重新编码，主要用于统一格式，不适合作为强压缩模式。'
  if (quality.value >= 90) return '高质量，体积下降较少。'
  if (quality.value >= 70) return '推荐区间，画质和体积比较均衡。'
  return '强压缩，适合缩小体积，细节可能明显损失。'
})
const totalSavings = computed(() => formatSavings(totalOriginalSize.value, totalOutputSize.value || undefined))

function statusLabel(job: ImageCompressionJob) {
  if (job.status === 'pending') return '待处理'
  if (job.status === 'processing') return '处理中'
  if (job.status === 'done') return '完成'
  return '失败'
}

function openFilePicker() {
  if (isProcessing.value) return
  fileInput.value?.click()
}

function addFiles(fileList: FileList | File[]) {
  const skipped: string[] = []
  const availableSlots = IMAGE_COMPRESSION_LIMITS.maxFiles - jobs.value.length
  if (availableSlots <= 0) {
    message.value = `本次最多处理 ${IMAGE_COMPRESSION_LIMITS.maxFiles} 张图片，请先移除部分图片。`
    return
  }

  const currentTotal = jobs.value.reduce((sum, job) => sum + job.originalSize, 0)
  let nextTotal = currentTotal
  const incoming: File[] = []
  for (const file of Array.from(fileList)) {
    if (!isCompressibleImage(file)) {
      skipped.push(`${file.name}：格式不支持`)
      continue
    }
    if (file.size > IMAGE_COMPRESSION_LIMITS.maxFileBytes) {
      skipped.push(`${file.name}：超过单张 ${formatBytes(IMAGE_COMPRESSION_LIMITS.maxFileBytes)}`)
      continue
    }
    if (incoming.length >= availableSlots) {
      skipped.push(`${file.name}：超过单次 ${IMAGE_COMPRESSION_LIMITS.maxFiles} 张上限`)
      continue
    }
    if (nextTotal + file.size > IMAGE_COMPRESSION_LIMITS.maxTotalSourceBytes) {
      skipped.push(`${file.name}：超过本批源文件 ${formatBytes(IMAGE_COMPRESSION_LIMITS.maxTotalSourceBytes)} 上限`)
      continue
    }
    incoming.push(file)
    nextTotal += file.size
  }
  if (incoming.length === 0) {
    message.value = '未发现可压缩的 PNG / JPG / WebP 图片。'
    return
  }
  jobs.value.push(...incoming.map(createCompressionJob))
  message.value = `已加入 ${incoming.length} 张图片。`
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) addFiles(input.files)
  input.value = ''
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  dragActive.value = false
  if (isProcessing.value) return
  const files = e.dataTransfer?.files
  if (files) addFiles(files)
}

function removeJob(id: string) {
  if (isProcessing.value) return
  closePreview()
  jobs.value = jobs.value.filter(job => job.id !== id)
}

function clearJobs() {
  if (isProcessing.value) return
  closePreview()
  jobs.value = []
  message.value = ''
}

function openImagePreview(job: ImageCompressionJob, mode: PreviewMode) {
  const blob = mode === 'source' ? job.file : job.resultBlob
  if (!blob) return

  closePreview()
  previewUrl = URL.createObjectURL(blob)
  const size = mode === 'source' ? job.originalSize : job.outputSize
  const format = mode === 'source' ? '压缩前' : `压缩后 ${job.outputFormat?.toUpperCase() ?? ''}`
  preview.value = {
    title: job.name,
    subtitle: `${format}${size ? ` / ${formatBytes(size)}` : ''}`,
    url: previewUrl,
  }
}

function closePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = null
  preview.value = null
}

async function runCompression() {
  if (!canCompress.value) return
  closePreview()
  isProcessing.value = true
  message.value = '正在压缩图片...'
  try {
    for (const job of jobs.value) {
      job.status = 'processing'
      job.error = undefined
      job.resultBlob = undefined
      job.outputSize = undefined
      try {
        const result = await compressImageFile(job.file, {
          outputFormat: outputFormat.value,
          quality: quality.value,
        })
        job.status = 'done'
        job.width = result.width
        job.height = result.height
        job.outputFormat = result.outputFormat
        job.outputName = result.outputName
        job.outputSize = result.blob.size
        job.resultBlob = result.blob
      } catch (err) {
        job.status = 'error'
        job.error = err instanceof Error ? err.message : '压缩失败'
      }
    }
    message.value = failedJobs.value.length
      ? `完成 ${doneJobs.value.length} 张，失败 ${failedJobs.value.length} 张。`
      : `已完成 ${doneJobs.value.length} 张图片压缩。`
  } finally {
    isProcessing.value = false
  }
}

async function exportImages() {
  if (!canDownload.value) return
  if (totalOutputSize.value > IMAGE_COMPRESSION_LIMITS.zipHardLimitBytes) {
    window.alert(`导出结果约 ${formatBytes(totalOutputSize.value)}，超过批量 ZIP 安全上限 ${formatBytes(IMAGE_COMPRESSION_LIMITS.zipHardLimitBytes)}。请减少图片数量或使用单张导出。`)
    return
  }
  if (totalOutputSize.value > IMAGE_COMPRESSION_LIMITS.zipWarningBytes) {
    const ok = window.confirm(`导出结果约 ${formatBytes(totalOutputSize.value)}，打包 ZIP 会临时占用更多内存。是否继续导出？`)
    if (!ok) return
  }
  await downloadCompressedImages(jobs.value)
}

function exportSingleImage(job: ImageCompressionJob) {
  if (isProcessing.value) return
  downloadCompressedImage(job)
}

function requestClose() {
  if (isProcessing.value) return
  closePreview()
  show.value = false
}

onBeforeUnmount(closePreview)
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="compress-backdrop">
      <section class="compress-modal" role="dialog" aria-modal="true" aria-label="图片压缩">
        <header class="modal-header">
          <div>
            <h2>图片压缩</h2>
            <p>本地批量处理，不上传图片。</p>
          </div>
          <button class="close-btn" title="关闭" :disabled="isProcessing" @click="requestClose">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div class="modal-body">
          <section class="file-pane">
            <div
              class="drop-zone"
              :class="{ active: dragActive }"
              @dragover.prevent="dragActive = true"
              @dragleave.prevent="dragActive = false"
              @drop="handleDrop"
            >
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                @change="handleFileChange"
              />
              <button class="pick-btn" type="button" :disabled="isProcessing" @click="openFilePicker">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                添加图片
              </button>
              <span>也可以拖入多张 PNG / JPG / WebP</span>
            </div>

            <div class="file-toolbar">
              <small class="limit-note">{{ limitText }}</small>
              <strong>{{ jobs.length }} 张图片</strong>
              <button class="link-btn" type="button" :disabled="!hasFiles || isProcessing" @click="clearJobs">清空</button>
            </div>

            <div class="file-list scrollbar">
              <div v-if="!hasFiles" class="empty-state">等待加入图片</div>
              <article v-for="job in jobs" :key="job.id" class="file-row" :class="job.status">
                <div class="file-main">
                  <div class="file-name">{{ job.name }}</div>
                  <div class="file-meta">
                    <span>{{ formatBytes(job.originalSize) }}</span>
                    <span v-if="job.width && job.height">{{ job.width }}x{{ job.height }}</span>
                    <span v-if="job.outputSize">{{ formatBytes(job.outputSize) }}</span>
                    <span v-if="job.outputSize" class="saving">{{ formatSavings(job.originalSize, job.outputSize) }}</span>
                  </div>
                  <div v-if="job.error" class="file-error">{{ job.error }}</div>
                </div>

                <div class="preview-actions">
                  <button class="preview-btn" type="button" title="预览压缩前图片" @click="openImagePreview(job, 'source')">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                    原图
                  </button>
                  <button
                    class="preview-btn"
                    type="button"
                    title="预览压缩后图片"
                    :disabled="job.status !== 'done'"
                    @click="openImagePreview(job, 'result')"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
                      <circle cx="12" cy="12" r="2.5" />
                    </svg>
                    结果
                  </button>
                  <button
                    class="preview-btn export-one-btn"
                    type="button"
                    title="导出这张压缩后的图片"
                    :disabled="job.status !== 'done' || isProcessing"
                    @click="exportSingleImage(job)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3v11" />
                      <path d="M7 9l5 5 5-5" />
                      <path d="M5 19h14" />
                    </svg>
                    导出
                  </button>
                </div>

                <span class="status-text">
                  <span class="status-dot"></span>
                  {{ statusLabel(job) }}
                </span>

                <button class="remove-btn" title="删除" :disabled="isProcessing" @click="removeJob(job.id)">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M6 7l1 14h10l1-14" />
                    <path d="M9 7V4h6v3" />
                  </svg>
                </button>
              </article>
            </div>
          </section>

          <aside class="settings-pane">
            <section class="settings-block">
              <div class="block-title">输出格式</div>
              <div class="format-grid">
                <label v-for="option in formatOptions" :key="option.value" class="format-option">
                  <input v-model="outputFormat" type="radio" :value="option.value" :disabled="isProcessing" />
                  <span>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.note }}</small>
                  </span>
                </label>
              </div>
            </section>

            <section class="settings-block">
              <div class="block-title">
                <span>压缩率 / 质量</span>
                <strong>{{ quality }}%</strong>
              </div>
              <input v-model.number="quality" type="range" min="10" max="100" :disabled="qualityDisabled || isProcessing" />
              <div class="quality-row">
                <span>更小体积</span>
                <span>更高画质</span>
              </div>
              <p class="settings-hint">{{ compressionHint }}</p>
            </section>

            <section class="summary-block">
              <div class="summary-row">
                <span>原始大小</span>
                <strong>{{ formatBytes(totalOriginalSize) }}</strong>
              </div>
              <div class="summary-row">
                <span>输出大小</span>
                <strong>{{ totalOutputSize ? formatBytes(totalOutputSize) : '--' }}</strong>
              </div>
              <div class="summary-row accent">
                <span>节省比例</span>
                <strong>{{ totalSavings }}</strong>
              </div>
              <p v-if="message" class="run-message">{{ message }}</p>
            </section>

            <section class="side-actions">
              <button class="btn-ghost" type="button" :disabled="!canDownload" @click="exportImages">导出图片</button>
              <button class="btn-primary" type="button" :disabled="!canCompress" @click="runCompression">
                {{ isProcessing ? '压缩中...' : '开始压缩' }}
              </button>
            </section>
          </aside>
        </div>
      </section>

      <section v-if="preview" class="preview-modal" role="dialog" aria-modal="true" aria-label="图片预览">
        <header class="preview-header">
          <div>
            <h3>{{ preview.title }}</h3>
            <p>{{ preview.subtitle }}</p>
          </div>
          <button class="close-btn" title="关闭预览" @click="closePreview">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div class="preview-stage">
          <img :src="preview.url" alt="图片预览" />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.compress-backdrop {
  position: fixed;
  inset: 0;
  z-index: 99980;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.66);
}

.compress-modal {
  width: min(1040px, calc(100vw - 48px));
  height: min(720px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 28%),
    var(--bg-secondary);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.58);
}

.modal-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.modal-header h2,
.preview-header h3 {
  margin: 0;
  color: var(--text-primary);
  line-height: 1.2;
}

.modal-header h2 {
  font-size: 16px;
}

.preview-header h3 {
  max-width: min(560px, calc(100vw - 170px));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.modal-header p,
.preview-header p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 11px;
}

.close-btn,
.remove-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.close-btn {
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.close-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.remove-btn {
  border: 1px solid rgba(230, 92, 92, 0.28);
  color: var(--danger);
}

.remove-btn:hover:not(:disabled) {
  background: rgba(230, 92, 92, 0.12);
  border-color: rgba(230, 92, 92, 0.56);
}

.close-btn svg,
.remove-btn svg,
.pick-btn svg,
.preview-btn svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.modal-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
}

.file-pane,
.settings-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-pane {
  border-right: 1px solid var(--border);
}

.drop-zone {
  margin: 14px 14px 10px;
  min-height: 86px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: rgba(17, 17, 15, 0.48);
  color: var(--text-muted);
  transition:
    border-color 0.15s,
    background 0.15s,
    color 0.15s;
}

.drop-zone.active {
  border-color: var(--accent);
  background: rgba(40, 199, 111, 0.08);
  color: var(--text-secondary);
}

.pick-btn {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  background: var(--bg-tertiary);
  border: 1px solid rgba(40, 199, 111, 0.3);
  color: var(--accent);
}

.pick-btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: rgba(40, 199, 111, 0.09);
}

.file-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 9px;
  color: var(--text-secondary);
  font-size: 12px;
}

.limit-note {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-size: 10px;
}

.link-btn {
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
}

.link-btn:hover:not(:disabled) {
  color: var(--danger);
}

.file-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 14px;
}

.empty-state {
  height: 100%;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}

.file-row {
  min-height: 64px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 174px 66px 30px;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  margin-bottom: 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
}

.file-row.done {
  border-color: rgba(40, 199, 111, 0.26);
}

.file-row.error {
  border-color: rgba(230, 92, 92, 0.38);
}

.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 650;
}

.file-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 10px;
}

.file-meta .saving {
  color: var(--accent);
}

.file-error {
  margin-top: 4px;
  color: var(--danger);
  font-size: 10px;
}

.preview-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.preview-btn {
  min-width: 0;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.preview-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: rgba(40, 199, 111, 0.42);
  background: rgba(40, 199, 111, 0.07);
}

.export-one-btn {
  color: #8fc6ff;
  border-color: rgba(74, 168, 255, 0.24);
}

.export-one-btn:hover:not(:disabled) {
  color: #b8ddff;
  border-color: rgba(74, 168, 255, 0.48);
  background: rgba(74, 168, 255, 0.08);
}

.preview-btn svg {
  width: 13px;
  height: 13px;
}

.status-text {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.78;
}

.file-row.processing .status-text {
  color: var(--warning);
}

.file-row.done .status-text {
  color: var(--accent);
}

.file-row.error .status-text {
  color: var(--danger);
}

.settings-pane {
  padding: 14px;
  gap: 12px;
  background: rgba(17, 17, 15, 0.28);
}

.settings-block,
.summary-block {
  padding-bottom: 13px;
  border-bottom: 1px solid var(--border);
}

.block-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.block-title strong {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.format-grid {
  display: grid;
  gap: 7px;
}

.format-option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  cursor: pointer;
}

.format-option:has(input:checked) {
  border-color: rgba(40, 199, 111, 0.54);
  background: rgba(40, 199, 111, 0.08);
}

.format-option input {
  margin-top: 2px;
  accent-color: var(--accent);
}

.format-option strong,
.format-option small {
  display: block;
}

.format-option strong {
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.25;
}

.format-option small {
  margin-top: 3px;
  color: var(--text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.quality-row,
.settings-hint {
  color: var(--text-muted);
  font-size: 10px;
}

.quality-row {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
}

.settings-hint {
  margin: 8px 0 0;
  line-height: 1.45;
}

.summary-block {
  display: grid;
  gap: 8px;
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 12px;
}

.summary-row strong {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.summary-row.accent strong {
  color: var(--accent);
}

.run-message {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.side-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: auto;
  padding-top: 2px;
}

.side-actions button {
  width: 100%;
  min-height: 34px;
}

.preview-modal {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 99990;
  width: min(820px, calc(100vw - 64px));
  height: min(640px, calc(100vh - 64px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translate(-50%, -50%);
  background: var(--bg-secondary);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7);
}

.preview-header {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.preview-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%),
    var(--bg-primary);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}

.preview-stage img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 10px 38px rgba(0, 0, 0, 0.35);
}

button:disabled,
.format-option:has(input:disabled) {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 900px) {
  .compress-modal {
    height: calc(100vh - 28px);
    width: calc(100vw - 28px);
  }

  .modal-body {
    grid-template-columns: 1fr;
  }

  .settings-pane {
    max-height: 350px;
    overflow-y: auto;
    border-top: 1px solid var(--border);
  }

  .file-pane {
    border-right: 0;
  }

  .file-row {
    grid-template-columns: minmax(0, 1fr) 162px 62px 30px;
  }
}
</style>
