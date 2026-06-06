import * as ort from 'onnxruntime-web'

ort.env.wasm.wasmPaths = '/wasm/'

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

  // Report progress from within the worker is limited —
  // session creation is the heavy part
  session = await ort.InferenceSession.create(modelData, {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all',
  })

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
    self.postMessage({ type: 'error', message: err.message || 'Worker 错误' })
  }
}
