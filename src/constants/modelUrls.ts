import type { MattingModelType } from '../types'

// 开发环境默认从 public/models/ 加载
// 生产环境改为 CDN 地址
// MODNet: 轻量级人像/物体抠图模型，输入 512×512
export const MODEL_URLS: Record<MattingModelType, string> = {
  modnet: '/models/model_quantized.onnx',
  'modnet-fp16': '/models/model_fp16.onnx',
}

// ORT WASM 运行时文件路径
export const ORT_WASM_PATH = '/wasm/'
