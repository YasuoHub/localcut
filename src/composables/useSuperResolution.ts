import { ref, type Ref } from 'vue'
import { UPSCALE_MODEL_URL } from '../constants/modelUrls'

const DB_NAME = 'localcut-upscale-models'
const STORE_NAME = 'models'
const DB_VERSION = 1
const MODEL_KEY = 'apisr-rrdb-gan-x2'
const TILE_SIZE = 512
const TILE_OVERLAP = 16

type UpscaleProgress = { message: string; percent: number }

// ---- IndexedDB cache ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getCachedModel(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(MODEL_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function cacheModel(buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(buffer, MODEL_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch { /* silent */ }
}

async function downloadModel(
  url: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`下载模型失败: HTTP ${response.status}`)
  if (!response.body) throw new Error('响应体为空')

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress(Math.round((received / total) * 100))
  }

  const buffer = new Uint8Array(received)
  let pos = 0
  for (const chunk of chunks) { buffer.set(chunk, pos); pos += chunk.length }
  return buffer.buffer
}

// ---- composable ----

export function useSuperResolution() {
  const modelLoaded = ref(false)
  const isLoading = ref(false)
  const isUpscaling = ref(false)
  const progress = ref<UpscaleProgress>({ message: '', percent: 0 })

  let worker: Worker | null = null

  function getWorker(): Worker {
    if (!worker) {
      worker = new Worker(
        new URL('../workers/superResolution.worker.ts', import.meta.url),
        { type: 'module' },
      )
    }
    return worker
  }

  function waitForWorker(type: string, timeout = 120_000): Promise<any> {
    const w = getWorker()
    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        if (e.data.type === type) {
          clearTimeout(t)
          w.removeEventListener('message', handler)
          resolve(e.data)
        }
        if (e.data.type === 'error') {
          clearTimeout(t)
          w.removeEventListener('message', handler)
          reject(new Error(e.data.message))
        }
      }
      const t = setTimeout(() => {
        w.removeEventListener('message', handler)
        reject(new Error(`Worker 响应超时: ${type}`))
      }, timeout)
      w.addEventListener('message', handler)
    })
  }

  async function loadModel(signal?: AbortSignal): Promise<void> {
    if (modelLoaded.value) return
    isLoading.value = true
    progress.value = { message: '加载超分模型...', percent: 0 }

    try {
      let buffer = await getCachedModel()
      if (!buffer) {
        progress.value = { message: '下载超分模型...', percent: 0 }
        buffer = await downloadModel(UPSCALE_MODEL_URL, (p) => {
          progress.value = { message: '下载超分模型...', percent: p }
        }, signal)
        await cacheModel(buffer)
      }

      progress.value = { message: '初始化模型...', percent: 90 }
      const w = getWorker()
      const slice = buffer.slice(0)
      w.postMessage({ type: 'load_model', modelData: slice }, { transfer: [slice] })
      await waitForWorker('model_loaded', 300_000)

      modelLoaded.value = true
      progress.value = { message: '', percent: 100 }
    } finally {
      isLoading.value = false
    }
  }

  async function upscaleImage(source: ImageData): Promise<ImageData> {
    if (!modelLoaded.value) throw new Error('模型未加载')
    isUpscaling.value = true

    try {
      const w = source.width
      const h = source.height

      // Small image: single pass
      if (w <= TILE_SIZE && h <= TILE_SIZE) {
        progress.value = { message: 'AI 超分中...', percent: 0 }
        return await upscaleSingleTile(source)
      }

      // Large image: tiled processing
      const cols = Math.ceil(w / (TILE_SIZE - TILE_OVERLAP))
      const rows = Math.ceil(h / (TILE_SIZE - TILE_OVERLAP))
      const outW = w * 2
      const outH = h * 2
      const totalTiles = rows * cols
      let completed = 0

      // Create a full output canvas + source canvas once (not per tile)
      const sourceCanvas = await imageDataToCanvas(source)
      const resultCanvas = document.createElement('canvas')
      resultCanvas.width = outW
      resultCanvas.height = outH
      const rctx = resultCanvas.getContext('2d')!

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const tileX = Math.max(0, col * (TILE_SIZE - TILE_OVERLAP))
          const tileY = Math.max(0, row * (TILE_SIZE - TILE_OVERLAP))
          const tileW = Math.min(TILE_SIZE, w - tileX)
          const tileH = Math.min(TILE_SIZE, h - tileY)

          // Extract tile
          const tileCanvas = document.createElement('canvas')
          tileCanvas.width = tileW
          tileCanvas.height = tileH
          const tctx = tileCanvas.getContext('2d')!
          tctx.drawImage(sourceCanvas, tileX, tileY, tileW, tileH, 0, 0, tileW, tileH)
          const tileImageData = tctx.getImageData(0, 0, tileW, tileH)

          const upscaled = await upscaleSingleTile(tileImageData)
          completed++
          progress.value = {
            message: `AI 超分中... ${completed}/${totalTiles}`,
            percent: Math.round((completed / totalTiles) * 100),
          }

          // Paste into result
          const utCanvas = document.createElement('canvas')
          utCanvas.width = upscaled.width
          utCanvas.height = upscaled.height
          utCanvas.getContext('2d')!.putImageData(upscaled, 0, 0)
          rctx.drawImage(utCanvas, tileX * 2, tileY * 2)
        }
      }

      return rctx.getImageData(0, 0, outW, outH)
    } finally {
      isUpscaling.value = false
      progress.value = { message: '', percent: 0 }
    }
  }

  async function upscaleSingleTile(imageData: ImageData): Promise<ImageData> {
    const sourceWidth = imageData.width
    const sourceHeight = imageData.height
    const modelInput = padToEvenDimensions(imageData)
    const w = getWorker()
    w.postMessage({ type: 'upscale', imageData: modelInput })
    const result = await waitForWorker('upscale_complete', 600_000)
    const resultImageData = new ImageData(
      new Uint8ClampedArray(result.result.data),
      result.result.width,
      result.result.height,
    )
    if (resultImageData.width === sourceWidth * 2 && resultImageData.height === sourceHeight * 2) {
      return resultImageData
    }
    return cropImageData(resultImageData, sourceWidth * 2, sourceHeight * 2)
  }

  function padToEvenDimensions(imageData: ImageData): ImageData {
    const evenW = imageData.width % 2 === 0 ? imageData.width : imageData.width + 1
    const evenH = imageData.height % 2 === 0 ? imageData.height : imageData.height + 1
    if (evenW === imageData.width && evenH === imageData.height) return imageData

    const padded = new ImageData(evenW, evenH)
    const src = imageData.data
    const dst = padded.data
    for (let y = 0; y < evenH; y++) {
      const srcY = Math.min(y, imageData.height - 1)
      for (let x = 0; x < evenW; x++) {
        const srcX = Math.min(x, imageData.width - 1)
        const srcIdx = (srcY * imageData.width + srcX) * 4
        const dstIdx = (y * evenW + x) * 4
        dst[dstIdx] = src[srcIdx]
        dst[dstIdx + 1] = src[srcIdx + 1]
        dst[dstIdx + 2] = src[srcIdx + 2]
        dst[dstIdx + 3] = src[srcIdx + 3]
      }
    }
    return padded
  }

  function cropImageData(imageData: ImageData, width: number, height: number): ImageData {
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    canvas.getContext('2d')!.putImageData(imageData, 0, 0)

    const cropped = document.createElement('canvas')
    cropped.width = width
    cropped.height = height
    const ctx = cropped.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)
    return ctx.getImageData(0, 0, width, height)
  }

  function imageDataToCanvas(imageData: ImageData): Promise<HTMLCanvasElement> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      canvas.width = imageData.width
      canvas.height = imageData.height
      canvas.getContext('2d')!.putImageData(imageData, 0, 0)
      resolve(canvas)
    })
  }

  function destroy() {
    if (worker) {
      worker.postMessage({ type: 'cancel' })
      worker.terminate()
      worker = null
    }
    modelLoaded.value = false
  }

  return { modelLoaded, isLoading, isUpscaling, progress, loadModel, upscaleImage, destroy, upscaleSingleTile }
}

/** One-shot upscale: loads model, upscales canvas, returns new canvas. */
export async function upscaleCanvas(
  source: HTMLCanvasElement,
  onProgress: (p: UpscaleProgress) => void,
): Promise<HTMLCanvasElement> {
  const { loadModel, upscaleImage, destroy } = useSuperResolution()

  try {
    onProgress({ message: '加载超分模型...', percent: 0 })
    await loadModel()

    const ctx = source.getContext('2d')!
    const imageData = ctx.getImageData(0, 0, source.width, source.height)

    onProgress({ message: 'AI 超分中...', percent: 10 })
    const resultImageData = await upscaleImage(imageData)

    const canvas = document.createElement('canvas')
    canvas.width = resultImageData.width
    canvas.height = resultImageData.height
    canvas.getContext('2d')!.putImageData(resultImageData, 0, 0)

    return canvas
  } finally {
    destroy()
  }
}
