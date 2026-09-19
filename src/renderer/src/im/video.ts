/**
 * 发视频之前量一下：时长、像素尺寸、一张封面。
 *
 * 不引 ffmpeg（包要大 70 MB）——`<video>` 元素自己就能解码、能 seek、能画到 canvas 上。
 * 代价是只能处理 Chromium 认的格式（mp4/mov/webm 的常见编码）；认不出来的，调用方当普通
 * 文件发，和以前一样。
 */
export interface VideoProbe {
  duration: number
  width: number
  height: number
  /** 封面：长边 ≤ 720 的 JPEG，给接收端的视频格子用（单独上传成一个对象） */
  poster: Blob
  /** 同一帧的小图，data URL，给输入框里的预览用 */
  preview: string
}

/** 封面的长边。和 iOS 一致（docs/media-pipeline.md §2 的 p） */
const POSTER_EDGE = 720
const PREVIEW_EDGE = 320

const once = (el: HTMLElement, ok: string, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`等 ${ok} 超时`)) }, ms)
    const done = (): void => { cleanup(); resolve() }
    const fail = (): void => { cleanup(); reject(new Error('视频解不开')) }
    const cleanup = (): void => { clearTimeout(timer); el.removeEventListener(ok, done); el.removeEventListener('error', fail) }
    el.addEventListener(ok, done, { once: true })
    el.addEventListener('error', fail, { once: true })
  })

function draw(video: HTMLVideoElement, edge: number): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(2, Math.round(video.videoHeight * scale))
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}

export async function probeVideo(path: string): Promise<VideoProbe | null> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  try {
    video.src = await window.desktop.files.expose(path)
    await once(video, 'loadedmetadata', 8000)
    if (!video.videoWidth || !Number.isFinite(video.duration)) return null
    // 第一帧常常是黑的（淡入、片头），往后取一点；和 iOS 取的是同一个位置
    video.currentTime = Math.min(0.5, Math.max(0, video.duration / 10))
    await once(video, 'seeked', 8000)
    const poster = await new Promise<Blob | null>((r) => draw(video, POSTER_EDGE).toBlob(r, 'image/jpeg', 0.8))
    if (!poster) return null
    return {
      duration: video.duration, width: video.videoWidth, height: video.videoHeight,
      poster, preview: draw(video, PREVIEW_EDGE).toDataURL('image/jpeg', 0.7),
    }
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load() // 放掉解码器和文件句柄
  }
}

/** 这台服务器的出口，字节每秒。发大文件之前拿它告诉发的人：对面要等多久 */
export const UPLINK = 260 * 1024
/** 超过这么大就提示一下对面的等待时间 */
export const WARN_BYTES = 10 * 1024 * 1024
/** 视频的上限。桌面端不转码（不引 ffmpeg），只能靠上限兜住 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

/** 「接收方下载约需 …」里的那个时间 */
export function waitFor(bytes: number): string {
  const s = Math.round(bytes / UPLINK)
  return s < 90 ? `${s} 秒` : `${Math.round(s / 60)} 分钟`
}

export const clock = (seconds: number): string => {
  const t = Math.round(seconds)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
