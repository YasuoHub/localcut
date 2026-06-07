import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  MattingModelType, MattingBackend,
  MattingStage, MattingImageSource,
  MattingMaskData, MattingBrush, MattingEdgeSettings,
} from '../types'

export const useMattingStore = defineStore('matting', () => {
  // image
  const sourceImage = ref<HTMLImageElement | null>(null)
  const sourceImageDataUrl = ref('')
  const imageSource = ref<MattingImageSource>('upload')

  // mask
  const maskData = ref<MattingMaskData | null>(null)
  const fullMaskData = ref<MattingMaskData | null>(null)
  const maskEdited = ref(false)
  const resultCanvas = ref<HTMLCanvasElement | null>(null)

  // model
  const selectedModel = ref<MattingModelType>('modnet')
  const backend = ref<MattingBackend>('webgpu')

  // stage / progress
  const stage = ref<MattingStage>('idle')
  const progress = ref({ message: '', percent: 0 })
  const inferenceTime = ref(0)
  const lastError = ref('')

  // tools
  const brush = ref<MattingBrush>({ size: 24, mode: 'remove' })
  const edgeSettings = ref<MattingEdgeSettings>({ feather: 0, expand: 0, contract: 0 })
  const maskVersion = ref(0)

  // computed
  const hasMask = computed(() => maskData.value !== null)
  const isProcessing = computed(() =>
    stage.value === 'loading_model' || stage.value === 'running_inference',
  )

  // actions
  function setSourceImage(img: HTMLImageElement, source: MattingImageSource = 'upload') {
    sourceImage.value = img
    sourceImageDataUrl.value = img.src
    imageSource.value = source
    maskData.value = null
    fullMaskData.value = null
    maskEdited.value = false
    resultCanvas.value = null
    stage.value = 'ready'
  }

  function setMask(data: MattingMaskData) {
    maskData.value = data
    maskVersion.value++
    stage.value = 'mask_editing'
  }

  function setResultCanvas(canvas: HTMLCanvasElement) {
    resultCanvas.value = canvas
  }

  function setStage(s: MattingStage) {
    stage.value = s
  }

  function setProgress(msg: string, pct: number) {
    progress.value = { message: msg, percent: pct }
  }

  function reset() {
    sourceImage.value = null
    sourceImageDataUrl.value = ''
    maskData.value = null
    fullMaskData.value = null
    maskEdited.value = false
    resultCanvas.value = null
    stage.value = 'idle'
    progress.value = { message: '', percent: 0 }
    inferenceTime.value = 0
    lastError.value = ''
  }

  return {
    sourceImage, sourceImageDataUrl, imageSource,
    maskData, fullMaskData, maskEdited, resultCanvas,
    selectedModel, backend,
    stage, progress, inferenceTime,
    brush, edgeSettings, maskVersion,
    hasMask, isProcessing,
    lastError,
    setSourceImage, setMask, setResultCanvas,
    setStage, setProgress, reset,
  }
})
