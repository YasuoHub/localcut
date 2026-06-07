import type { MattingModelType } from '../types'
import { IS_ELECTRON, IS_ELECTRON_DEV } from './env'

// 模型协议前缀
// - 浏览器：/models/ → public/models/，由 Vite dev server 或 nginx 提供
// - Electron Dev：/models/ → 相对 URL，自动解析到 http://localhost:5173/models/（Vite dev server）
// - Electron Prod：localcut://models/ → 主进程注册的自定义协议，映射到 extraResources/models/
const IS_ELECTRON_PROD = IS_ELECTRON && !IS_ELECTRON_DEV
const MODEL_PREFIX = IS_ELECTRON_PROD ? 'localcut://models' : '/models'
const WASM_PREFIX = IS_ELECTRON_PROD ? 'localcut://wasm' : '/wasm'

// MODNet: 轻量级人像/物体抠图模型，输入 512×512
export const MODEL_URLS: Record<MattingModelType, string> = {
  modnet: `${MODEL_PREFIX}/model_quantized.onnx`,
  'modnet-fp16': `${MODEL_PREFIX}/model_fp16.onnx`,
}

// 超分辨率模型 (APISR RRDB GAN x2, 4.72 MB quantized)
// HuggingFace: https://huggingface.co/Xenova/2x_APISR_RRDB_GAN_generator-onnx
// 纯卷积架构，ONNX Runtime Web 兼容性好
export const UPSCALE_MODEL_URL = `${MODEL_PREFIX}/apisr_rrdb_gan_x2_quantized.onnx`

// ORT WASM 运行时文件路径
export const ORT_WASM_PATH = WASM_PREFIX + '/'
