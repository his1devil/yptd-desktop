import { describe, expect, it } from 'vitest'
import { mapLimit, mimeOf, objectName, previewFor, rememberPreview, sized } from './files'

describe('按槽位取裁过的图', () => {
  const u = 'https://im.zhanghuanyang.com/object/tuitest/att_x.png'
  it('本服务的对象地址加上裁剪参数，尺寸归到 160 的整数倍', () => {
    expect(sized(u, 200)).toBe(`${u}?type=image&width=320&height=320`)
    expect(sized(u, 320)).toBe(`${u}?type=image&width=320&height=320`)
    expect(sized(u, 321)).toBe(`${u}?type=image&width=480&height=480`)
  })
  it('尺寸有上下限', () => {
    expect(sized(u, 1)).toContain('width=160')
    expect(sized(u, 99999)).toContain('width=2048')
  })
  it('本机预览、已带参数的、外站地址都不动', () => {
    expect(sized('data:image/png;base64,AAA', 320)).toBe('data:image/png;base64,AAA')
    expect(sized(`${u}?type=image&width=640&height=640`, 320)).toBe(`${u}?type=image&width=640&height=640`)
    expect(sized('https://example.com/a.png', 320)).toBe('https://example.com/a.png')
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
