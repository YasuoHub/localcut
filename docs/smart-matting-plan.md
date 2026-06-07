# 智能抠图 — 实现文档

## 一、概述

LocalCut Pro 是纯前端本地部署的图片裁剪工作台（Vue 3 + TypeScript + Vite），面向电商运营场景。智能抠图模块基于 ONNX Runtime Web 实现浏览器端 AI 推理，**所有模型资源和代码均随应用本地部署，无需任何网络请求**。

### 核心特性
- **AI 自动抠图**：一键识别主体并去除背景（MODNet 模型）
- **手动遮罩编辑**：画笔标记保留/去除区域，边缘羽化/扩展/收缩
- **纯本地运行**：不上传图片到任何服务器，模型文件本地存储
- **Web Worker 推理**：推理在 Worker 中执行，主线程不阻塞
- **增量合成**：笔触编辑只更新局部像素，大图编辑流畅
- **双重集成**：独立抠图模块 + 结果可导入主画布成为新图层

## 二、技术选型

| 维度 | 选择 |
|------|------|
| 运行时 | `onnxruntime-web` v1.26.0，WebGPU 优先 + WASM 回退 |
| 默认模型 | MODNet INT8 量化版 (~6.6MB)，输入 512×512 |
| 高质量模型 | MODNet FP16 (~13MB)，精度更佳 |
| 模型存储 | `public/models/` 本地文件，随应用部署 |
| 缓存 | IndexedDB，二次打开免重新解析 |
| 推理线程 | Web Worker，不阻塞主线程 |
| 推理耗时 | INT8 模型约 1-2 秒（含预处理+后处理） |

### 为什么选 MODNet

- 模型小（量化版仅 6.6MB），适合本地部署
- 512×512 输入尺寸，速度与效果平衡
- 相比 U2-Net（44MB）/ IS-Net（80MB）更适合纯本地场景
- 社区量化 ONNX 模型，授权友好

## 三、功能清单

| 分类 | 功能 | 说明 |
|------|------|------|
| **图片输入** | 上传新图片 | 在抠图模块内直接上传 |
| | 使用当前图层（原图） | 从主画布导入活动图层的原始图片 |
| | 使用当前图层（编辑后） | 从主画布导入活动图层编辑后的画面 |
| **AI 推理** | 一键抠图 | 加载模型 + 推理，输出透明 PNG |
| | 模型切换 | MODNet INT8（快）/ MODNet FP16（精） |
| | 取消推理 | 推理/widget 下载过程中可取消 |
| | 进度指示 | 下载进度百分比 + 推理 loading 动画 |
| **遮罩编辑** | 保留画笔 | 涂抹标记前景区域（预览环绿色） |
| | 去除画笔 | 涂抹标记背景区域（预览环红色） |
| | 画笔大小 | 2-200px，快捷键 `[` `]` 调整 |
| | 撤销 | Ctrl+Z 撤销遮罩编辑（内部 20 步栈） |
| | 笔触插值 | 快速拖动鼠标自动补点，形成平滑连线 |
| | 预览模式 | 棋盘格透明背景 |
| **边缘精修** | 羽化 | 0-50px 高斯模糊，60ms 防抖 |
| | 扩展 | 0-30px 膨胀 |
| | 收缩 | 0-30px 腐蚀 |
| **导出** | 导出透明 PNG | `canvas.toBlob('image/png')` 下载 |
| | 发送到画布 | 将结果作为新图层添加到主画布 |

## 四、快捷键

| 快捷键 | 功能 |
|--------|------|
| `[` | 画笔大小 -4px |
| `]` | 画笔大小 +4px |
| `Ctrl+Z` | 撤销上次遮罩编辑（抠图模态窗内） |
| `Esc` | 关闭抠图模块 |

## 五、文件结构

```
src/
├── types/index.ts                          # Matting 类型定义
├── stores/matting.ts                       # 抠图状态管理（Pinia）
├── workers/mattingInference.worker.ts      # ONNX 推理 Web Worker
├── composables/
│   ├── useMattingInference.ts              # Worker 生命周期 + 推理编排
│   └── useMaskEditing.ts                   # 遮罩画笔编辑 + 增量合成
├── utils/
│   ├── mattingImageUtils.ts                # ImageData 转换 + 透明合成
│   ├── mattingModelCache.ts                # IndexedDB 模型缓存
│   └── mattingPostProcess.ts               # 遮罩后处理（模糊、膨胀、腐蚀）
├── constants/modelUrls.ts                  # 模型 URL 配置
├── components/matting/
│   ├── MattingWorkspace.vue                # 模态窗外壳
│   ├── MattingCanvas.vue                   # 中央预览画布
│   ├── MattingToolbar.vue                  # 左侧工具面板
│   └── MattingControlPanel.vue             # 右侧控制面板
├── public/models/                          # ONNX 模型文件（本地部署）
│   ├── model_quantized.onnx                # MODNet INT8 量化版
│   ├── model_fp16.onnx                     # MODNet FP16
│   ├── model_q4f16.onnx                    # MODNet Q4F16（备用）
│   └── model.onnx                          # MODNet 原始版
└── scripts/copy-ort-wasm.mjs               # postinstall 脚本：复制 ORT WASM
```

### 关键修改的现有文件

| 文件 | 改动 |
|------|------|
| `src/components/LeftSidebar.vue` | 新增「智能抠图」入口按钮 |
| `src/App.vue` | 抠图模态窗活跃时屏蔽编辑器快捷键（Ctrl+Z/Y/Esc） |
| `vite.config.ts` | 自定义中间件（WASM 资源路径 + 跨域隔离头 COOP/COEP），排除 `onnxruntime-web` 预构建 |
| `package.json` | 新增 `postinstall` 脚本：复制 ORT WASM 文件 |
| `.gitignore` | 排除 `public/wasm/` `public/models/` |

## 六、核心数据流

```
图片输入（上传/从画布导入）
  │
  ▼
MattingStore.sourceImage (HTMLImageElement)
  │
  ▼
useMattingInference.loadModel()
  ├─ 检查 IndexedDB 缓存
  ├─ 未命中 → 从 public/models/ 本地加载 → 存入 IndexedDB
  └─ ArrayBuffer → transfer 到 Worker → InferenceSession.create()
  │
  ▼
useMattingInference.runInference()
  ├─ 主线程预处理：resize → NCHW normalize → Float32Array
  ├─ transfer 到 Worker → session.run()
  ├─ Worker 后处理：threshold(0.5) → binary mask → transfer 回主线程
  └─ 主线程合成：sourceImage × mask → resultCanvas
  │
  ▼
MattingCanvas 渲染
  resultCanvas → 棋盘格背景 + 透明预览
  │
  ▼
useMaskEditing (手动编辑)
  ├─ 画笔涂抹 → maskCanvas（隐藏）→ 笔触插值 + 径向渐变
  ├─ rAF 节流 → 同步脏区到 store.maskData
  ├─ 增量合成：只更新笔触包围盒区域的 alpha 通道
  └─ 边缘滑块 → fullComposite（羽化/扩展/收缩影响全图）
  │
  ▼
导出：resultCanvas.toBlob('image/png')
发送到画布：editorStore.addLayer(img, '抠图结果')
```

## 七、Web Worker 消息协议

```typescript
// 主线程 → Worker
{ type: 'load_model', modelData: ArrayBuffer }        // transfer 传输模型
{ type: 'run_inference', tensorData: Float32Array,    // transfer 传输张量
    inputSize: number, maskWidth: number, maskHeight: number }
{ type: 'cancel' }                                    // 终止推理

// Worker → 主线程
{ type: 'model_loaded' }                              // 模型就绪
{ type: 'inference_complete', maskData: Uint8ClampedArray,  // transfer 传输遮罩
    maskWidth: number, maskHeight: number }
{ type: 'error', message: string }                    // 错误
```

所有大块数据（模型 ArrayBuffer、输入张量 Float32Array、输出遮罩 Uint8ClampedArray）通过 **transferable** 零拷贝传输，避免主线程↔Worker 之间的内存复制。

## 八、性能设计

### 增量合成（解决画笔卡顿的关键）

之前的实现每帧调用 `compositeResult()` 重建整张合成图（4000×3000 = 1200 万像素/帧），导致大图编辑卡顿。

当前实现：
- 维护一张持久化 `compositeCanvas`（原图分辨率）
- 首次加载做一次全图合成
- 后续笔触修改在 dirty rect 内增量更新：
  1. 只读取笔触包围盒区域的 mask 像素（约 2500 像素/帧）
  2. 只重绘该区域的源图
  3. 只在该区域内应用 mask alpha

**处理量：1200 万像素/帧 → 约 2500 像素/帧，提升 ~5000 倍。**

### rAF 节流

笔触绘制累积到 `requestAnimationFrame` 一次性刷新，避免高频鼠标事件（>60Hz）导致的重复合成。

### 笔触插值

连续鼠标点之间以 `半径 × 0.4` 步长线性插值补点，快速拖动时自动填充间隙，形成平滑连线。

### 撤销栈

20 步完整遮罩快照（`Uint8ClampedArray`），极端大图（12MP）约 240MB。后续可优化为操作增量存储。

## 九、与现有系统的集成

| 集成点 | 方式 |
|--------|------|
| 左侧入口 | LeftSidebar 新增「智能抠图」按钮 |
| 模态窗 | Teleport to body，`defineExpose({ open, close })` |
| 发送到画布 | `editorStore.addLayer(img, '抠图结果')` |
| 导出 | `canvas.toBlob('image/png')` |
| 快捷键隔离 | App.vue 判断 `matting.stage !== 'idle'` 时跳过编辑器 Ctrl+Z/Y/Esc |
| 样式 | 复用 `style.css` CSS 变量（深色主题） |
| 撤销 | 抠图模块内部独立 20 步快照栈，不污染主 historyStore |

## 十、模型文件（本地部署）

所有模型文件存放于 `public/models/`，随应用部署，**纯本地运行，不需要网络请求**。

| 文件名 | 模型 | 大小 | 说明 |
|--------|------|------|------|
| `model_quantized.onnx` | MODNet INT8 | ~6.6MB | 默认模型，速度快 |
| `model_fp16.onnx` | MODNet FP16 | ~13MB | 高质量可选 |
| `model_q4f16.onnx` | MODNet Q4F16 | ~12MB | 备用 |
| `model.onnx` | MODNet 原始 | ~25MB | 备用 |

WASM 运行时文件由 `npm postinstall` 脚本从 `node_modules/onnxruntime-web/dist/` 自动复制到 `public/wasm/`。

## 十一、已知限制与后续优化

| 项目 | 现状 | 可能的改进 |
|------|------|-----------|
| 输入尺寸 | 512×512 固定 | 大图可先裁剪主体区域再推理 |
| 撤销内存 | 20 步完整快照，大图最高 ~240MB | 操作增量存储替代全图快照 |
| 后端检测 | 固定显示 WASM | 实际检测 WebGPU/WASM 并显示 |
| 模型管理 | 手动放入 public/models/ | 支持用户上传自定义模型 |
