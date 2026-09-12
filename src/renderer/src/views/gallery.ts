import type { PixelSize } from '../../../shared/model'

/**
 * 几张图并排的排布：统一高度，按各自比例给宽，装不下就换行。
 *
 * 估高和渲染共用这一份。之前两处各算各的——估高按"一行四张"、固定 180 高，渲染按比例 flex-wrap，
 * 两张宽图各 400px 时估高只算一行、实际要两行——量高之后的修正会把列表推一下，就是看到的抖动。
 */
export interface Box { w: number; h: number }

/** 画廊的宽度上限（CSS 里的 max-width）。实际可用宽度更窄时由调用方传进来。 */
export const GALLERY_MAX_W = 760
export const GALLERY_GAP = 6

export function galleryLayout(items: readonly { natural: PixelSize | null }[], available = GALLERY_MAX_W): { boxes: Box[]; height: number } {
  if (items.length === 0) return { boxes: [], height: 0 }
  // 越多越小：两张以内 200 高，三张以上 150 高，一般一批能排在一行里
  const h = items.length <= 2 ? 200 : 150
  const boxes: Box[] = items.map(({ natural }) => ({
    w: natural && natural.height > 0
      ? Math.min(h * 2, Math.max(Math.round(h * 0.55), Math.round((h * natural.width) / natural.height)))
      : h,
    h,
  }))
  let rows = 1
  let used = 0
  for (const b of boxes) {
    const need = used === 0 ? b.w : used + GALLERY_GAP + b.w
    if (need > available && used > 0) { rows++; used = b.w } else { used = need }
  }
  return { boxes, height: rows * h + (rows - 1) * GALLERY_GAP }
}
