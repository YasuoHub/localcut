# 电商运营批量切图功能开发文档

版本：V0.3  
日期：2026-06-05  
适用项目：LocalCut Pro  
目标：在现有 Vue/Pinia/Canvas 架构上，低复杂度扩展“电商运营批量切图”能力

## 1. 文档审查结论

V0.2 的方向基本正确，但存在一定“委曲求全”：为了不动现有架构，把部分真正服务电商批量切图的能力放得过于靠后。若产品目标明确是“电商运营批量切图”，则应允许适度调整 UI 结构和代码组织，而不是把所有能力都挤进现有右侧栏逻辑里。

V0.3 的修正立场：

- 电商运营批量切图的核心不是“画布编辑”，而是“批量生成裁剪区域、统一导出、自动命名、模板复用”。
- 模板保存/复用和常用尺寸预设应进入第一阶段，而不是被视作远期能力。
- 可以适度拆分 `RightSidebar.vue`，新增批处理相关 composable 或轻量 store，但不要引入复杂任务队列。
- 暂不做 SKU/颜色字段、云端同步、模板市场、多图片 job 队列，这些才是真正容易发散的方向。

上一版需要继续保留的收敛点：

- 不应把产品做成“大型图片编辑器”或“复杂批量任务系统”。当前目标是让运营更快完成规则切图、命名和导出。
- 不应过早引入多图片 job 队列、平台深度规则、SKU 字段系统、云端模板同步。这些会显著抬高复杂度，但对第一版付费验证帮助有限。
- 技术实现必须围绕现有 `editor.regions`、`editor.layers`、`useExport.ts`、`export store` 扩展，优先新增可复用 composable，避免新增大而全 store。

因此，V0.3 将功能分为三层：

- MVP 必做：文件命名规则、固定尺寸批量导出、网格生成、等距复制、长图切片、裁剪模板保存/复用、常用尺寸预设。
- MVP 暂不做：多图片 job 队列、SKU/颜色字段、平台深度规则、云端模板同步。
- 后续验证后再做：多图片批量任务、模板分类、模板导入导出、平台规则配置化。

## 2. 产品目标边界

本项目的商业化目标不是替代 Canva、Photopea 或 Photoshop，而是服务一个更窄的工作流：

```text
导入图片 -> 快速生成多个裁剪区域 -> 统一尺寸 -> 自动命名 -> 批量导出 ZIP
```

新增功能必须满足以下原则：

- 少手动重复：减少逐个裁剪、另存、改名。
- 低学习成本：功能入口集中在右侧面板，不新增复杂页面。
- 可撤销：所有批量生成和破坏性操作都要先 `history.snapshot()`。
- 可复用：区域生成、命名、尺寸适配都写成独立 composable。
- 不破坏现有模型：继续使用 `CropRegion`、`ImageLayer`、`editor.regions` 和 `useExport.ts`。

## 3. 当前代码基础

现有代码中可直接复用的能力：

- `src/stores/editor.ts`
  - `layers`、`activeLayer`、`activeLayerId`
  - `regions`、`selectedRegion`、`selectedRegionIds`
  - `addLayer`、`removeLayer`、`renameLayer`、`moveLayerUp`、`moveLayerDown`
  - `toggleLayerVisible`、`deleteRegion`、`clearRegions`
- `src/stores/export.ts`
  - `exportFormat`
  - `exportQuality`
  - `customOutputSize`
  - `exportOutputWidth`
  - `exportOutputHeight`
  - `exportLockAspect`
  - `exportDpr`
- `src/composables/useExport.ts`
  - `exportSingleRegion`
  - `exportRegions`
  - 图层合成导出
  - 文字绘制
  - ZIP 打包
- `src/components/RightSidebar.vue`
  - 当前最适合承载批处理和导出设置入口

重要约束：

- 当前裁剪区域 `CropRegion` 是画布世界坐标，不绑定某个图层。
- 图层 `ImageLayer` 有 `x/y/scaleX/scaleY`，导出时需要做世界坐标到图层源图坐标转换。
- 文字 `TextAnnotation` 也是画布世界坐标。

## 4. 总体 UI 布局

第一版仍然不要做多个页面，但允许拆分右侧栏组件。原因是电商批量切图能力会长期增长，如果继续把所有逻辑堆在 `RightSidebar.vue`，会很快变成维护负担。

推荐 UI 结构：

```text
图层
区域属性 / 文字属性
批量切图
  网格生成
  等距复制
  长图切片
  模板
导出设置
  平台/尺寸
  文件命名
裁剪区域列表
批量导出按钮
```

实现建议：

- 第一阶段就拆组件，但不拆页面。
- `RightSidebar.vue` 负责组装，不承载批量逻辑。
- 纯算法放 composable，UI 状态放组件或轻量 batch store。
- 不建议新增左侧工具图标，因为这些不是画布绘制工具，而是批量区域生成工具。

建议新增组件：

```text
src/components/right/BatchCutPanel.vue
src/components/right/ExportNamingPanel.vue
src/components/right/ExportSizePanel.vue
src/components/right/TemplatePanel.vue
```

如果暂时不想创建 `right` 子目录，也可以直接放在 `src/components`，但命名要清晰。

## 5. 新增公共模块

### 5.1 `useBatchRegions.ts`

新建：`src/composables/useBatchRegions.ts`

职责：

- 生成网格区域。
- 等距复制区域。
- 生成长图切片区域。
- 保存/套用裁剪模板。
- 生成唯一 region 名称。
- 提供基础校验。

这个文件只负责“返回 CropRegion[]”，不直接修改 store。调用方负责：

```ts
history.snapshot()
editor.regions.push(...newRegions)
editor.selectedRegionIds.clear()
```

这样保持函数纯净，方便测试和复用。

### 5.2 `useFilenamePattern.ts`

新建：`src/composables/useFilenamePattern.ts`

职责：

- 解析命名规则。
- 生成文件名预览。
- 清洗非法文件名字符。
- 处理重复文件名。
- 校验未知变量。

这个文件不依赖 Vue store，只接收 context。

### 5.3 `useExportFit.ts`

可选新建：`src/composables/useExportFit.ts`

如果实现较少，也可以先放在 `useExport.ts` 内部。

职责：

- original / cover / contain / stretch 四种输出适配。
- 背景色填充。
- 计算目标画布尺寸。

### 5.4 `useCropTemplates.ts`

新建：`src/composables/useCropTemplates.ts`

职责：

- 保存当前区域为模板。
- 套用模板到当前活动图层。
- 从 `localStorage` 读取/写入模板。
- 删除模板。
- 生成模板预览名称。

说明：

- 模板是电商批量切图的核心能力，应进入 MVP。
- 第一版模板只做本地浏览器持久化，不做云端同步。
- 模板逻辑不要放进 `editor store`，避免把“当前画布状态”和“跨图片用户配置”混在一起。

### 5.5 可选 `batch store`

如果 `BatchCutPanel.vue` 内局部状态过多，可新建：

```text
src/stores/batch.ts
```

仅保存 UI 配置：

```ts
gridOptions
duplicateOptions
sliceOptions
selectedTemplateId
```

不要在 `batch store` 中保存导出的图片结果、Canvas、Blob 或复杂任务队列。

## 6. 类型扩展

位置：`src/types/index.ts`

建议新增以下类型，不要把类型散落在组件里：

```ts
export type BatchOutputFitMode = 'original' | 'cover' | 'contain' | 'stretch'

export interface GridOptions {
  rows: number
  cols: number
  startX: number
  startY: number
  cellWidth: number
  cellHeight: number
  gapX: number
  gapY: number
  shape: ShapeType
  namePrefix: string
}

export interface DuplicateOptions {
  count: number
  mode: 'horizontal' | 'vertical' | 'custom'
  gapX: number
  gapY: number
  deltaX: number
  deltaY: number
}

export interface SliceOptions {
  startY: number
  endY: number | null
  sliceHeight: number
  overlap: number
  namePrefix: string
}

export interface FilenameContext {
  imageName: string
  regionName: string
  index: number
  width: number
  height: number
  format: string
  date: string
}

export interface CropTemplate {
  id: string
  name: string
  createdAt: number
  baseRect: { x: number; y: number; width: number; height: number }
  regions: CropTemplateRegion[]
}

export interface CropTemplateRegion {
  name: string
  shape: ShapeType
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
  pointsRatio?: { x: number; y: number }[]
}
```

说明：

- 模板使用 `baseRect`，而不是只存 `baseWidth/baseHeight`。原因是当前区域是画布世界坐标，活动图层可能有 `x/y` 偏移。
- 模板坐标应相对 `baseRect.x/y` 存比例，避免套用到有偏移图层时错位。

## 7. ExportStore 扩展

位置：`src/stores/export.ts`

建议只保存“导出相关状态”，不要保存模板列表、平台预设列表。

新增：

```ts
const batchUseCustomSize = ref(false)
const batchOutputWidth = ref<number | null>(800)
const batchOutputHeight = ref<number | null>(800)
const batchFitMode = ref<BatchOutputFitMode>('cover')
const batchFillColor = ref('#ffffff')

const filenamePattern = ref('{imageName}_{regionName}_{index:3}')
const selectedPlatformPresetId = ref<string | null>(null)
```

不要放入 `export store` 的内容：

- 模板列表：建议先由 `useCropTemplates.ts` 管理，后续再考虑 store。
- 平台预设列表：放 `src/constants/platformPresets.ts`。
- 批量任务队列：暂缓。

## 8. 功能一：文件命名规则

### 8.1 目标判断

这是最贴合产品目标的功能，优先级最高。运营付费点之一就是不用批量改名。

### 8.2 功能位置

右侧栏 `导出设置` 内，放在格式/尺寸之后、导出按钮之前。

```text
文件命名
命名规则 [ {imageName}_{regionName}_{index:3} ]
[图片名] [区域名] [序号] [宽高] [日期] [格式]
预览
  demo_main_001.png
  demo_detail_002.png
  demo_badge_003.png
```

### 8.3 状态

新增到 `export store`：

```ts
filenamePattern
```

### 8.4 变量

第一版只支持：

```text
{imageName}
{regionName}
{index}
{index:2}
{index:3}
{width}
{height}
{format}
{date}
```

不要做：

- `{sku}`
- `{color}`
- `{platform}`
- 自定义字段表单

这些会引出商品数据管理，偏离 MVP。

### 8.5 实现逻辑

文件：`src/composables/useFilenamePattern.ts`

```ts
export function buildFilename(pattern: string, context: FilenameContext): string
export function sanitizeFilename(name: string): string
export function ensureUniqueFilename(name: string, used: Set<string>): string
export function validateFilenamePattern(pattern: string): { valid: boolean; unknownKeys: string[] }
export function previewFilenames(pattern: string, contexts: FilenameContext[], ext: string): string[]
```

清洗规则：

```ts
function sanitizeFilename(name: string) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned || 'untitled'
}
```

重名规则：

```text
name.png
name_2.png
name_3.png
```

### 8.6 接入导出

修改 `useExport.ts`：

- `exportSingleRegion` 增加可选 `filename` 或 `filenameOptions` 参数。
- `exportRegions` 在循环内生成 ZIP 文件名。
- 不要让 `useExport.ts` 直接读取 Pinia store，保持函数入参驱动。

建议入参：

```ts
interface ExportNamingOptions {
  pattern: string
  imageName: string
}
```

### 8.7 验收

- 默认命名规则生成可读文件名。
- `{index:3}` 正确生成 `001`。
- 非法字符替换为 `_`。
- 重名自动追加 `_2`。
- 单区域导出和批量导出共用规则。

## 9. 功能二：固定尺寸批量导出

### 9.1 目标判断

强相关。电商图片经常要求固定尺寸，如 800x800、1080x1080。

### 9.2 功能位置

右侧 `导出设置` 内，放在现有“自定义输出尺寸”下方。

```text
批量输出尺寸
[ ] 批量导出使用统一尺寸
宽度 [800] 高度 [800]
适配 [裁切填满 / 完整包含 / 拉伸]
背景色 [#ffffff]
```

### 9.3 状态

新增到 `export store`：

```ts
batchUseCustomSize
batchOutputWidth
batchOutputHeight
batchFitMode
batchFillColor
```

### 9.4 实现逻辑

不要把 fit 逻辑塞进组件。应在 `useExport.ts` 或 `useExportFit.ts` 中实现：

```ts
function fitCanvasToSize(
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  mode: BatchOutputFitMode,
  fillColor: string,
): HTMLCanvasElement
```

流程：

1. 先用当前 `renderRegionToCanvas` 生成原始区域 canvas。
2. 如果 `mode === 'original'`，直接返回。
3. 创建目标 canvas。
4. `contain`：填充背景色，完整显示 source。
5. `cover`：保持比例填满，居中裁掉多余部分。
6. `stretch`：拉伸到目标尺寸。

注意：

- 当前 `renderRegionToCanvas` 已经支持 `outputWidth/outputHeight`，但它是直接缩放，不足以表达 contain/cover 的背景填充和裁切。建议先渲染原始区域，再做 fit。
- 批量导出默认用这个逻辑；单区域导出可以暂时保持现有自定义尺寸逻辑。

### 9.5 验收

- 批量导出可统一 800x800。
- contain 有背景填充。
- cover 无白边但可能裁切。
- stretch 强制拉伸。
- 未开启统一尺寸时保持现有原始区域尺寸。

## 10. 功能三：网格批量生成裁剪框

### 10.1 目标判断

强相关，适合商品宫格图、素材拼图，是低复杂度高价值功能。

### 10.2 功能位置

右侧 `批量生成` section。

```text
网格生成
行数 [3] 列数 [4]
起始 X [0] 起始 Y [0]
单元宽 [800] 单元高 [800]
横间距 [0] 纵间距 [0]
命名前缀 [grid]
[追加生成] [替换生成]
```

第一版只生成矩形。不要支持圆形、星形等复杂形状。电商宫格切图主要用矩形，少一个选项反而更清楚。

### 10.3 实现逻辑

文件：`src/composables/useBatchRegions.ts`

```ts
export function generateGridRegions(options: GridOptions): CropRegion[]
```

算法：

```ts
for row:
  for col:
    x = startX + col * (cellWidth + gapX)
    y = startY + row * (cellHeight + gapY)
```

命名：

```text
grid_001
grid_002
```

调用方：

```ts
history.snapshot()
if (replace) editor.clearRegions()
editor.regions.push(...regions)
```

### 10.4 验收

- 3 行 4 列生成 12 个矩形区域。
- 支持追加/替换。
- 支持撤销。
- 不生成重复 id。

## 11. 功能四：等距复制区域

### 11.1 目标判断

强相关。它是网格生成的灵活补充。

### 11.2 功能位置

只在 `editor.selectedRegion` 存在时显示，放在区域属性下方。

```text
等距复制
方向 [横向 / 纵向 / 自定义]
数量 [5]
间距 [20]
[复制]
```

第一版 UI 简化：

- 横向和纵向只需要一个“间距”。
- 自定义模式再显示 `X 偏移`、`Y 偏移`。

### 11.3 实现逻辑

文件：`src/composables/useBatchRegions.ts`

```ts
export function duplicateRegionBySpacing(
  region: CropRegion,
  options: DuplicateOptions,
): CropRegion[]
```

注意：

- 多边形 `points` 必须同步平移。
- 新区域 `id` 必须重新生成。
- 名称必须唯一。
- 不直接修改原 region。

### 11.4 验收

- 横向复制按 `region.width + gap` 平移。
- 纵向复制按 `region.height + gap` 平移。
- 多边形顶点正确平移。
- 操作可撤销。

## 12. 功能五：长图按高度切片

### 12.1 目标判断

强相关，适合详情页长图切片。

### 12.2 功能位置

右侧 `批量生成` section。

```text
长图切片
切片高度 [1000]
起始 Y [0]
结束 Y [自动]
重叠 [0]
命名前缀 [slice]
[生成切片]
```

### 12.3 实现逻辑

以当前活动图层的显示矩形作为默认范围：

```ts
const baseRect = {
  x: layer.x,
  y: layer.y,
  width: layer.image.naturalWidth * layer.scaleX,
  height: layer.image.naturalHeight * layer.scaleY,
}
```

生成区域：

```ts
let currentY = baseRect.y + startY
const finalY = endY == null ? baseRect.y + baseRect.height : baseRect.y + endY

while (currentY < finalY) {
  const h = Math.min(sliceHeight, finalY - currentY)
  create rect:
    x = baseRect.x
    y = currentY
    width = baseRect.width
    height = h
  currentY += sliceHeight - overlap
}
```

校验：

- `sliceHeight > 0`
- `overlap >= 0`
- `overlap < sliceHeight`
- 必须有 `editor.activeLayer`

### 12.4 验收

- 3000px 高图按 1000px 生成 3 个区域。
- 最后一片可不足指定高度。
- 生成后可手动调整区域。
- 操作可撤销。

## 13. 功能六：裁剪模板保存/复用

### 13.1 目标判断

强相关，应进入 MVP。电商运营处理同版式图片时，模板复用是减少重复劳动的关键能力。它确实会引入持久化、比例换算、图层偏移等复杂度，但这些复杂度是为产品目标服务的，不属于过度设计。

边界：

- 第一版只做本地模板。
- 第一版只保存区域布局，不保存复杂导出配置。
- 第一版不做模板分类、云端同步、模板市场。

### 13.2 功能位置

右侧 `批量生成` section 末尾。

```text
模板
模板名 [商品宫格]
[保存当前区域为模板]
模板选择 [商品宫格 v]
[套用模板]
```

第一版不要做：

- 云端同步。
- 模板分类。
- 模板市场。
- 模板携带复杂导出设置。

### 13.3 数据存储

不建议把模板列表直接放进 `editor store`。原因：

- `editor store` 当前是当前画布状态。
- 模板是跨项目/跨图片的用户配置。

第一版建议：

- 新建 `src/composables/useCropTemplates.ts`
- 内部用 `ref<CropTemplate[]>`
- 使用 `localStorage` 做轻量持久化

后续如果模板功能变重，再独立成 `stores/templates.ts`。

### 13.4 坐标逻辑

模板必须基于 `baseRect`，不能只按图片宽高存比例。

保存：

```ts
const baseRect = getActiveLayerDisplayRect()

xRatio = (region.x - baseRect.x) / baseRect.width
yRatio = (region.y - baseRect.y) / baseRect.height
widthRatio = region.width / baseRect.width
heightRatio = region.height / baseRect.height
```

多边形点：

```ts
xRatio = (point.x - baseRect.x) / baseRect.width
yRatio = (point.y - baseRect.y) / baseRect.height
```

套用：

```ts
x = targetBaseRect.x + xRatio * targetBaseRect.width
y = targetBaseRect.y + yRatio * targetBaseRect.height
width = widthRatio * targetBaseRect.width
height = heightRatio * targetBaseRect.height
```

### 13.5 验收

- 活动图层有偏移时保存/套用不跑偏。
- 同版式不同分辨率图片可套用。
- 多边形顶点可正确还原。
- 支持撤销。

## 14. 功能七：平台尺寸预设

### 14.1 目标判断

轻量预设有价值，但“平台深度规则”容易过度设计。平台规则会变，且不同店铺要求不同。第一版只做“常用尺寸预设”。

### 14.2 功能位置

右侧 `导出设置` 内，放在批量输出尺寸上方。

```text
尺寸预设 [通用 800x800 方图 v]
```

### 14.3 实现方式

新建：

```text
src/constants/platformPresets.ts
```

不要放进 `editor store`。

示例：

```ts
export const PLATFORM_PRESETS = [
  { id: 'square-800', group: '通用', name: '800x800 方图', width: 800, height: 800 },
  { id: 'square-1080', group: '通用', name: '1080x1080 方图', width: 1080, height: 1080 },
  { id: 'vertical-750-1000', group: '通用', name: '750x1000 竖图', width: 750, height: 1000 },
]
```

选择后：

```ts
exp.selectedPlatformPresetId = preset.id
exp.batchUseCustomSize = true
exp.batchOutputWidth = preset.width
exp.batchOutputHeight = preset.height
```

第一版不要自动改文件命名规则。命名规则是用户显式配置，预设自动改命名会造成困惑。

### 14.4 验收

- 选择预设后批量尺寸自动填充。
- 用户可以继续手动改尺寸。
- 不清空区域，不影响图层。

## 15. 功能八：批量处理工作流

### 15.1 目标判断

上一版写的 `BatchJobStore` 对当前阶段过度设计。真正的多图片任务队列会改变产品模型：现在图片是图层，任务队列则是多个独立项目。这个不应放进第一版。

### 15.2 第一版工作流

第一版只做“当前画布批量导出”：

```text
导入图片/图层
生成区域
设置尺寸
设置命名
批量导出 ZIP
```

不做：

- 多图片 job 列表。
- 每张图独立 regions。
- 批量任务状态 pending/done/error。
- ZIP 内按图片分文件夹。

### 15.3 后续再做的条件

只有当用户明确反馈“我有几十张同版式图，需要一键套模板分别导出”时，再引入 `BatchJobStore`。

第二阶段可以设计为：

```text
批量导入 -> 每张图作为 job -> 套模板 -> 分文件夹导出 ZIP
```

但这不是当前 MVP。

## 16. 推荐开发顺序

更稳的顺序：

1. 修基础一致性：画笔、魔棒、导出在图层偏移/缩放下坐标一致。
2. 文件命名规则。
3. 固定尺寸批量导出。
4. 网格批量生成。
5. 等距复制。
6. 长图切片。
7. 裁剪模板保存/复用。
8. 轻量尺寸预设。
9. 根据真实反馈再考虑多图片任务队列。

说明：

- 先修坐标一致性，是为了避免后续所有批量功能都建立在不稳定基础上。
- 命名和尺寸是导出闭环，是最直接的商业价值。
- 网格、等距、切片都是生成 `CropRegion`，可以共用一套 `useBatchRegions.ts`。
- 模板必须做，但只做本地轻量模板。
- 多图片任务队列不要过早做重。

## 16.1 第一阶段里程碑

为了避免“功能都写了一点但不能形成产品价值”，第一阶段按可交付闭环拆成三个小里程碑。

### M1：批量导出出口

目标：先让导出的文件可直接交付。

包含：

- 文件命名规则。
- 固定尺寸批量导出。
- 常用尺寸预设。

交付标准：

- 运营可以选择 `800x800` 等常用尺寸。
- 批量导出文件名可读、可控、不重名。
- ZIP 内容可以直接上传或交付。

### M2：批量生成区域

目标：减少手工圈选。

包含：

- 网格生成。
- 等距复制。
- 长图切片。

交付标准：

- 宫格图、横排商品图、详情页长图都能快速生成区域。
- 生成后的区域仍可手动微调。

### M3：模板复用

目标：让同版式图片可以重复处理。

包含：

- 保存当前区域为模板。
- 套用模板。
- 本地模板持久化。

交付标准：

- 同一版式的第二张图无需重新圈选。
- 模板使用活动图层 `baseRect`，移动或缩放图层后不跑偏。

## 17. 代码风格要求

新增代码遵守以下规则：

- 组件只负责 UI 状态和调用，不承载复杂算法。
- 批量生成函数返回数据，不直接改 Pinia。
- 导出函数继续使用入参驱动，不直接读取 Pinia。
- 所有批量修改前由调用方执行 `history.snapshot()`。
- 新类型统一放 `src/types/index.ts`。
- 常量放 `src/constants/*`。
- 文件命名、尺寸适配、区域生成分别独立，避免互相耦合。
- 不引入新依赖，除非现有 Canvas/JS 无法合理实现。

## 18. 最小可上线版本

第一版建议包含：

- 文件命名规则。
- 固定尺寸批量导出。
- 网格生成。
- 等距复制。
- 长图切片。
- 本地裁剪模板。
- 常用尺寸预设。

这 7 个功能可以形成明确的电商运营批量切图闭环：规则生成、模板复用、统一尺寸、自动命名、批量导出。

暂缓：

- 多图片任务队列。
- 平台深度规则。
- SKU/颜色/商品字段。
- 云端模板同步。
- 模板市场。
- 图层级复杂绑定关系。

## 19. 最终判断

这 8 个功能没有整体偏离产品目标。V0.2 的问题是稍微保守，把模板复用放得太靠后。若产品目标明确是电商运营批量切图，模板复用应该进入 MVP，因为它直接减少重复劳动。

当前最重要的工程原则是：允许为了“批量切图工作流”适度调整架构，但不要把产品推向复杂图片编辑器，也不要把代码推向复杂任务系统。第一版应坚定完成“区域批量生成 + 模板复用 + 统一尺寸 + 自动命名 + ZIP 导出”这条闭环。
