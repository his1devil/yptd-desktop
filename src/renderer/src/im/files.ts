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
 * 列表里按槽位取裁过的图。对象存储认 `?type=image&width=&height=`，只给宽高不带 type 会返回原图。
 * 900×500 的图请求 200px：116501 字节降到 7953——在出口只有 2Mbps 的服务器上，这是图片"卡顿"的大头。
 *
 * 只对本服务的对象地址生效：data: 预览、已经带参数的（OpenIM 自己的缩略图）和外站地址都原样返回。
 * 请求的尺寸比原图大时服务端会回原图，所以不用担心把小图放大。
 */
export function sized(url: string, px: number): string {
  if (!url.startsWith('http') || url.includes('?') || !url.includes('/object/')) return url
  // 归到 160 的整数倍：不同槽位算出来的尺寸收敛成几个值，缓存才命中得上
  const n = Math.min(2048, Math.max(160, Math.ceil(px / 160) * 160))
  return `${url}?type=image&width=${n}&height=${n}`
}

/** 有限并发，保持原顺序。三张图串行传要等三倍的时间，同时全开又会互相抢上行带宽。 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!)
  }))
  return out
}
