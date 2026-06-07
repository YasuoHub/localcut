import type { MattingModelType } from '../types'

// 开发环境默认从 public/models/ 加载
// 生产环境改为 CDN 地址
// MODNet: 轻量级人像/物体抠图模型，输入 512×512
export const MODEL_URLS: Record<MattingModelType, string> = {
  modnet: '/models/model_quantized.onnx',
  'modnet-fp16': '/models/model_fp16.onnx',
}

// 超分辨率模型 (APISR RRDB GAN x2, 4.72 MB quantized)
// HuggingFace: https://huggingface.co/Xenova/2x_APISR_RRDB_GAN_generator-onnx
// 纯卷积架构，ONNX Runtime Web 兼容性好
export const UPSCALE_MODEL_URL = '/models/apisr_rrdb_gan_x2_quantized.onnx'

// ORT WASM 运行时文件路径
export const ORT_WASM_PATH = '/wasm/'
