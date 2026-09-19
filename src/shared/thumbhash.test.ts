import { describe, expect, it } from 'vitest'
import { decode, encode, fromBase64, MAX_BASE64_LENGTH, toBase64, toDataURL, type Thumb } from './thumbhash'

/** 纯色图 */
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) px.set([r, g, b, a], i * 4)
  return px
}

/** 左右两半不同色 */
function halves(w: number, h: number, left: number[], right: number[]): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? left : right
      px.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * w + x) * 4)
    }
  }
  return px
}

/** 从左到右由黑到白 */
function gradient(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round((255 * x) / (w - 1))
      px.set([v, v, v, 255], (y * w + x) * 4)
    }
  }
  return px
}

/** 从上到下由透明到不透明，颜色不变 */
function fade(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      px.set([220, 40, 90, Math.round((255 * y) / (h - 1))], (y * w + x) * 4)
    }
  }
  return px
}

/** 某个竖条区域的平均 RGB */
function regionRGB(t: Thumb, x0: number, x1: number): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = 0; y < t.height; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * t.width + x) * 4
      r += t.rgba[i] ?? 0
      g += t.rgba[i + 1] ?? 0
      b += t.rgba[i + 2] ?? 0
      n++
    }
  }
  return [r / n, g / n, b / n]
}

function avgRGB(t: Thumb): [number, number, number] {
  return regionRGB(t, 0, t.width)
}

/** 解开，顺手断言没解成 null——每条用例都要写一遍 if 太吵了 */
function roundTrip(rgba: Uint8Array, w: number, h: number): Thumb {
  const t = decode(encode(rgba, w, h))
  expect(t).not.toBeNull()
  return t as Thumb
}

describe('往返', () => {
  // 容差放到 ±12：它本来就是一团模糊，亮度只有 7 阶系数、色度 4 位量化，能把平均色还原到
  // 个位数误差已经超出占位图需要的精度了
  it('纯色图解出来还是这个色', () => {
    const t = roundTrip(solid(64, 64, 200, 60, 50), 64, 64)
    const [r, g, b] = avgRGB(t)
    expect(r).toBeCloseTo(200, -1)
    expect(g).toBeCloseTo(60, -1)
    expect(b).toBeCloseTo(50, -1)
  })

  it('左右两半：整体平均色对得上，左右也没被拉平成一片', () => {
    const t = roundTrip(halves(80, 40, [30, 60, 200], [230, 200, 40]), 80, 40)
    const [r, g, b] = avgRGB(t)
    expect(Math.abs(r - 130)).toBeLessThan(12)
    expect(Math.abs(g - 130)).toBeLessThan(12)
    expect(Math.abs(b - 120)).toBeLessThan(12)

    const [lr, , lb] = regionRGB(t, 0, t.width >> 1)
    const [rr, , rb] = regionRGB(t, t.width >> 1, t.width)
    expect(lb).toBeGreaterThan(lr + 100) // 左边是蓝的
    expect(rr).toBeGreaterThan(rb + 100) // 右边是黄的
  })

  it('渐变：平均是中灰，而且左边比右边暗', () => {
    const t = roundTrip(gradient(60, 90), 60, 90)
    const [r, g, b] = avgRGB(t)
    for (const v of [r, g, b]) expect(Math.abs(v - 127.5)).toBeLessThan(12)
    expect(regionRGB(t, 0, t.width >> 1)[0]).toBeLessThan(regionRGB(t, t.width >> 1, t.width)[0] - 60)
  })

  it('带 alpha 的图：颜色没被预乘，透明那头的 alpha 也还原得出来', () => {
    const t = roundTrip(fade(48, 48), 48, 48)
    const [r, g, b] = avgRGB(t)
    expect(Math.abs(r - 220)).toBeLessThan(12)
    expect(Math.abs(g - 40)).toBeLessThan(12)
    expect(Math.abs(b - 90)).toBeLessThan(12)
    const rowAlpha = (y: number): number => {
      let a = 0
      for (let x = 0; x < t.width; x++) a += t.rgba[(y * t.width + x) * 4 + 3] ?? 0
      return a / t.width
    }
    expect(rowAlpha(0)).toBeLessThan(60)
    expect(rowAlpha(t.height - 1)).toBeGreaterThan(200)
  })

  it('退化尺寸也编得出来（1x1）', () => {
    const t = roundTrip(solid(1, 1, 10, 20, 30), 1, 1)
    expect(t.width).toBeGreaterThan(0)
    expect(t.height).toBeGreaterThan(0)
  })
})

describe('宽高比', () => {
  it('横图解出来是横的，竖图是竖的，方的还是方的', () => {
    const wide = roundTrip(solid(96, 48, 120, 120, 120), 96, 48)
    expect(wide.width).toBeGreaterThan(wide.height)
    const tall = roundTrip(solid(48, 96, 120, 120, 120), 48, 96)
    expect(tall.height).toBeGreaterThan(tall.width)
    const square = roundTrip(solid(64, 64, 120, 120, 120), 64, 64)
    expect(square.width).toBe(square.height)
  })

  it('长边 32 像素上下——占位图不需要更多，放大了反正是糊的', () => {
    const t = roundTrip(gradient(100, 40), 100, 40)
    expect(Math.max(t.width, t.height)).toBe(32)
    expect(t.rgba.length).toBe(t.width * t.height * 4)
  })
})

describe('字节数', () => {
  // 实测数字，不是估的：
  // 头 5 字节（带 alpha 6 字节），后面每个 DCT 系数 4 位。亮度系数的个数由宽高比决定，
  // 越接近正方形越多，所以方图最大。带 alpha 时亮度从 7 阶降到 5 阶，匀出来的位给了 alpha。
  // 上限就是 25 字节（方图 + alpha），base64 完 36 个字符，卡在协议的 40 以内。
  it('不带 alpha：方图 24 字节，越扁越省', () => {
    expect(encode(solid(64, 64, 200, 60, 50), 64, 64).length).toBe(24)
    expect(encode(halves(80, 40, [30, 60, 200], [230, 200, 40]), 80, 40).length).toBe(19)
    expect(encode(gradient(60, 90), 60, 90).length).toBe(21)
  })

  it('带 alpha 的方图 25 字节，是最坏情况', () => {
    expect(encode(fade(48, 48), 48, 48).length).toBe(25)
  })

  it('base64 之后不超过协议给的 40 个字符', () => {
    const cases: Array<[Uint8Array, number, number]> = [
      [solid(64, 64, 1, 2, 3), 64, 64],
      [fade(48, 48), 48, 48],
      [gradient(60, 90), 60, 90],
      [solid(100, 100, 255, 255, 255), 100, 100],
      [halves(100, 99, [0, 0, 0], [255, 255, 255]), 100, 99],
    ]
    for (const [px, w, h] of cases) {
      expect(toBase64(encode(px, w, h)).length).toBeLessThanOrEqual(MAX_BASE64_LENGTH)
    }
  })
})

describe('base64', () => {
  it('往返', () => {
    const hash = encode(gradient(60, 90), 60, 90)
    const s = toBase64(hash)
    expect(fromBase64(s)).toEqual(hash)
  })

  it('补 = 的、没补 = 的、URL-safe 的都收', () => {
    const padded = 'X5qGNQw7oElslqhGWfSE+Q6oJ1h2iHB2Rw=='
    const bare = 'X5qGNQw7oElslqhGWfSE+Q6oJ1h2iHB2Rw'
    const urlSafe = 'X5qGNQw7oElslqhGWfSE-Q6oJ1h2iHB2Rw'
    expect(fromBase64(bare)).toEqual(fromBase64(padded))
    expect(fromBase64(urlSafe)).toEqual(fromBase64(padded))
    // 自己吐出去的永远是补 = 的标准 base64，好跟 Go 的 StdEncoding、Swift 的
    // base64EncodedString 直接做字符串比较
    expect(toBase64(fromBase64(urlSafe) as Uint8Array)).toBe(padded)
  })
})

describe('坏数据一律 null，不抛', () => {
  it('空的、太短的、截断的', () => {
    expect(decode(new Uint8Array(0))).toBeNull()
    expect(decode(new Uint8Array([1, 2, 3]))).toBeNull()
    const full = encode(gradient(60, 90), 60, 90)
    expect(decode(full.slice(0, 5))).toBeNull()
    // 少一个字节就得拦住：读到的补零会安安静静画出一张颜色错得离谱的图，比没有占位图更糟
    expect(decode(full.slice(0, full.length - 1))).toBeNull()
  })

  it('不是 Uint8Array 也不炸', () => {
    expect(decode(null as unknown as Uint8Array)).toBeNull()
    expect(decode('1QcSHQRnh493V4dIh4eXh1h4kJUI' as unknown as Uint8Array)).toBeNull()
  })

  it('乱码 base64、空串、切坏的、超长的', () => {
    expect(fromBase64('')).toBeNull()
    expect(fromBase64('!!!!')).toBeNull()
    expect(fromBase64('中文中文')).toBeNull()
    expect(fromBase64('A')).toBeNull() // 余 1 个字符凑不出一个字节
    expect(fromBase64('A'.repeat(MAX_BASE64_LENGTH + 1))).toBeNull()
    expect(fromBase64(undefined as unknown as string)).toBeNull()
    // 合法 base64，但解出来的字节当不了 hash
    expect(decode(fromBase64('AAAA') as Uint8Array)).toBeNull()
  })

  it('随便什么字节喂进去都不抛', () => {
    let seed = 20260919
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 2000; i++) {
      const u = new Uint8Array(Math.floor(rand() * 40))
      for (let k = 0; k < u.length; k++) u[k] = Math.floor(rand() * 256)
      expect(() => decode(u)).not.toThrow()
    }
  })

  it('encode 是唯一会抛的：尺寸不对说明是调用方写错了，不该静默', () => {
    expect(() => encode(new Uint8Array(4), 0, 1)).toThrow()
    expect(() => encode(new Uint8Array(101 * 4), 101, 1)).toThrow()
    expect(() => encode(new Uint8Array(4), 10, 10)).toThrow() // 像素不够
  })
})

describe('toDataURL', () => {
  it('没有 document 的环境（vitest 跑 node，主进程也一样）返回 null 而不是炸', () => {
    // 绕 globalThis 取，是因为 src/shared 也在主进程那份 tsconfig 里，那份不带 DOM 类型，
    // 裸写 document 连编都编不过
    expect((globalThis as { document?: unknown }).document).toBeUndefined()
    expect(toDataURL(encode(solid(64, 64, 10, 20, 30), 64, 64))).toBeNull()
    expect(toDataURL('1QcSHQRnh493V4dIh4eXh1h4kJUI')).toBeNull()
    expect(toDataURL('')).toBeNull()
  })
})

describe('官方向量', () => {
  // 官方仓库 evanw/thumbhash 本身没有 fixture，这两串来自它 README 点名的 Go 实现
  // galdor/go-thumbhash 的 thumbhash_test.go：data/sunrise.jpg（75x100）和
  // data/firefox.png（97x100，带透明底）。
  //
  // 另外在本地对过一遍编码方向：把 firefox.png 解成 RGBA 喂进来，本实现和官方 JS 版
  // （js/thumbhash.js）输出的 25 个字节完全一致。那组 RGBA 有 38 KB，塞进测试文件不合适，
  // 所以这里留的是解码方向的向量——字节格式对上了，两个方向就都对上了。
  const sunrise = '1QcSHQRnh493V4dIh4eXh1h4kJUI'
  const firefox = 'X5qGNQw7oElslqhGWfSE+Q6oJ1h2iHB2Rw=='

  it('sunrise.jpg：21 字节，竖图 23x32，像素和官方 JS 版逐字节相同', () => {
    const hash = fromBase64(sunrise)
    expect(hash?.length).toBe(21)
    const t = decode(hash as Uint8Array)
    expect(t).not.toBeNull()
    const px = (x: number, y: number): number[] =>
      Array.from((t as Thumb).rgba.slice((y * (t as Thumb).width + x) * 4, (y * (t as Thumb).width + x) * 4 + 4))
    expect([(t as Thumb).width, (t as Thumb).height]).toEqual([23, 32])
    expect(px(0, 0)).toEqual([64, 77, 113, 255])
    expect(px(11, 16)).toEqual([140, 109, 88, 255])
    expect(px(22, 31)).toEqual([0, 4, 39, 255])
  })

  it('firefox.png：25 字节，方图，四角透明、中间不透明', () => {
    const hash = fromBase64(firefox)
    expect(hash?.length).toBe(25)
    const t = decode(hash as Uint8Array) as Thumb
    expect([t.width, t.height]).toEqual([32, 32])
    expect(Array.from(t.rgba.slice(0, 4))).toEqual([219, 65, 45, 0])
    expect(Array.from(t.rgba.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 4))).toEqual([107, 102, 97, 255])
  })

  it('base64 和 Go 的 StdEncoding 完全一致', () => {
    expect(toBase64(fromBase64(sunrise) as Uint8Array)).toBe(sunrise)
    expect(toBase64(fromBase64(firefox) as Uint8Array)).toBe(firefox)
  })
})
