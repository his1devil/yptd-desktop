/** 文件名 → MIME；对象存储按它给响应头，浏览器才把图当图、把 PDF 当 PDF */
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  zip: 'application/zip', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg',
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic)$/i

export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** 对象名：唯一前缀 + 清理过的原名。同名对象会互相覆盖，所以不能直接用原名 */
export function objectName(name: string): string {
  const safe = name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(-80) || 'file'
  return `att_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}_${safe}`
}

/**
 * 刚发出去的图：服务端地址 → 本机缩略图。回显换成服务端地址时先用它铺底，不闪一下空白。
 * 存的是 data URL，一张几十 KB，所以留最近 60 张就够——更早的图那边早就下好了，不需要垫底。
 */
const PREVIEW_KEEP = 60
const previews = new Map<string, string>()
export function rememberPreview(url: string, dataURL: string | null): void {
  if (!dataURL) return
  previews.set(url, dataURL)
  while (previews.size > PREVIEW_KEEP) previews.delete(previews.keys().next().value as string)
}
export const previewFor = (url: string): string | undefined => previews.get(url)

/**
 * 服务端缩图的真实上限，2026-09-13 在 im.zhanghuanyang.com 上逐档实测：1024 及以下给真缩图，
 * 1088 起把原文件当 200 返回，content-type 变成 binary/octet-stream。
 * 这个回退是 HTTP 200，`<img onError>` 抓不到，只会看到一张几 MB 的原图悄悄下下来——
 * 所以任何地方都不许请求超过这个数。
 */
export const MAX_THUMB = 1024
/** 缩图档位的步长：不同槽位算出来的尺寸收敛成几个值，缓存才命中得上 */
const STEP = 160
/** 按步长归档后不越过 MAX_THUMB 的最大一档 */
const MAX_STEPPED = Math.floor(MAX_THUMB / STEP) * STEP

/** 只有本服务的对象地址能改尺寸：data: 预览、已经带参数的（OpenIM 自己的缩略图）和外站地址都不行 */
const resizable = (url: string): boolean =>
  url.startsWith('http') && !url.includes('?') && url.includes('/object/')

/**
 * 缩图的格式跟源文件走。服务端不带 format 就一律出 PNG——对照片这是灾难：实测一张 102KB 的
 * JPEG，960 档的 PNG 缩图 873KB，是原图的 8.5 倍；带上 format=jpeg 同一档只有几十 KB。
 * 反过来不能全用 jpeg：服务端的 JPEG 是 q75 加最近邻缩放，截图和设计稿（PNG）转过去字会糊、
 * 透明底会变黑。所以只有源本来就是有损格式的才要 jpeg，其余保持服务端默认的 PNG。
 */
const lossy = (url: string): boolean => /\.(jpe?g|heic|heif)$/i.test(url)
const thumb = (url: string, n: number): string =>
  `${url}?type=image&width=${n}&height=${n}${lossy(url) ? '&format=jpeg' : ''}`

/**
 * 列表里按槽位取裁过的图。对象存储认 `?type=image&width=&height=`，只给宽高不带 type 会返回原图。
 * 900×500 的图请求 200px：116501 字节降到 7953——在出口只有 2Mbps 的服务器上，这是图片"卡顿"的大头。
 */
export function sized(url: string, px: number): string {
  if (!resizable(url)) return url
  const n = Math.min(MAX_STEPPED, Math.max(STEP, Math.ceil(px / STEP) * STEP))
  return thumb(url, n)
}

/**
 * 头像档位。右栏的槽只有 26 CSS px，2 倍屏要 52 物理像素；原来直接上原图，
 * 实测三个头像 2.95MB，换成 64 档合计 22KB。档位少几个，缓存才共用得起来。
 */
const AVATAR_TIERS = [32, 64, 128, 256] as const
export function avatarSized(url: string, px: number): string {
  if (!resizable(url)) return url
  return thumb(url, AVATAR_TIERS.find((t) => t >= px) ?? AVATAR_TIERS[AVATAR_TIERS.length - 1]!)
}

/**
 * 原图小到这个数以内就别要缩图了。服务端缩图输出的是 PNG，一张压得好的 JPEG 转成 PNG
 * 往往比原文件还大：实测一张 1280×2275 的 239KB 图，1024 档缩图 721KB，是原图的三倍。
 */
const SMALL_ENOUGH = 512 * 1024

/**
 * 查看器要请求的那张「显示图」。拿不到比原图更好的结果时就直接用原图——
 * 要么原图本来就不大，要么原图比想要的尺寸还小，缩图只会更糊或更大。
 */
export function displaySrc(url: string, px: number, natural: { width: number; height: number } | null, bytes = 0): string {
  if (!resizable(url)) return url
  if (bytes > 0 && bytes <= SMALL_ENOUGH) return url
  const n = Math.min(MAX_THUMB, Math.max(STEP, Math.round(px)))
  const longest = natural ? Math.max(natural.width, natural.height) : 0
  if (longest > 0 && longest <= n) return url
  return thumb(url, n)
}

/**
 * 消息流里那张图实际用的地址。查看器打开时先拿它顶上——浏览器缓存里已经有了，
 * 是零网络的一帧，不用对着空屏等原图下完。
 */
const THUMB_KEEP = 120
const loaded = new Map<string, string>()
export function rememberThumb(url: string, src: string): void {
  loaded.set(url, src)
  while (loaded.size > THUMB_KEEP) loaded.delete(loaded.keys().next().value as string)
}
export const thumbFor = (url: string): string | undefined => loaded.get(url)

/** 有限并发，保持原顺序。三张图串行传要等三倍的时间，同时全开又会互相抢上行带宽。 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!)
  }))
  return out
}
