import * as ort from 'onnxruntime-web'
import { ORT_WASM_PATH } from '../constants/modelUrls'

ort.env.wasm.wasmPaths = ORT_WASM_PATH

let session: ort.InferenceSession | null = null

type WorkerMessage =
  | { type: 'load_model'; modelData: ArrayBuffer }
  | { type: 'upscale'; imageData: ImageData }
  | { type: 'cancel' }

async function handleLoadModel(modelData: ArrayBuffer) {
  if (session) {
    session.release()
    session = null
  }
  // APISR RRDB GAN: standard CNN ops, well-supported by ORT Web
  session = await ort.InferenceSession.create(modelData, {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all',
  })
  self.postMessage({ type: 'model_loaded' })
}

function imageDataToNchw(data: Uint8ClampedArray, h: number, w: number): Float32Array {
  const c = 3
  const result = new Float32Array(c * h * w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * w + x) * 4
      result[0 * h * w + y * w + x] = data[srcIdx] / 255
      result[1 * h * w + y * w + x] = data[srcIdx + 1] / 255
      result[2 * h * w + y * w + x] = data[srcIdx + 2] / 255
    }
  }
  return result
}

function nchwToImageData(output: Float32Array, outH: number, outW: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(outW * outH * 4)
  const total = outH * outW
  for (let i = 0; i < total; i++) {
    const dstIdx = i * 4
    result[dstIdx] = clamp(Math.round(output[0 * total + i] * 255))
    result[dstIdx + 1] = clamp(Math.round(output[1 * total + i] * 255))
    result[dstIdx + 2] = clamp(Math.round(output[2 * total + i] * 255))
    result[dstIdx + 3] = 255
  }
  return result
}

function clamp(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v }

async function handleUpscale(imageData: ImageData) {
  if (!session) {
    self.postMessage({ type: 'error', message: '模型未加载' })
    return
  }

  try {
    const inW = imageData.width
    const inH = imageData.height
    const outH = inH * 2
    const outW = inW * 2

    const tensorData = imageDataToNchw(imageData.data, inH, inW)
    const inputName = session.inputNames[0]
    const tensor = new ort.Tensor('float32', tensorData, [1, 3, inH, inW])
    const feeds: Record<string, ort.Tensor> = { [inputName]: tensor }

    const results = await session.run(feeds)
    const outputKey = Object.keys(results)[0]
    const output = results[outputKey]
    const outputData = output.data as Float32Array

    const pixels = nchwToImageData(outputData, outH, outW)

    self.postMessage({
      type: 'upscale_complete',
      result: { width: outW, height: outH, data: pixels },
    }, { transfer: [pixels.buffer] })
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || '超分推理失败' })
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'load_model':
        await handleLoadModel(msg.modelData)
        break
      case 'upscale':
        await handleUpscale(msg.imageData)
        break
      case 'cancel':
        if (session) { session.release(); session = null }
        break
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || 'Worker 错误' })
  }
}
