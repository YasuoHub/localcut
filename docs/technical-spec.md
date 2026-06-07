# LocalCut Pro — 技术规格说明书

> 版本 1.0.0 | 2026-06-07

---

## 1. 项目概述

LocalCut Pro 是一个**纯前端本地图片裁剪/编辑工具**，核心功能包括：

- 多图层图片管理与合成
- 形状裁剪区域（矩形、圆形、三角形、菱形、星形、爱心、自定义多边形、圆角矩形）
- AI 智能抠图（MODNet 人像/物体分割）
- AI 超分辨率（APISR RRDB GAN ×2）
- 批量导出（支持多平台预设尺寸、自适应缩放、自定义命名）
- USM 锐化、文字标注、参考线系统

**技术栈**：Vue 3 + Pinia + TypeScript + Vite 6 + ONNX Runtime Web

**运行环境**：现代浏览器（Chrome/Edge 113+, Firefox 120+），需要 WebGPU 或 WASM 支持

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                        App.vue                           │
│  ┌──────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ TopBar   │  │  CanvasWorkspace │  │  RightSidebar │ │
│  │ 撤销/重做 │  │  ┌────────────┐  │  │  属性面板      │ │
│  │ 缩放/导出 │  │  │ 主 Canvas   │  │  │  导出设置      │ │
│  │ 快捷键    │  │  │ + 标尺      │  │  │  模板系统      │ │
│  └──────────┘  │  └────────────┘  │  └───────────────┘ │
│  ┌──────────┐  └──────────────────┘                     │
│  │LeftSidebar│                                          │
│  │ 工具面板  │  ┌──────────────────────────────┐        │
│  │ 图层面板  │  │    MattingWorkspace (子路由)  │        │
│  └──────────┘  │    智能抠图全屏工作区          │        │
│                └──────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘

数据流:
  Pinia Stores ──► Composables (引擎层) ──► Components (视图层)
       ▲                                           │
       └────────────── 用户交互 ──────────────────┘
```

### 2.1 Store 层（状态管理）

| Store | 文件 | 职责 |
|-------|------|------|
| `editor` | `src/stores/editor.ts` | 图层、区域、文本、工具状态、参考线、渲染触发 |
| `matting` | `src/stores/matting.ts` | 抠图源图、Mask、模型选择、笔刷、边缘设置 |
| `export` | `src/stores/export.ts` | 导出格式、尺寸、DPR、超分/锐化开关、命名模板 |
| `history` | `src/stores/history.ts` | 撤销/重做栈（最大 20 层快照） |

### 2.2 Composables 层（引擎）

| Composable | 文件 | 行数 | 职责 |
|-----------|------|------|------|
| `useCanvasEngine` | `src/composables/useCanvasEngine.ts` | ~1922 | 主画布渲染、交互（拖拽/缩放/绘制）、图层管理 |
| `useExport` | `src/composables/useExport.ts` | ~347 | 导出管线：合成→适配→超分→锐化→文字→裁剪→DPR→Blob |
| `useMaskEditing` | `src/composables/useMaskEditing.ts` | ~542 | Mask 笔刷编辑、增量合成、撤销/重做、边缘精修 |
| `useMattingInference` | `src/composables/useMattingInference.ts` | ~234 | 抠图模型加载、512×512 推理、结果合成 |
| `useSuperResolution` | `src/composables/useSuperResolution.ts` | ~276 | 超分模型加载、分块推理（512px tile + 16px overlap） |
| `useBatchRegions` | `src/composables/useBatchRegions.ts` | — | 网格/切片批量生成区域 |
| `useFilenamePattern` | `src/composables/useFilenamePattern.ts` | — | 自定义文件名模板解析 |
| `useCropTemplates` | `src/composables/useCropTemplates.ts` | — | 裁剪模板系统（localStorage 持久化） |

### 2.3 Worker 层

| Worker | 文件 | 职责 |
|--------|------|------|
| `mattingInference.worker` | `src/workers/mattingInference.worker.ts` | ONNX Runtime 抠图推理（MODNet, 512×512→全分辨率） |
| `mattingPostProcess.worker` | `src/workers/mattingPostProcess.worker.ts` | Mask 后处理（高斯模糊/膨胀/腐蚀，Transferable 零拷贝） |
| `superResolution.worker` | `src/workers/superResolution.worker.ts` | ONNX Runtime 超分推理（APISR RRDB GAN ×2） |

---

## 3. 渲染管线

### 3.1 主画布渲染流程

```
markDirty() → requestAnimationFrame(render) → [每帧完整重绘]
                                                    │
    ┌───────────────────────────────────────────────┤
    │ 1. clearRect 全画布                            │
    │ 2. 绘制棋盘格背景                               │
    │ 3. 遍历所有可见图层 (reverse, 底部→顶部)          │
    │    └─ ctx.drawImage(layer.workingCanvas, ...)   │
    │    └─ 绘制图层名称标签                           │
    │    └─ 多选图层蓝色虚线边框                        │
    │ 4. 活动图层蓝色虚线边框 + 8 个调整手柄             │
    │ 5. 参考线渲染 (虚线条)                           │
    │ 6. 遮罩层 (半透明黑色 + 区域镂空 evenodd)         │
    │ 7. 区域叠加 (每个区域: 路径 + 填充 + 标签 + 控制点) │
    │ 8. 文本标注渲染                                  │
    │ 9. 绘制预览 (虚线 + 半透明填充)                   │
    │ 10. 自定义多边形预览 (折线 + 顶点)                │
    │ 11. 自定义多边形顶点渲染                          │
    └───────────────────────────────────────────────┘
```

### 3.2 画布初始化

```
Canvas 尺寸 = container.clientWidth × devicePixelRatio
              container.clientHeight × devicePixelRatio
```

- 使用 `ResizeObserver` 监听容器变化，自动调整画布大小
- 2K 屏幕 (2560×1440, DPR=2)：画布约 5120×2880 ≈ 14.7M 像素
- 4K 屏幕 (3840×2160, DPR=2)：画布约 7680×4320 ≈ 33.2M 像素

### 3.3 抠图渲染管线

```
源图 → [缩放到 ≤4096px] → 512×512 推理输入 → Worker ONNX 推理
  → 阈值二值化 → 最近邻缩放回工作分辨率 → 合成透明结果
  → Mask 笔刷编辑 (offscreen canvas, 增量合成)
  → 边缘精修 Worker (高斯模糊/膨胀/腐蚀)
  → 最终透明 PNG
```

---

## 4. 性能瓶颈分析

### 🔴 Critical — 严重影响大画布/多图层场景

#### B1. 每帧全画布重绘，无脏矩形优化

- **位置**：`useCanvasEngine.ts:1447-1849` (`render()`)
- **问题**：`markDirty()` 触发后，整个画布（在 4K 屏幕上可达 33M 像素）完整重绘
- **影响**：每次鼠标移动（如拖拽图层）都触发全量 `clearRect` + 所有图层 `drawImage` + 所有区域路径绘制
- **典型耗时**：4K 屏幕 + 5 个 4K 图层，单帧渲染约 15-30ms → 仅 ~33-60fps，且为 CPU 密集操作阻塞主线程
- **改善方向**：
  - 实现脏矩形追踪（dirty rect tracking），仅重绘变化区域
  - 将图层渲染分离到独立 `OffscreenCanvas`，仅在变化时更新
  - 预合成静态图层到缓存 Canvas

#### B2. 历史快照全量复制 workingCanvas

- **位置**：`src/stores/history.ts:38-45` (`snapshotLayerStates()`)
- **问题**：每次快照对所有图层的 `workingCanvas` 做完整 `getImageData()`
- **数据量**：
  - 单个 4096×4096 图层：`4096×4096×4 = 67.1 MB` ImageData
  - 5 个图层：`335 MB` 单次快照
  - 20 层历史栈：理论峰值 `13.4 GB`（实际因 GC 波动在 2-4GB）
- **改善方向**：
  - 对 `workingCanvas` 做增量快照（仅记录 brush/eraser 修改的脏区域）
  - 使用 `ImageBitmap` + `createImageBitmap(canvas)` 替代 `getImageData()`（GPU 端存储，零拷贝）
  - 对未编辑图层共享同一个 `workingCanvas` 引用而非复制

#### B3. 图层渲染无分块缓存

- **位置**：`useCanvasEngine.ts:1478-1491`
- **问题**：每帧重绘所有图层，包括屏幕外区域，没有 tile cache
- **影响**：缩放/平移时，大量像素被绘制到屏幕外，浪费 GPU 带宽
- **改善方向**：为每个图层维护分块缓存（512×512 tiles），仅绘制屏幕可见分块

### 🟡 Moderate — 影响大尺寸导出/处理

#### B4. USM 锐化在主线程同步执行

- **位置**：`src/utils/imageSharpen.ts:95-133` (`unsharpMask()`)
- **问题**：对导出尺寸的完整 ImageData 执行可分离高斯模糊（两次 O(radius·N) pass）
- **数据量**：8000×8000 RGBA → 256M 像素 → 每次 pass 约 256M × (radius×2) 次浮点运算
- **改善方向**：将 USM 移到 Worker 线程，利用 Transferable 零拷贝传输

#### B5. 超分辨率分块处理大量 Canvas 创建/销毁

- **位置**：`src/composables/useSuperResolution.ts:178-206`
- **问题**：每个 tile 创建两个临时 Canvas + `getImageData`，大批量时 GC 压力大
- **改善方向**：复用 Canvas 对象池，使用 `ImageBitmap` 代替 Canvas 传递

#### B6. ONNX Runtime Web WASM 回退性能

- **位置**：`src/workers/mattingInference.worker.ts:20` / `superResolution.worker.ts:18`
- **问题**：无 WebGPU 环境时回退到 WASM，推理速度降低 2-5 倍
- **当前配置**：`executionProviders: ['webgpu', 'wasm']`，ONNX 自动选择
- **典型推理时间**：WebGPU ~500ms / WASM ~2-3s (MODNet 512×512)

### 🟢 Minor — 可控但值得注意

#### B7. `watch(layers, { deep: true })` 触发不必要的重渲染

- **位置**：`useCanvasEngine.ts:1864`
- **问题**：任何图层属性变化（包括 `visible`、`name` 等非视觉属性）都触发全量渲染
- **改善方向**：拆分为更细粒度的 watch，或使用 `shallowRef` + 手动触发

#### B8. Mask 编辑时的双层 Canvas 内存占用

- **位置**：`src/composables/useMaskEditing.ts` (maskCanvas + compositeCanvas + workingSource)
- **每个 Canvas 内存**（4096px）：各 67MB → 合计 ~200MB
- **当前已是优化后状态**：采用增量合成 + O(1) bounding box 合并替代原来的 O(n²) dirty rect

#### B9. 超分辨率模型固定 ×2 倍率

- **位置**：`src/composables/useSuperResolution.ts:10`
- **当前**：仅支持 2× 超分（APISR RRDB GAN x2, 4.72MB）
- **限制**：无法进行 4× 超分（需级联调用或换模型）

---

## 5. 量级支持能力

### 5.1 图像分辨率

| 场景 | 上限 | 说明 |
|------|------|------|
| **图层导入** | 无硬编码限制 | 受浏览器内存限制 |
| **画布显示** | 取决于屏幕 + DPR | 4K×2 = 7680×4320 canvas |
| **抠图工作分辨率** | **4096px 最大边** | `WORKING_MAX_DIM = 4096`，`mattingImageUtils.ts:1` |
| **抠图推理输入** | **512×512** | MODNet 模型固定尺寸 |
| **导出分辨率** | 原始完整分辨率 | 仅在导出时解算全分辨率 |
| **超分输出** | 输入 × 2 | 512px tile，支持大图分块 |

### 5.2 图层数量

| 指标 | 理论值 | 实际推荐 |
|------|--------|----------|
| 最大图层数 | 无硬编码限制 | **5-10 层**（4K 图像） |
| 单层 4K 内存 | ~134 MB（image + workingCanvas） | — |
| 10 层 4K 内存 | ~1.34 GB | 接近浏览器标签页限制 |

### 5.3 裁剪区域

| 指标 | 容量 |
|------|------|
| 最大区域数 | 无硬编码限制 |
| 批量生成 | 支持网格/切片/复制 |
| 区域形状 | 8 种（矩形/圆角矩形/圆形/三角形/菱形/星形/爱心/自定义多边形） |

### 5.4 历史记录

| 指标 | 值 |
|------|-----|
| 撤销栈深度 | **20 层** |
| 单次快照内容 | 所有区域 + 文本 + 图层状态 + workingCanvas ImageData |

### 5.5 模型文件

| 模型 | 文件 | 大小 | 用途 |
|------|------|------|------|
| MODNet quantized | `model_quantized.onnx` | ~6-8 MB | 抠图（int8 量化） |
| MODNet fp16 | `model_fp16.onnx` | ~12-15 MB | 抠图（半精度） |
| APISR RRDB GAN x2 | `apisr_rrdb_gan_x2_quantized.onnx` | 4.72 MB | 超分（量化） |
| ORT WASM Runtime | `/wasm/` 目录 | ~8-10 MB | ONNX Runtime Web WASM 后端 |

### 5.6 导出格式

| 格式 | 质量 | 通道 | 说明 |
|------|------|------|------|
| PNG | 无损 | RGBA | 支持透明 + DPI 元数据注入（72 DPI phys chunk） |
| JPEG | 1-100 | RGB | 有损，自动去透明背景 |
| WebP | 1-100 | RGBA | 有损/无损 |

---

## 6. 关键数值汇总

| 参数 | 值 | 位置 |
|------|-----|------|
| 画布 DPR 策略 | `window.devicePixelRatio` 全精度 | `useCanvasEngine.ts:1877-1878` |
| 画布缩放步长 | 0.1× (滚轮) | `useCanvasEngine.ts` `handleWheel` |
| 画布最小缩放 | 0.05× | `useCanvasEngine.ts` |
| 画布最大缩放 | 50× | `useCanvasEngine.ts` |
| 图层调整手柄大小 | 12px | `useCanvasEngine.ts:817` |
| 区域控制点大小 | 8px (CP_SIZE) | `useCanvasEngine.ts:14` |
| 抠图工作分辨率上限 | 4096px | `mattingImageUtils.ts:1` |
| 抠图推理输入 | 512×512 | `useMattingInference.ts:133` |
| Mask 笔刷最小步长 | radius × 0.25 | `useMaskEditing.ts:305` |
| 笔刷笔触插值 | 二次贝塞尔 (Quadratic Bezier) | `useMaskEditing.ts:314-318` |
| 超分 Tile 大小 | 512px | `useSuperResolution.ts:8` |
| 超分 Tile 重叠 | 16px | `useSuperResolution.ts:9` |
| USM 默认半径 | 2px | `imageSharpen.ts:98` |
| 历史栈上限 | 20 | `history.ts:25` |
| Mask 历史上限 | 20 | `useMaskEditing.ts:49` |
| 导出默认 DPR | 2 | `export.ts:11` |
| 导出默认质量 | 90 | `export.ts:9` |

---

## 7. 架构评审结论

### 优点

1. **Worker 采用正确**：抠图推理、Mask 后处理、超分推理均使用独立 Worker，避免阻塞主线程
2. **Transferable 零拷贝**：Mask 数据、模型数据在 Worker 间使用 Transferable 传递
3. **智能 DPR 上限**：导出时自动计算源像素比（`computeSourcePixelRatio`），避免无意义放大
4. **笔触增量合成优化良好**：O(1) bounding box 合并 + 单次 compositing，替代了原有的 O(n²) dirty rect 方案
5. **IndexedDB 模型缓存**：抠图和超分模型均缓存到 IndexedDB，二次加载无需下载
6. **增量 Mask 同步**：`syncMaskFromCanvas` 仅读取笔触区域，非全量

### 短板（按优先级排序）

1. ⭐ **主画布全帧重绘** — 最大的性能瓶颈，影响所有交互的流畅度
2. ⭐ **历史快照全量 getImageData** — 大图时快照操作可阻塞数百毫秒
3. ⭐ **无图层分块缓存** — 缩放/平移时浪费大量 GPU 带宽
4. 导出 USM 锐化阻塞主线程 — 大尺寸导出时明显
5. ONNX WASM 回退性能差 — 取决于用户浏览器

### 推荐优化路线

| 阶段 | 优化项 | 预期收益 | 复杂度 |
|------|--------|----------|--------|
| Phase 1 | 画布脏矩形追踪 | 拖拽/绘制帧率提升 2-3× | 中 |
| Phase 1 | 历史快照 ImageBitmap 替代 ImageData | 快照时间降低 80%+ | 低 |
| Phase 2 | 图层 OffscreenCanvas + 分块缓存 | 缩放/平移流畅度大幅提升 | 高 |
| Phase 2 | USM 锐化移至 Worker | 导出不阻塞 UI | 低 |
| Phase 3 | WebGPU 画布渲染（如果可用） | 整体渲染性能提升 2-5× | 高 |
