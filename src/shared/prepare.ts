/**
 * 发图之前怎么处理这张图。规格见 yptd-serve 的 docs/media-pipeline.md §3，iOS 是同一套参数
 * ——同一张图从哪端发出去，接收方看到的应该一样。
 *
 * 为什么在发送端做：这台服务器出口 260 KB/s、入口 3.3 MB/s，差 12.5 倍。多花的上行几乎
 * 免费，而下载省的每个字节要乘以接收人数。以前桌面端原文件直传，一张 5 MB 的图每个接收者
 * 要等 20 秒。
 *
 * 纯函数，只做决定；真正动像素的是主进程的 nativeImage（src/main/prepare.ts）。
 */

/** 主图的长边上限 */
export const MAIN_EDGE = 2048
/** 头像：方形，这个边长 */
export const AVATAR_EDGE = 640
/** 已经是 JPEG 且不超过这么大、也不用缩，就原样发：重编码只会白白损失一代画质 */
export const JPEG_KEEP = 1.5 * 1024 * 1024
/** PNG 缩完还超过这么大，说明它是张存成 PNG 的照片，转 JPEG */
export const PNG_LIMIT = 1.5 * 1024 * 1024

export type Plan =
  /** 原样上传 */
  | { kind: 'keep' }
  /** 重编码：缩到 edge（null 为不缩），存成 format */
  | { kind: 'encode'; edge: number | null; format: 'jpeg' | 'png'; quality: number }

export interface Source { ext: string; width: number; height: number; bytes: number }

export function planImage(src: Source): Plan {
  const ext = src.ext.toLowerCase().replace(/^\./, '')
  const long = Math.max(src.width, src.height)
  // 解不出来的（宽高为 0）和动图不碰：GIF 重编码会被拍平成一帧
  if (long === 0 || ext === 'gif') return { kind: 'keep' }
  const edge = long > MAIN_EDGE ? MAIN_EDGE : null
  if (ext === 'jpg' || ext === 'jpeg') {
    if (!edge && src.bytes <= JPEG_KEEP) return { kind: 'keep' }
    return { kind: 'encode', edge, format: 'jpeg', quality: 82 }
  }
  if (ext === 'png') {
    // 截图和设计稿保持 PNG：转 JPEG 字会糊、透明底变黑。不用缩、也不大的，原样发。
    if (!edge && src.bytes <= PNG_LIMIT) return { kind: 'keep' }
    return { kind: 'encode', edge, format: 'png', quality: 100 }
  }
  // webp / bmp / heic 之类：统一成 JPEG，别的端不一定解得开
  return { kind: 'encode', edge, format: 'jpeg', quality: 82 }
}

/** PNG 编完还是太大：它其实是张照片，退到 JPEG */
export const pngFallback: Plan = { kind: 'encode', edge: null, format: 'jpeg', quality: 85 }

/** 头像永远重编码：裁成方形、缩到 640、JPEG q88（和 iOS 一致） */
export const avatarPlan = { edge: AVATAR_EDGE, quality: 88 } as const

/**
 * 对象名：随机 id + 扩展名，原始文件名只进消息里的 `n`。
 * 以前头像用裸文件名（/object/tuitest/bepo.jpeg）：userID 是昵称拼音，文件名又常见，地址猜得到；
 * 而且同名重传是原地覆盖、地址不变，各端的缓存会永久停在旧头像上。
 */
export function randomObjectName(ext: string, random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567' // base32，128 位 ≈ 26 个字符
  let id = ''
  for (let i = 0; i < 26; i++) id += alphabet[Math.floor(random() * 32)]
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)
  return clean ? `${id}.${clean}` : id
}
