# LocalCut Pro SEO / GEO 改造方案

版本：v1.0
日期：2026-06-11
正式域名：https://www.xion188.xyz/

## 1. 核心定位

LocalCut Pro 的搜索定位不应写成泛泛的“图片编辑器”或“在线设计工具”，而应聚焦在更容易转化的窄场景：

> 面向电商运营、店铺美工和内容团队的本地批量切图与素材交付工具，支持 PSD / PSB / 常见图片导入，批量生成裁切区域，统一尺寸导出，自动命名，并本地打包 ZIP。

优先覆盖的搜索意图：

- 电商批量切图工具
- PSD / PSB 导入切图
- 商品图批量裁切
- 详情页长图切片
- 图片统一尺寸导出
- 图片批量自动命名
- 本地图片处理和 ZIP 交付

不建议优先竞争的宽泛词：

- 图片编辑器
- 在线设计工具
- AI 修图工具
- Photoshop 替代品

这些宽泛词竞争大、意图散，而且容易把用户预期带到“全功能修图软件”，不利于 LocalCut Pro 当前的付费转化。

## 2. 已完成的站内 SEO 改造

当前 `landingPage/index.html` 已完成以下基础改造：

- 已按正式域名 `https://www.xion188.xyz/` 补充 canonical、Open Graph URL、结构化数据 URL 和社交分享图片绝对地址。
- 已补充社交分享图片的类型、尺寸和替代文本。
- 更新页面 `<title>`，突出 `PSD/PSB 导入` 和 `电商图片批量切图工具`。
- 更新 meta description，覆盖导入、批量裁切、统一尺寸、自动命名和 ZIP 交付。
- 增加 Open Graph 和 Twitter Card 元数据，便于分享时显示标题、描述和产品截图。
- 增加 `SoftwareApplication`、`Organization`、`WebSite`、`FAQPage` JSON-LD 结构化数据。
- 在首屏、功能区、流程区和 FAQ 中补充 PSD / PSB、批量切图、统一导出、自动命名、本地 ZIP 等核心词。
- 增加可见的 SEO 说明区，而不是隐藏堆词。
- 增加可见 FAQ，并与 FAQPage 结构化数据保持一致。
- 增加 `landingPage/llms.txt`，作为 AI/LLM 可读的产品摘要入口。
- 增加 `landingPage/robots.txt` 和 `landingPage/sitemap.xml`，上线时应发布到正式站点根目录。
- 结构化数据只描述已确认事实；免费试用不再错误标记为软件售价 `0`。
- 将“下载使用”调整为“联系免费试用”，并在联系弹层展示微信号 `lhc0820yyds`。

## 3. 下一轮 SEO 改造建议

### 3.1 发布前技术项

- 已完成：正式域名绝对 URL：
  - `canonical`: `https://www.xion188.xyz/`
  - `og:url`: `https://www.xion188.xyz/`
  - 结构化数据中的 `url` 和 `@id`
  - `image`: `https://www.xion188.xyz/assets/localcut-pro-app.png`
- 上线时确认以下文件位于正式站点根目录：
  - `/llms.txt`
  - `/robots.txt`
  - `/sitemap.xml`
- 用 Google Rich Results Test 校验 JSON-LD。
- 用 Search Console 提交站点地图。
- 给产品截图使用稳定文件名和描述性 alt，例如“LocalCut Pro 批量切图界面”。
- 压缩首屏产品截图，避免落地页加载过慢。

### 3.2 内容页矩阵

当前只有单页落地页，适合 MVP 宣传，但长期 SEO 需要围绕核心场景拆页面：

| 页面 | 目标关键词 | 内容方向 |
|---|---|---|
| `/psd-psb-batch-cut/` | PSD 批量切图、PSB 批量切图 | 解释 PSD/PSB 导入后如何生成裁切区域并导出 |
| `/ecommerce-image-batch-crop/` | 电商图片批量裁切、商品图批量切图 | 商品主图、活动图、详情图的批量处理流程 |
| `/long-image-slicing/` | 详情页长图切片、长图切图工具 | 长图切片、平台尺寸、命名和交付 |
| `/image-naming-export/` | 图片自动命名、批量导出 ZIP | 命名规则、预览、交付包规范 |
| `/local-image-workflow/` | 本地图片处理工具 | 本地处理、安全、无需上传素材 |

每个页面都应包含：

- 一句话定义这个场景是什么。
- 真实流程：导入、生成区域、设置尺寸和命名、预览、导出。
- 对比说明：为什么比手工 Photoshop / Figma / Canva 流程更短。
- FAQ：3-5 个真实问题。
- 联系免费试用 CTA。

### 3.3 内容表达原则

- 少写“强大、智能、一键”等空泛词，多写可验证的动作。
- 每个核心卖点都绑定一个具体结果：
  - PSD/PSB 导入：设计源文件也能进入交付流程。
  - 批量切图：一张图多个区域不用逐个裁。
  - 统一尺寸：导出文件规格一致，减少返工。
  - 自动命名：文件交付更可控。
  - 本地 ZIP：素材处理和交付更集中。
- 不承诺无法证明的效果，例如“提升 10 倍效率”，除非后续有真实案例或录屏对比。

## 4. GEO / AI 搜索改造调研结论

截至 2026-06-11，GEO 不应被理解成一套脱离 SEO 的黑盒技巧。Google 官方说明是：AI Overviews / AI Mode 仍然依赖基础 SEO、可索引页面、符合搜索政策、对用户有帮助的内容；没有额外的特殊标记要求，也不需要为了 AI 搜索重写成某种固定格式。

可执行结论：

- 基础 SEO 仍是 GEO 的地基：页面必须可抓取、可索引、可摘要。
- 结构化数据有价值，但不是 AI 搜索的“专用通行证”。
- 清晰标题、FAQ、表格、流程、定义句，会更利于搜索和 AI 摘要理解。
- 不要为了 AI 搜索机械拆碎内容；页面结构应服务真实用户。
- 不要做虚假提及或批量灌水外链；AI 搜索同样依赖质量和可信度。
- Bing 已在 Webmaster Tools 公测 AI Performance，可用它观察页面被 Copilot / Bing AI 引用的情况。
- `llms.txt` 是一个正在被行业采用的提案，适合作为补充入口，但不能替代传统 SEO、站点地图或结构化数据。

## 5. LocalCut Pro 的 GEO 落地路线

### P0：当前已落地

- `llms.txt`：提供产品简介、目标用户、核心功能、典型流程和联系方式。
- `FAQPage`：把真实问题转成机器可读问答。
- 可见 FAQ：让用户和 AI 都能看到同一份问答内容。
- `SoftwareApplication`：明确 LocalCut Pro 是软件工具，而不是普通文章页。

### P1：正式上线前

- 已完成本地文件：`llms.txt`、`robots.txt` 和 `sitemap.xml`。
- 已完成本地页面：canonical、Open Graph、Twitter Card 和 JSON-LD 使用正式绝对 URL。
- 待部署：把 `landingPage` 当前内容发布到 Vercel 正式环境。
- 在 Bing Webmaster Tools 和 Google Search Console 中验证站点。
- 如果部署环境支持，启用 IndexNow，加快 Bing 系和部分 AI 搜索体验发现更新。

### 5.1 线上检查记录

检查时间：2026-06-11

- `https://www.xion188.xyz/` 可访问，但仍是旧版落地页。
- 线上标题仍为“LocalCut Pro - 电商图片批量切图”。
- 线上按钮仍为“下载试用”，尚未更新为“联系免费试用”。
- 线上页面尚未包含 PSD/PSB 新文案、FAQ 和本轮结构化数据。
- `https://www.xion188.xyz/robots.txt` 返回 404。
- `https://www.xion188.xyz/sitemap.xml` 返回 404。
- `https://www.xion188.xyz/llms.txt` 返回 404。
- `https://www.xion188.xyz/assets/localcut-pro-app.png` 返回 404。
- 根域名 `https://xion188.xyz/` 会重定向到 canonical 域名 `https://www.xion188.xyz/`。

结论：本地 SEO/GEO 文件已准备完成，当前剩余工作是提交并触发 Vercel 部署，然后重新验证以上 URL。

### P2：内容扩展

- 增加“如何用 LocalCut Pro 处理详情页长图”的教程页。
- 增加“PSD/PSB 导入后如何批量导出电商图”的教程页。
- 增加“电商素材交付命名规范”知识页。
- 增加录屏或截图步骤，让 AI 和用户都能理解真实工作流。

### P3：可信度建设

- 增加真实案例：处理前后、耗时对比、导出文件数量。
- 增加版本更新记录，持续说明新增能力。
- 增加常见限制说明，例如支持格式、最大文件建议、PSD/PSB 解析边界。
- 收集用户反馈后补充到 FAQ，不做夸大宣传。

## 6. 资料来源

- Google Search Central: AI features and your website
  https://developers.google.com/search/docs/appearance/ai-features
- Google Search Central: Optimizing your website for generative AI features on Google Search
  https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- Google Search Central: Structured data markup that Google Search supports
  https://developers.google.com/search/docs/appearance/structured-data/search-gallery
- Bing Webmaster Blog: Introducing AI Performance in Bing Webmaster Tools Public Preview
  https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview
- llms.txt proposal
  https://llmstxt.org/
