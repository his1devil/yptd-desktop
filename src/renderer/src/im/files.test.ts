import { describe, expect, it } from 'vitest'
import { MAX_THUMB, avatarSized, displaySrc, mapLimit, mimeOf, objectName, previewFor, rememberPreview, rememberThumb, sized, thumbFor } from './files'

const u = 'https://im.zhanghuanyang.com/object/tuitest/att_x.png'
const widthOf = (s: string): number => Number(/width=(\d+)/.exec(s)?.[1] ?? 0)

describe('按槽位取裁过的图', () => {
  it('本服务的对象地址加上裁剪参数，尺寸归到 160 的整数倍', () => {
    expect(sized(u, 200)).toBe(`${u}?type=image&width=320&height=320`)
    expect(sized(u, 320)).toBe(`${u}?type=image&width=320&height=320`)
    expect(sized(u, 321)).toBe(`${u}?type=image&width=480&height=480`)
  })
  it('再大也不越过服务端的缩图上限', () => {
    expect(sized(u, 1)).toContain('width=160')
    // 1088 起服务端会把原文件当 200 返回，onError 抓不到，所以这里绝不能超
    expect(widthOf(sized(u, 99999))).toBeLessThanOrEqual(MAX_THUMB)
    expect(sized(u, 99999)).toContain('width=960')
  })
  it('本机预览、已带参数的、外站地址都不动', () => {
    expect(sized('data:image/png;base64,AAA', 320)).toBe('data:image/png;base64,AAA')
    expect(sized(`${u}?type=image&width=640&height=640`, 320)).toBe(`${u}?type=image&width=640&height=640`)
    expect(sized('https://example.com/a.png', 320)).toBe('https://example.com/a.png')
  })
})

describe('头像档位', () => {
  it('26px 的槽在 2 倍屏落到 64 档，不是原图', () => {
    expect(avatarSized(u, 52)).toBe(`${u}?type=image&width=64&height=64`)
  })
  it('落到刚好够用的那一档', () => {
    expect(avatarSized(u, 32)).toContain('width=32')
    expect(avatarSized(u, 33)).toContain('width=64')
    expect(avatarSized(u, 200)).toContain('width=256')
  })
  it('再大也封顶，不会去要原图', () => {
    expect(avatarSized(u, 9999)).toContain('width=256')
  })
  it('外站地址不动', () => {
    expect(avatarSized('https://example.com/a.png', 52)).toBe('https://example.com/a.png')
  })
})

describe('查看器的显示图', () => {
  it('大图请求视口那一档，不越过上限', () => {
    const s = displaySrc(u, 2000, { width: 5712, height: 3799 }, 3830755)
    expect(widthOf(s)).toBe(MAX_THUMB)
  })
  it('原图本来就不大就直接用原图——缩图输出 PNG，可能比原图还大', () => {
    expect(displaySrc(u, 1024, { width: 1280, height: 2275 }, 239640)).toBe(u)
  })
  it('原图比想要的尺寸还小也直接用原图，不做无谓的放大', () => {
    expect(displaySrc(u, 1024, { width: 800, height: 600 }, 4_000_000)).toBe(u)
  })
  it('不知道尺寸和体积时仍然走缩图', () => {
    expect(widthOf(displaySrc(u, 1024, null))).toBe(MAX_THUMB)
  })
})

describe('消息流已加载的缩图', () => {
  it('记下来给查看器当第一帧', () => {
    rememberThumb('x', `${u}?type=image&width=640&height=640`)
    expect(thumbFor('x')).toContain('width=640')
    expect(thumbFor('没见过的')).toBeUndefined()
  })
})

describe('有限并发', () => {
  it('保持原顺序，并发数不超过上限', async () => {
    let now = 0, peak = 0
    const run = async (n: number): Promise<number> => {
      now++; peak = Math.max(peak, now)
      await new Promise((r) => setTimeout(r, 10 - n))
      now--
      return n * 2
    }
    expect(await mapLimit([1, 2, 3, 4, 5], 2, run)).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBeLessThanOrEqual(2)
  })
  it('空列表直接过', async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([])
  })
  it('有一个失败就整体失败', async () => {
    await expect(mapLimit([1, 2], 2, async (n) => { if (n === 2) throw new Error('炸了'); return n })).rejects.toThrow('炸了')
  })
})

describe('文件名与对象名', () => {
  it('按后缀给 MIME，认不出的给二进制流', () => {
    expect(mimeOf('a.PNG')).toBe('image/png')
    expect(mimeOf('a.pdf')).toBe('application/pdf')
    expect(mimeOf('a.xyz')).toBe('application/octet-stream')
  })
  it('对象名带唯一前缀，中文保留，怪字符换掉', () => {
    const n = objectName('我的 图/片.png')
    expect(n).toMatch(/^att_[a-z0-9]+_/)
    expect(n).toContain('我的_图_片.png')
    expect(objectName('我的 图/片.png')).not.toBe(n)
  })
})

describe('本机预览缓存', () => {
  it('只留最近若干张，旧的自己掉队', () => {
    for (let i = 0; i < 70; i++) rememberPreview(`u${i}`, `data:${i}`)
    expect(previewFor('u69')).toBe('data:69')
    expect(previewFor('u9')).toBeUndefined()
  })
  it('没有缩略图就不记', () => {
    rememberPreview('u-none', null)
    expect(previewFor('u-none')).toBeUndefined()
  })
})

describe('缩图的格式跟源文件走', () => {
  const base = 'https://im.example.com/object/u1/'
  it('照片要 jpeg：服务端不带 format 就出 PNG，102KB 的 JPEG 在 960 档会变成 873KB', () => {
    expect(sized(base + 'photo.jpg', 300)).toBe(base + 'photo.jpg?type=image&width=320&height=320&format=jpeg')
    expect(avatarSized(base + 'avatar-1.JPEG', 52)).toContain('&format=jpeg')
    expect(sized(base + 'IMG_0001.heic', 300)).toContain('&format=jpeg')
  })
  it('截图和像素头像保持 PNG：服务端的 JPEG 是 q75 加最近邻，字会糊、透明底变黑', () => {
    expect(sized(base + 'screenshot.png', 300)).toBe(base + 'screenshot.png?type=image&width=320&height=320')
    expect(avatarSized(base + 'avatar-12b156c2ebe7.png', 52)).not.toContain('format=')
  })
})
