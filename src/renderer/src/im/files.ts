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

/** 刚发出去的图：服务端地址 → 本机缩略图。回显换成服务端地址时先用它铺底，不闪一下空白 */
const previews = new Map<string, string>()
export const rememberPreview = (url: string, dataURL: string | null): void => { if (dataURL) previews.set(url, dataURL) }
export const previewFor = (url: string): string | undefined => previews.get(url)
