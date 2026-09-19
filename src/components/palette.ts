/** 6 色皮肤板（UI 规格 §3.5）。null 表示清除颜色。笔记标记色与分组颜色共用同一套。 */
export const SKIN_COLORS = [null, '#d8b46a', '#cd956a', '#cb8585', '#86a394', '#8398ba'] as const

export type SkinColor = (typeof SKIN_COLORS)[number]
