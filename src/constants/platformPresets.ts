import type { PlatformPreset } from '../types'

export const PLATFORM_PRESETS: PlatformPreset[] = [
  { id: 'square-400', group: '通用', name: '400x400 方图', width: 400, height: 400 },
  { id: 'square-800', group: '通用', name: '800x800 方图', width: 800, height: 800 },
  { id: 'square-1080', group: '通用', name: '1080x1080 方图', width: 1080, height: 1080 },
  { id: 'vertical-750-1000', group: '通用', name: '750x1000 竖图', width: 750, height: 1000 },
  { id: 'vertical-1080-1920', group: '通用', name: '1080x1920 竖图', width: 1080, height: 1920 },
  { id: 'horizontal-1200-800', group: '通用', name: '1200x800 横图', width: 1200, height: 800 },
  { id: 'horizontal-1920-1080', group: '通用', name: '1920x1080 横图', width: 1920, height: 1080 },
  { id: 'taobao-main', group: '淘宝', name: '800x800 主图', width: 800, height: 800 },
  { id: 'taobao-detail', group: '淘宝', name: '790x1000 详情图', width: 790, height: 1000 },
  { id: 'jd-main', group: '京东', name: '800x800 主图', width: 800, height: 800 },
  { id: 'pdd-main', group: '拼多多', name: '800x800 主图', width: 800, height: 800 },
]
