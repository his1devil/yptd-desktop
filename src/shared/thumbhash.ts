/**
 * ThumbHash：把一张图压成二十来个字节，跟着消息体一起走（附件里的 `b` 字段，规格见
 * yptd-serve 的 docs/media-pipeline.md §2）。
 *
 * 为什么要它：服务器出口只有 260 KB/s，连缩略档都要几秒才到，这几秒消息流里是一块空白，
 * 图一到又整块跳一下。ThumbHash 不产生任何额外请求——字节就在消息里，收到消息的同一刻
 * 就能画出颜色和明暗都对得上的一团模糊，真图下完再换掉。
 *
 * 为什么自己实现：算法总共两百行（移植自 evanw/thumbhash，MIT），而多一个 npm 依赖要同时
 * 进主进程和渲染进程两份产物。放 shared 是因为两边都会碰：主进程发图时顺手算，渲染进程收到
 * 消息时解。
 *
 * 和官方 JS 版的差别只在外壳——参数顺序改成 (rgba, width, height) 跟仓库里别的函数一致、
 * 解码失败返回 null 而不是抛、base64 收进来（协议里传的是字符串不是字节）。字节格式一位不差，
 * 和 iOS、Go 的实现可以互认。
 */

/** 编码前图片的长边上限。再大纯属白烧 CPU：输出就那二十来个字节，多的像素全被 DCT 平掉了 */
export const MAX_EDGE = 100

/** 协议给 `b` 定的长度上限。最坏情况（带 alpha）编出来也就 36 个字符，超了的一律当没有 */
export const MAX_BASE64_LENGTH = 40

/** 解出来的占位图：长边固定 32 像素左右，够糊了 */
export interface Thumb {
  /** RGBA，逐行；alpha 未预乘 */
  rgba: Uint8Array
  width: number
  height: number
}

/** DCT 之后的一个通道：常数项、归一化到 [0,1] 的变化项、以及还原它们要乘回去的幅度 */
interface Channel {
  dc: number
  ac: number[]
  scale: number
}

/**
 * 编码。`rgba` 是逐行的 RGBA（alpha 未预乘），长宽必须先缩到 ≤ 100px——上游 §3 说的
 * 「生成 th 时顺手算」就是在那一步缩的。
 *
 * 这里是唯一会抛的函数：传进来的图是自己刚生成的，尺寸不对属于代码写错了，静默吞掉只会
 * 让「占位图偶尔没有」变成一个没人查得动的悬案。
 */
export function encode(rgba: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`thumbhash: 宽高不合法 ${width}x${height}`)
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    throw new RangeError(`thumbhash: ${width}x${height} 超过 ${MAX_EDGE}x${MAX_EDGE}，要先缩图`)
  }
  if (rgba.length < width * height * 4) {
    throw new RangeError(`thumbhash: 像素不够，${width}x${height} 要 ${width * height * 4} 字节，只有 ${rgba.length}`)
  }

  const count = width * height

  // 先求平均色，而且按 alpha 加权：透明区域没有颜色可言，让它参与平均只会把整张图拉向黑色
  let avgR = 0
  let avgG = 0
  let avgB = 0
  let avgA = 0
  for (let i = 0, j = 0; i < count; i++, j += 4) {
    const alpha = (rgba[j + 3] ?? 0) / 255
    avgR += (alpha / 255) * (rgba[j] ?? 0)
    avgG += (alpha / 255) * (rgba[j + 1] ?? 0)
    avgB += (alpha / 255) * (rgba[j + 2] ?? 0)
    avgA += alpha
  }
  if (avgA) {
    avgR /= avgA
    avgG /= avgA
    avgB /= avgA
  }

  // 有透明就得匀出 14 个系数给 alpha 通道，亮度只好从 7 阶降到 5 阶——总字节数是固定的
  const hasAlpha = avgA < count
  const lLimit = hasAlpha ? 5 : 7
  const lx = Math.max(1, Math.round((lLimit * width) / Math.max(width, height)))
  const ly = Math.max(1, Math.round((lLimit * height) / Math.max(width, height)))

  // 转成 LPQA：人眼对亮度比对色度敏感得多，拆开之后才能只给色度留 5 个系数。
  // 半透明像素先合成到平均色上，免得边缘出现凭空的暗边。
  const l = new Float64Array(count) // 亮度
  const p = new Float64Array(count) // 黄 - 蓝
  const q = new Float64Array(count) // 红 - 绿
  const a = new Float64Array(count) // alpha
  for (let i = 0, j = 0; i < count; i++, j += 4) {
    const alpha = (rgba[j + 3] ?? 0) / 255
    const r = avgR * (1 - alpha) + (alpha / 255) * (rgba[j] ?? 0)
    const g = avgG * (1 - alpha) + (alpha / 255) * (rgba[j + 1] ?? 0)
    const b = avgB * (1 - alpha) + (alpha / 255) * (rgba[j + 2] ?? 0)
    l[i] = (r + g + b) / 3
    p[i] = (r + g) / 2 - b
    q[i] = r - g
    a[i] = alpha
  }

  const encodeChannel = (channel: Float64Array, nx: number, ny: number): Channel => {
    let dc = 0
    let scale = 0
    const ac: number[] = []
    const fx = new Float64Array(width)
    for (let cy = 0; cy < ny; cy++) {
      // 只取左上三角：右下角那些高频项对一张模糊图毫无贡献，白占字节
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0
        for (let x = 0; x < width; x++) fx[x] = Math.cos(((Math.PI / width) * cx) * (x + 0.5))
        for (let y = 0; y < height; y++) {
          const fy = Math.cos(((Math.PI / height) * cy) * (y + 0.5))
          for (let x = 0; x < width; x++) f += (channel[x + y * width] ?? 0) * (fx[x] ?? 0) * fy
        }
        f /= count
        if (cx || cy) {
          ac.push(f)
          scale = Math.max(scale, Math.abs(f))
        } else {
          dc = f
        }
      }
    }
    // 每个系数只剩 4 位，先按整个通道的最大幅度归一化，量化误差才不会淹掉弱的那些项
    if (scale) for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + (0.5 / scale) * (ac[i] ?? 0)
    return { dc, ac, scale }
  }

  const lCh = encodeChannel(l, Math.max(3, lx), Math.max(3, ly))
  const pCh = encodeChannel(p, 3, 3)
  const qCh = encodeChannel(q, 3, 3)
  const aCh = hasAlpha ? encodeChannel(a, 5, 5) : null

  const isLandscape = width > height
  const alphaBit = hasAlpha ? 1 : 0
  const landscapeBit = isLandscape ? 1 : 0
  const header24 =
    Math.round(63 * lCh.dc) |
    (Math.round(31.5 + 31.5 * pCh.dc) << 6) |
    (Math.round(31.5 + 31.5 * qCh.dc) << 12) |
    (Math.round(31 * lCh.scale) << 18) |
    (alphaBit << 23)
  // 长边的阶数由 hasAlpha 唯一决定，所以只存短边那个——宽高比是靠这两个阶数还原出来的
  const header16 =
    (isLandscape ? ly : lx) |
    (Math.round(63 * pCh.scale) << 3) |
    (Math.round(63 * qCh.scale) << 9) |
    (landscapeBit << 15)

  const acStart = hasAlpha ? 6 : 5
  const acs = aCh ? [lCh.ac, pCh.ac, qCh.ac, aCh.ac] : [lCh.ac, pCh.ac, qCh.ac]
  let acCount = 0
  for (const ac of acs) acCount += ac.length

  const out = new Uint8Array(acStart + ((acCount + 1) >> 1))
  out[0] = header24 & 255
  out[1] = (header24 >> 8) & 255
  out[2] = header24 >> 16
  out[3] = header16 & 255
  out[4] = header16 >> 8
  if (aCh) out[5] = Math.round(15 * aCh.dc) | (Math.round(15 * aCh.scale) << 4)

  let acIndex = 0
  for (const ac of acs) {
    for (const f of ac) {
      const at = acStart + (acIndex >> 1)
      out[at] = (out[at] ?? 0) | (Math.round(15 * f) << ((acIndex++ & 1) << 2))
    }
  }
  return out
}

/**
 * 解码。解不出来返回 null，绝不抛：这段字节是别的端写进消息里、又过了一趟网络的，
 * 一条坏数据不该让整条消息渲染不出来——按协议，`b` 废了就退回纯色占位。
 */
export function decode(hash: Uint8Array): Thumb | null {
  // 5 个字节的头都不够就别往下看了
  if (!(hash instanceof Uint8Array) || hash.length < 5) return null
  const at = (i: number): number => hash[i] ?? 0

  const header24 = at(0) | (at(1) << 8) | (at(2) << 16)
  const header16 = at(3) | (at(4) << 8)
  const lDc = (header24 & 63) / 63
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1
  const lScale = ((header24 >> 18) & 31) / 31
  const hasAlpha = (header24 >> 23) !== 0
  const pScale = ((header16 >> 3) & 63) / 63
  const qScale = ((header16 >> 9) & 63) / 63
  const isLandscape = (header16 >> 15) !== 0
  const lx = Math.max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7)
  const ly = Math.max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7)

  // 头里的阶数决定了后面该有多少字节。截断的 hash 在这里就拦住，否则读到的是一片 0，
  // 会安安静静画出一张颜色错得离谱的图——那比没有占位图更糟。
  const acStart = hasAlpha ? 6 : 5
  const acCount = acTermCount(lx, ly) + acTermCount(3, 3) * 2 + (hasAlpha ? acTermCount(5, 5) : 0)
  if (hash.length < acStart + ((acCount + 1) >> 1)) return null

  const aDc = hasAlpha ? (at(5) & 15) / 15 : 1
  const aScale = hasAlpha ? (at(5) >> 4) / 15 : 0

  // 色度整体放大 1.25 倍，补偿 4 位量化带来的掉色
  let acIndex = 0
  const decodeChannel = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = []
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push((((at(acStart + (acIndex >> 1)) >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale)
      }
    }
    return ac
  }
  const lAc = decodeChannel(lx, ly, lScale)
  const pAc = decodeChannel(3, 3, pScale * 1.25)
  const qAc = decodeChannel(3, 3, qScale * 1.25)
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : []

  const ratio = lx / ly
  const width = Math.round(ratio > 1 ? 32 : 32 * ratio)
  const height = Math.round(ratio > 1 ? 32 / ratio : 32)
  const rgba = new Uint8Array(width * height * 4)
  const fx = new Float64Array(Math.max(lx, hasAlpha ? 5 : 3))
  const fy = new Float64Array(Math.max(ly, hasAlpha ? 5 : 3))

  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      let l = lDc
      let p = pDc
      let q = qDc
      let alpha = aDc

      for (let cx = 0; cx < fx.length; cx++) fx[cx] = Math.cos((Math.PI / width) * (x + 0.5) * cx)
      for (let cy = 0; cy < fy.length; cy++) fy[cy] = Math.cos((Math.PI / height) * (y + 0.5) * cy)

      for (let cy = 0, j = 0; cy < ly; cy++) {
        const fy2 = (fy[cy] ?? 0) * 2
        for (let cx = cy ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) {
          l += (lAc[j] ?? 0) * (fx[cx] ?? 0) * fy2
        }
      }
      for (let cy = 0, j = 0; cy < 3; cy++) {
        const fy2 = (fy[cy] ?? 0) * 2
        for (let cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          const f = (fx[cx] ?? 0) * fy2
          p += (pAc[j] ?? 0) * f
          q += (qAc[j] ?? 0) * f
        }
      }
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy++) {
          const fy2 = (fy[cy] ?? 0) * 2
          for (let cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++) {
            alpha += (aAc[j] ?? 0) * (fx[cx] ?? 0) * fy2
          }
        }
      }

      const b = l - (2 / 3) * p
      const r = (3 * l - b + q) / 2
      const g = r - q
      rgba[i] = Math.max(0, 255 * Math.min(1, r))
      rgba[i + 1] = Math.max(0, 255 * Math.min(1, g))
      rgba[i + 2] = Math.max(0, 255 * Math.min(1, b))
      rgba[i + 3] = Math.max(0, 255 * Math.min(1, alpha))
    }
  }
  return { rgba, width, height }
}

/** 一个通道在左上三角里有多少个变化项（不含常数项），解码前用来核对字节够不够 */
function acTermCount(nx: number, ny: number): number {
  let n = 0
  for (let cy = 0; cy < ny; cy++) for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) n++
  return n
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * 转 base64。自己写而不用 btoa / Buffer，是因为这两个各只在一个进程里有；补 `=` 是为了和
 * Go 的 StdEncoding、Swift 的 base64EncodedString 一字不差——三端的 `b` 要能直接字符串比较。
 */
export function toBase64(hash: Uint8Array): string {
  let out = ''
  for (let i = 0; i < hash.length; i += 3) {
    const n = ((hash[i] ?? 0) << 16) | ((hash[i + 1] ?? 0) << 8) | (hash[i + 2] ?? 0)
    const rest = hash.length - i
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += rest > 1 ? B64.charAt((n >> 6) & 63) : '='
    out += rest > 2 ? B64.charAt(n & 63) : '='
  }
  return out
}

/**
 * 从 base64 还原。超过 MAX_BASE64_LENGTH 直接判死：协议就是这么写的，顺带挡住拿一串几 MB 的
 * 字符串塞进消息、让每个收件人的渲染进程卡住的玩法。
 * 输入宽松些——没补 `=` 的、URL-safe 变体的都收，别的端将来用哪个库都不至于对不上。
 */
export function fromBase64(s: string): Uint8Array | null {
  if (typeof s !== 'string' || s.length === 0 || s.length > MAX_BASE64_LENGTH) return null
  let end = s.length
  while (end > 0 && s.charAt(end - 1) === '=') end--
  const body = s.slice(0, end)
  // 余 1 个字符凑不出哪怕一个字节，是切坏了
  if (body.length === 0 || body.length % 4 === 1) return null

  const out = new Uint8Array((body.length * 3) >> 2)
  let acc = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i)
    const v = ch === '-' ? 62 : ch === '_' ? 63 : B64.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 255
    }
  }
  return out
}

/** toDataURL 要用到的那几个 DOM 成员。主进程那份 tsconfig 不带 DOM 类型，直接写 document 编不过 */
interface ImageDataLike {
  readonly data: { set(src: Uint8Array): void }
}
interface Context2DLike {
  createImageData(width: number, height: number): ImageDataLike
  putImageData(image: ImageDataLike, x: number, y: number): void
}
interface CanvasLike {
  width: number
  height: number
  getContext(id: '2d'): Context2DLike | null
  toDataURL(type?: string): string
}
interface DocumentLike {
  createElement(tag: 'canvas'): CanvasLike
}

/**
 * 给渲染进程用的便利函数：hash（字节或 base64）直接变成能塞进 <img src> 的 PNG data URL。
 *
 * 没有 document 的地方（主进程、vitest 的 node 环境）返回 null 而不是炸——这函数多半是在
 * 组件里顺手调的，它抛一次就是整棵树白屏，而占位图本来就是可有可无的东西。
 */
export function toDataURL(hash: Uint8Array | string): string | null {
  const doc = (globalThis as { document?: DocumentLike }).document
  if (typeof doc === 'undefined') return null
  const bytes = typeof hash === 'string' ? fromBase64(hash) : hash
  if (!bytes) return null
  const thumb = decode(bytes)
  if (!thumb) return null
  try {
    const canvas = doc.createElement('canvas')
    canvas.width = thumb.width
    canvas.height = thumb.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const image = ctx.createImageData(thumb.width, thumb.height)
    image.data.set(thumb.rgba)
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    // 画布被隐私模式之类的东西拦了（canvas 指纹防护会让 toDataURL 抛），当没有占位图
    return null
  }
}
