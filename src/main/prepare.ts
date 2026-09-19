import { app, nativeImage } from 'electron'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { avatarPlan, planImage, pngFallback, BLUR_EDGE, PNG_LIMIT, THUMB_EDGE, type Plan } from '../shared/prepare'
import { encode as encodeThumbHash, toBase64 } from '../shared/thumbhash'

/** 准备好的、真正要上传的那个文件 */
export interface Prepared {
  path: string
  /** 这个文件的扩展名（不带点）、mime、像素尺寸、字节数——消息里的 w/h/s 描述的就是它 */
  ext: string
  mime: string
  width: number
  height: number
  bytes: number
  /** 是不是原文件（没动过）。不是的话调用方发完要删掉 */
  original: boolean
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

function outbox(): string {
  const dir = join(app.getPath('temp'), 'yptd-outbox')
  mkdirSync(dir, { recursive: true })
  return dir
}

function asIs(path: string, width: number, height: number): Prepared {
  const ext = extname(path).slice(1).toLowerCase()
  return { path, ext, mime: MIME[ext] ?? 'application/octet-stream', width, height, bytes: statSync(path).size, original: true }
}

function encode(img: Electron.NativeImage, plan: Extract<Plan, { kind: 'encode' }>): { data: Buffer; img: Electron.NativeImage } {
  const { width, height } = img.getSize()
  const long = Math.max(width, height)
  const out = plan.edge && long > plan.edge
    ? img.resize({ width: Math.round(width * plan.edge / long), height: Math.round(height * plan.edge / long), quality: 'best' })
    : img
  return { data: plan.format === 'png' ? out.toPNG() : out.toJPEG(plan.quality), img: out }
}

/**
 * 发图之前的处理。决定在 shared/prepare（纯函数、有测试），这里只负责动像素。
 * 任何一步出岔子都退回原文件：压缩是为了省别人的流量，不能因为它发不出图。
 */
export function prepareImage(path: string): Prepared {
  try {
    const img = nativeImage.createFromPath(path)
    const { width, height } = img.isEmpty() ? { width: 0, height: 0 } : img.getSize()
    const bytes = statSync(path).size
    const plan = planImage({ ext: extname(path), width, height, bytes })
    if (plan.kind === 'keep') return asIs(path, width, height)

    let done = encode(img, plan)
    let format = plan.format
    // 存成 PNG 的照片：缩完还是很大，退到 JPEG
    if (format === 'png' && done.data.length > PNG_LIMIT && pngFallback.kind === 'encode') {
      done = encode(done.img, pngFallback)
      format = 'jpeg'
    }
    // 处理完反而更大（已经压得很狠的小图）就不折腾
    if (done.data.length >= bytes) return asIs(path, width, height)

    const ext = format === 'png' ? 'png' : 'jpg'
    const file = join(outbox(), `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`)
    writeFileSync(file, done.data)
    const size = done.img.getSize()
    return { path: file, ext, mime: MIME[ext]!, width: size.width, height: size.height, bytes: done.data.length, original: false }
  } catch {
    return asIs(path, 0, 0)
  }
}

/**
 * 一张图的缩略档和它的模糊占位。
 *
 * 为什么发送端生成而不是让接收端问服务端要：服务端的按需缩图是 q75 加最近邻，而且不带
 * `format` 就一律出 PNG（实测 102 KB 的 JPEG，960 档的 PNG 缩图 873 KB，是原图的 8.5 倍）；
 * 更要紧的是接收端得靠 URL 长什么样来判断「能不能缩」，换个对象存储就静默失效。
 * 上行比下行快 12.5 倍，多传一张几十 KB 的缩略图对发的人几乎免费。
 */
export function prepareThumb(path: string): { thumb: Prepared; blur: string } | null {
  try {
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const long = Math.max(width, height)
    const scaled = long > THUMB_EDGE
      ? img.resize({ width: Math.round(width * THUMB_EDGE / long), height: Math.round(height * THUMB_EDGE / long), quality: 'best' })
      : img
    const data = scaled.toJPEG(72)
    const size = scaled.getSize()
    const file = join(outbox(), `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}-th.jpg`)
    writeFileSync(file, data)

    // ThumbHash 要非预乘的 RGBA，且长边不超过 100——这两条都是它的硬要求，超了 encode 直接拒绝
    const tiny = img.resize({
      width: Math.max(1, Math.round(width * BLUR_EDGE / long)),
      height: Math.max(1, Math.round(height * BLUR_EDGE / long)),
      quality: 'good',
    })
    const t = tiny.getSize()
    // Electron 给的是 BGRA，ThumbHash 要 RGBA
    const bgra = tiny.toBitmap()
    const rgba = new Uint8Array(bgra.length)
    for (let i = 0; i < bgra.length; i += 4) {
      rgba[i] = bgra[i + 2]!; rgba[i + 1] = bgra[i + 1]!; rgba[i + 2] = bgra[i]!; rgba[i + 3] = bgra[i + 3]!
    }
    const blur = toBase64(encodeThumbHash(rgba, t.width, t.height))
    return {
      thumb: { path: file, ext: 'jpg', mime: 'image/jpeg', width: size.width, height: size.height, bytes: data.length, original: false },
      blur,
    }
  } catch {
    // 生成不出来就没有——接收端退回按需缩图和一块底色，不该因此发不出图
    return null
  }
}

/** 头像：居中裁成方形、缩到 640、JPEG q88。解不开的图返回 null，调用方报错而不是传一张原图上去 */
export function prepareAvatar(path: string): Prepared | null {
  try {
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    const side = Math.min(width, height)
    const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    const edge = Math.min(side, avatarPlan.edge)
    const out = side > edge ? square.resize({ width: edge, height: edge, quality: 'best' }) : square
    const data = out.toJPEG(avatarPlan.quality)
    const file = join(outbox(), `avatar-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`)
    writeFileSync(file, data)
    return { path: file, ext: 'jpg', mime: 'image/jpeg', width: edge, height: edge, bytes: data.length, original: false }
  } catch {
    return null
  }
}
