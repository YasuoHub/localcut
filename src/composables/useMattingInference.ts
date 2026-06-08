import { ref, onBeforeUnmount } from 'vue'
import { useMattingStore } from '../stores/matting'
import { useEditorStore } from '../stores/editor'
import { getCachedModel, cacheModel, downloadModel } from '../utils/mattingModelCache'
import { compositeResult, clampDimensions, downscaleMask } from '../utils/mattingImageUtils'
import { MODEL_URLS } from '../constants/modelUrls'
import type { MattingModelType, MattingMaskData } from '../types'

type WorkerMessageOut =
  | { type: 'load_model'; modelData: ArrayBuffer }
  | { type: 'run_inference'; tensorData: Float32Array; inputSize: number; maskWidth: number; maskHeight: number }
  | { type: 'cancel' }

type WorkerMessageIn =
  | { type: 'model_loaded'; backend?: string }
  | { type: 'inference_complete'; maskData: Uint8ClampedArray; maskWidth: number; maskHeight: number }
  | { type: 'error'; message: string }

function createWorker(): Worker {
  return new Worker(
    new URL('../workers/mattingInference.worker.ts', import.meta.url),
    { type: 'module' },
  )
}

export function useMattingInference() {
  const store = useMattingStore()
  let worker: Worker | null = null
  let currentModelType: MattingModelType | null = null
  const abortController = ref<AbortController | null>(null)
  let modelReady = false

  function ensureWorker(): Worker {
    if (!worker) {
      worker = createWorker()
    }
    return worker
  }

  function sendToWorker(msg: WorkerMessageOut, transfer?: Transferable[]) {
    const w = ensureWorker()
    if (transfer && transfer.length > 0) {
      w.postMessage(msg, { transfer })
    } else {
      w.postMessage(msg)
    }
  }

  function waitForWorker(type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const w = ensureWorker()
      const handler = (e: MessageEvent<WorkerMessageIn>) => {
        const msg = e.data
        if (msg.type === type) {
          w.removeEventListener('message', handler)
          resolve(msg)
        } else if (msg.type === 'error') {
          w.removeEventListener('message', handler)
          reject(new Error(msg.message))
        }
      }
      w.addEventListener('message', handler)
    })
  }

  async function loadModel(modelType: MattingModelType): Promise<boolean> {
    store.lastError = ''
    store.setStage('loading_model')
    store.setProgress('检查模型缓存...', 10)
    modelReady = false

    try {
      // Destroy previous worker (ensures clean state)
      if (worker) {
        worker.terminate()
        worker = null
      }

      let modelData = await getCachedModel(modelType)

      if (!modelData) {
        store.setProgress('下载模型中...', 20)
        const url = MODEL_URLS[modelType]
        const ac = new AbortController()
        abortController.value = ac

        modelData = await downloadModel(url, (pct) => {
          store.setProgress('下载模型中...', 20 + Math.round(pct * 0.5))
        }, ac.signal)

        store.setProgress('缓存模型...', 75)
        await cacheModel(modelType, modelData)
      }

      store.setProgress('加载推理引擎...', 80)

      // Transfer model buffer to worker (zero-copy)
      const buffer = modelData.slice(0) as ArrayBuffer // detach from original
      ensureWorker()
      const loadPromise = waitForWorker('model_loaded')
      sendToWorker({ type: 'load_model', modelData: buffer }, [buffer])

      await loadPromise
      modelReady = true
      currentModelType = modelType
      store.backend = 'wasm'

      store.setStage('ready')
      store.setProgress('模型就绪', 100)
      return true
    } catch (err: any) {
      if (err.name === 'AbortError') {
        store.setStage('ready')
        store.setProgress('', 0)
        return false
      } else {
        store.setStage('ready')
        store.setProgress('', 0)
        store.lastError = err.message || '模型加载失败'
        throw err
      }
    }
  }

  async function runInference(): Promise<void> {
    if (!store.sourceImage || !modelReady) {
      if (!store.lastError) store.lastError = '图片或模型未就绪'
      return
    }

    store.lastError = ''
    store.setStage('running_inference')
    store.setProgress('预处理图片...', 5)

    const startTime = performance.now()

    try {
      const inputSize = 512
      const maskWidth = store.sourceImage.naturalWidth
      const maskHeight = store.sourceImage.naturalHeight

      // Resize directly from source image (GPU-accelerated, no full-res ImageData needed)
      const resizedCanvas = document.createElement('canvas')
      resizedCanvas.width = inputSize
      resizedCanvas.height = inputSize
      const rctx = resizedCanvas.getContext('2d')!
      rctx.drawImage(store.sourceImage, 0, 0, inputSize, inputSize)
      const resizedData = rctx.getImageData(0, 0, inputSize, inputSize)

      // NCHW normalization
      const hw = inputSize * inputSize
      const tensorData = new Float32Array(3 * hw)
      const pixels = resizedData.data
      for (let i = 0; i < hw; i++) {
        tensorData[i] = pixels[i * 4] / 255
        tensorData[hw + i] = pixels[i * 4 + 1] / 255
        tensorData[2 * hw + i] = pixels[i * 4 + 2] / 255
      }

      store.setProgress('推理中...', 15)

      // Send to worker (transfer tensor ownership for zero-copy)
      const infPromise = waitForWorker('inference_complete')
      sendToWorker({
        type: 'run_inference',
        tensorData,
        inputSize,
        maskWidth,
        maskHeight,
      }, [tensorData.buffer])

      const result = await infPromise as Extract<WorkerMessageIn, { type: 'inference_complete' }>

      store.setProgress('合成结果...', 90)
      store.inferenceTime = Math.round(performance.now() - startTime)

      // Store full-resolution mask for export
      store.fullMaskData = {
        width: result.maskWidth,
        height: result.maskHeight,
        data: result.maskData,
      }

      // Yield to browser so loading overlay renders before heavy work
      const editor = useEditorStore()
      editor.isHeavyProcessing = true
      await new Promise(resolve => requestAnimationFrame(resolve))

      // Create working-resolution mask for display/editing
      const { w, h } = clampDimensions(result.maskWidth, result.maskHeight)
      let workingMaskData: Uint8ClampedArray
      if (w === result.maskWidth && h === result.maskHeight) {
        workingMaskData = result.maskData
      } else {
        workingMaskData = downscaleMask(result.maskData, result.maskWidth, result.maskHeight, w, h)
      }

      store.setMask({
        width: w,
        height: h,
        data: workingMaskData,
      })

      // Composite at working resolution
      const resultCanvas = compositeResult(store.sourceImage, workingMaskData, w, h)
      store.setResultCanvas(resultCanvas)
      store.setProgress('', 0)
      editor.isHeavyProcessing = false
    } catch (err: any) {
      store.setStage('ready')
      store.setProgress('', 0)
      store.lastError = err.message || '推理失败'
    } finally {
      const editor = useEditorStore()
      editor.isHeavyProcessing = false
    }
  }

  function cancel() {
    abortController.value?.abort()
    abortController.value = null

    if (worker) {
      worker.terminate()
      worker = null
      modelReady = false
    }

    store.setStage('ready')
    store.setProgress('', 0)
  }

  onBeforeUnmount(() => {
    if (worker) {
      worker.terminate()
      worker = null
    }
  })

  return { loadModel, runInference, cancel }
}
