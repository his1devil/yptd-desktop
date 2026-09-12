import { describe, expect, it } from 'vitest'
import { GALLERY_MAX_W, galleryLayout } from './gallery'

const img = (w: number, h: number) => ({ natural: { width: w, height: h } })

describe('画廊排布', () => {
  it('两张以内 200 高，三张以上 150 高', () => {
    expect(galleryLayout([img(100, 100)]).boxes[0]!.h).toBe(200)
    expect(galleryLayout([img(100, 100), img(100, 100)]).boxes[0]!.h).toBe(200)
    expect(galleryLayout([img(100, 100), img(100, 100), img(100, 100)]).boxes[0]!.h).toBe(150)
  })

  it('按比例给宽，最宽不超过两倍高，最窄不低于 0.55 倍高', () => {
    expect(galleryLayout([img(400, 200)]).boxes[0]!.w).toBe(400)
    expect(galleryLayout([img(4000, 200)]).boxes[0]!.w).toBe(400)
    expect(galleryLayout([img(10, 2000)]).boxes[0]!.w).toBe(110)
  })

  it('装不下就换行，高度按行数算——这正是估高原来算错的地方', () => {
    // 两张 400 宽的横图，加 6px 间距是 806，超过 760，必须换行
    const two = galleryLayout([img(400, 200), img(400, 200)])
    expect(two.boxes.map((b) => b.w)).toEqual([400, 400])
    expect(two.height).toBe(200 * 2 + 6)
    // 同样两张，可用宽度够就只有一行
    expect(galleryLayout([img(400, 200), img(400, 200)], 900).height).toBe(200)
  })

  it('可用宽度更窄时行数跟着变', () => {
    // 三张正方形，150 高各占 150 宽：760 里一行放得下，320 里放得下两张，160 里一张一行
    const three = [img(150, 150), img(150, 150), img(150, 150)]
    expect(galleryLayout(three, GALLERY_MAX_W).height).toBe(150)
    expect(galleryLayout(three, 320).height).toBe(150 * 2 + 6)
    expect(galleryLayout(three, 160).height).toBe(150 * 3 + 6 * 2)
    // 三张 300 宽的横图在默认上限里就已经放不下一行了
    expect(galleryLayout([img(300, 150), img(300, 150), img(300, 150)]).height).toBe(150 * 2 + 6)
  })

  it('没有原始尺寸就按正方形占位，空列表高度为 0', () => {
    expect(galleryLayout([{ natural: null }]).boxes[0]).toEqual({ w: 200, h: 200 })
    expect(galleryLayout([])).toEqual({ boxes: [], height: 0 })
  })
})
