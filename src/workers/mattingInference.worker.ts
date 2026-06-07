import * as ort from 'onnxruntime-web'
import { ORT_WASM_PATH } from '../constants/modelUrls'

ort.env.wasm.wasmPaths = ORT_WASM_PATH

let session: ort.InferenceSession | null = null

type WorkerMessage =
  | { type: 'load_model'; modelData: ArrayBuffer }
  | { type: 'run_inference'; tensorData: Float32Array; inputSize: number; maskWidth: number; maskHeight: number }
  | { type: 'cancel' }

async function handleLoadModel(modelData: ArrayBuffer) {
  if (session) {
    session.release()
    session = null
  }

  try {
    session = await ort.InferenceSession.create(modelData, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
    })
  } catch (err: any) {
    const msg = (err.message || String(err)).toLowerCase()
    if (msg.includes('float16') || msg.includes('fp16') || msg.includes('not supported')) {
      self.postMessage({
        type: 'error',
        message: '精细模型(FP16)需要 WebGPU，您的系统 WebGPU 不可用。请切换到快速模型(INT8)。',
      })
      return
    }
    // WDDM / D3D / DXC 错误
    if (msg.includes('dxc') || msg.includes('d3d') || msg.includes('wddm') ||
        msg.includes('adapter') || msg.includes('device') || msg.includes('webgpu')) {
      self.postMessage({
        type: 'error',
        message: 'WebGPU 初始化失败（显卡驱动或 DirectX 问题）。WASM 后端不支持 FP16，请使用快速模型(INT8)。',
      })
      return
    }
    self.postMessage({ type: 'error', message: `模型加载失败: ${err.message || err}` })
    return
  }

  self.postMessage({ type: 'model_loaded' })
}

async function handleRunInference(
  tensorData: Float32Array,
  inputSize: number,
  maskWidth: number,
  maskHeight: number,
) {
  if (!session) {
    self.postMessage({ type: 'error', message: '模型未加载' })
    return
  }

  try {
    const inputName = session.inputNames[0]
    const tensor = new ort.Tensor('float32', tensorData, [1, 3, inputSize, inputSize])
    const feeds: Record<string, ort.Tensor> = { [inputName]: tensor }
    const results = await session.run(feeds)
    const outputKey = Object.keys(results)[0]
    const output = results[outputKey]
    const outputData = output.data as Float32Array

    // Post-process on worker side: threshold + resize to original
    const maskPixels = new Uint8ClampedArray(maskWidth * maskHeight)
    const scaleX = inputSize / maskWidth
    const scaleY = inputSize / maskHeight

    for (let y = 0; y < maskHeight; y++) {
      for (let x = 0; x < maskWidth; x++) {
        const sx = Math.min(Math.floor(x * scaleX), inputSize - 1)
        const sy = Math.min(Math.floor(y * scaleY), inputSize - 1)
        maskPixels[y * maskWidth + x] = outputData[sy * inputSize + sx] > 0.5 ? 255 : 0
      }
    }

    // Transfer the mask back (use transferable)
    self.postMessage({
      type: 'inference_complete',
      maskData: maskPixels,
      maskWidth,
      maskHeight,
    }, { transfer: [maskPixels.buffer] })
  } catch (err: any) {
    const msg = (err.message || String(err)).toLowerCase()
    if (msg.includes('float16') || msg.includes('fp16') || msg.includes('not supported')) {
      self.postMessage({
        type: 'error',
        message: 'FP16 模型推理失败，WASM 后端不支持此操作。请使用快速模型(INT8)。',
      })
      return
    }
    self.postMessage({ type: 'error', message: err.message || '推理失败' })
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data

  try {
    switch (msg.type) {
      case 'load_model':
        await handleLoadModel(msg.modelData)
        break
      case 'run_inference':
        await handleRunInference(msg.tensorData, msg.inputSize, msg.maskWidth, msg.maskHeight)
        break
      case 'cancel':
        if (session) {
          session.release()
          session = null
        }
        break
    }
  } catch (err: any) {
    const msg = (err.message || String(err)).toLowerCase()
    if (msg.includes('float16') || msg.includes('fp16') || msg.includes('not supported')) {
      self.postMessage({ type: 'error', message: 'FP16 模型需要 WebGPU，请切换到快速模型(INT8)。' })
      return
    }
    self.postMessage({ type: 'error', message: err.message || 'Worker 错误' })
  }
}
