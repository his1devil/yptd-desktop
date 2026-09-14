import { useCallback, useEffect, useRef, useState } from 'react'
import { PhotoSlider } from 'react-photo-view'
import type { OverlayRenderProps } from 'react-photo-view/dist/types'
import 'react-photo-view/dist/react-photo-view.css'
import type { PixelSize } from '../../../shared/model'
import { IconClose, IconDownload, IconFit, IconNext, IconPrev, IconRotate, IconZoomIn, IconZoomOut } from '../components/Icons'
import { MAX_THUMB, displaySrc, thumbFor } from '../im/files'
import styles from './Lightbox.module.css'

/** 一张能看的图。natural 和 bytes 决定要不要去要缩图，别只传一个原图地址进来。 */
export interface Pic { url: string; name: string; natural: PixelSize | null; bytes: number }

const DPR = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)

/** 倍率档位。scale 是相对「适应窗口」的，不是原始像素比，所以显示成 ×1.0 而不是 100% */
const STEPS = [1, 1.25, 1.5, 2, 3, 4, 6]
const up = (s: number): number => STEPS.find((v) => v > s + 0.01) ?? STEPS[STEPS.length - 1]!
const down = (s: number): number => [...STEPS].reverse().find((v) => v < s - 0.01) ?? STEPS[0]!

/** 这个视口需要多大一张图。封顶是服务端缩图的真实上限，再往上只会拿回原文件 */
const wanted = (): number => Math.min(MAX_THUMB, Math.round(Math.max(window.innerWidth, window.innerHeight) * DPR))

/**
 * 三层详情结构的第 3 层：图片全屏，可缩放、拖动、旋转。
 *
 * 显示层用 react-photo-view 的受控模式：图片数组和当前下标由我们给，它不去扫描页面上挂着的
 * 缩略图——虚拟列表随时会把缩略图卸载，靠扫描就只能翻当前屏附近那几张。
 * 从缩略图原位放大也交给它（originRef）。
 *
 * 图片分三段上：列表里已经加载过的那张先顶上（浏览器缓存里有，零网络）→ 后台取一张按视口
 * 裁好的显示图，解码完再换 → 原图只在用户点「原图」或另存时才下。原来是开图就等原图，
 * 实测一张 3.8MB 的照片要 15 秒才出来。
 *
 * 模态语义在库 portal 那一层：它自己带 role="dialog"，但没有 aria-modal 和名字，挂载后补上。
 * 我们这个壳只用来接焦点和 data-modal（App.tsx 认它来让出应用级快捷键）。
 */
export function Lightbox({ items, index, onIndex, onClose }: { items: Pic[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const shellRef = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)
  /** 库的缩放/旋转入口只在 overlayRender 的参数里，键盘快捷键要用就得先接出来 */
  const api = useRef<OverlayRenderProps | null>(null)
  /** 每张图当前真正在显示的地址 */
  const [srcs, setSrcs] = useState<Record<string, string>>({})
  /** 用户主动要了原图的那几张，之后别再降回显示图 */
  const [full, setFull] = useState<ReadonlySet<string>>(new Set())
  /** 关闭先让库播完收起动画，afterClose 再把自己卸掉 */
  const [open, setOpen] = useState(true)
  const cur = items[index] ?? items[0]

  // 打开时把焦点收进来，关掉还回去——还回去的多半是刚点的那个缩略图
  useEffect(() => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const t = window.setTimeout(() => shellRef.current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      if (restore.current?.isConnected) restore.current.focus()
    }
  }, [])

  // 库的 portal 已经是 role="dialog"，补上 aria-modal 和名字，别再在外面套第二个 dialog
  useEffect(() => {
    const portal = document.querySelector<HTMLElement>(`.${styles.portal}`)
    if (!portal) return
    portal.setAttribute('aria-modal', 'true')
    portal.setAttribute('aria-label', `查看图片 ${cur?.name ?? ''}`)
  }, [cur?.name])

  /**
   * 每张图最后一次升级请求的编号。解码是异步的，回来的顺序不一定是发出去的顺序：
   * 显示图还在路上时点了原图，如果原图（已缓存）先解完，晚到的显示图会把原图盖回低清，
   * 而「原图」按钮这时已经消失了，没法再点一次。所以只认最后一次请求的结果。
   */
  const seq = useRef(new Map<string, number>())

  const swap = useCallback((key: string, target: string) => {
    const n = (seq.current.get(key) ?? 0) + 1
    seq.current.set(key, n)
    const img = new Image()
    img.src = target
    const done = (): void => {
      if (seq.current.get(key) !== n) return // 已经有更新的请求了，这次的结果作废
      setSrcs((s) => (s[key] === target ? s : { ...s, [key]: target }))
    }
    // 解码失败就不换：原来失败也照换，结果是一张本来能看的缩略图被换成坏图，
    // 界面上只剩一行错误，连重试的入口都没有。留着当前这张更有用。
    void (img.decode ? img.decode().then(done, () => { /* 保留现在看得见的那张 */ }) : Promise.resolve().then(done))
  }, [])

  // 只升当前这张。相邻的先用缓存里的缩图顶着，不提前占带宽。
  // 点过「原图」的那张目标就是原图本身，下完之前低清的那张一直在，不会中途变空白。
  useEffect(() => {
    if (!cur) return
    swap(cur.url, full.has(cur.url) ? cur.url : displaySrc(cur.url, wanted(), cur.natural, cur.bytes))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在换图和「要原图」时跑
  }, [cur?.url, full, swap])

  const srcOf = (p: Pic): string =>
    srcs[p.url] ?? thumbFor(p.url) ?? displaySrc(p.url, wanted(), p.natural, p.bytes)

  // 全局键：库自己只处理左右箭头和 Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const a = api.current
      if (!a || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '+' || e.key === '=') { e.preventDefault(); a.onScale(up(a.scale)) }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); a.onScale(down(a.scale)) }
      else if (e.key === '0') { e.preventDefault(); a.onScale(1); a.onRotate(0) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Tab 在层内打转，不跑到背后的界面上去。查看器的 DOM 被库 portal 到了 body，不是这个壳的后代；
  // 但 React 的事件沿组件树冒泡，所以键盘事件照样到这里，只是找可聚焦元素要去 portal 那一层找。
  const trap = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const f = [...document.querySelectorAll<HTMLElement>(`.${styles.portal} button:not(:disabled), .${styles.portal} a[href]`)]
    if (f.length === 0) { e.preventDefault(); return }
    const first = f[0]!
    const last = f[f.length - 1]!
    const active = document.activeElement
    const inside = f.includes(active as HTMLElement)
    if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus() }
  }

  if (!cur) return null

  // 已经在下原图的那张也不再显示按钮，免得重复点
  const showingThumb = srcOf(cur) !== cur.url && !full.has(cur.url)
  const close = (): void => setOpen(false)
  const save = (): void => window.desktop.files.download(cur.url, cur.name)
  const original = (): void => setFull((f) => new Set(f).add(cur.url))

  return (
    <div ref={shellRef} className={styles.shell} data-modal="true" tabIndex={-1} onKeyDown={trap}>
      <PhotoSlider
        className={styles.portal}
        // 必须关掉。库默认图片数超过 3 就开循环（loop 默认值 3），而循环模式下
        // PhotoBox 的 React key 里带着 src——换清晰度就等于换 key，组件重挂，
        // 用户刚做的缩放、旋转、拖动全部归零。工具栏本来也是首尾停止，不循环。
        loop={false}
        // 每张图挂自己的缩略图作为放大的起点。虚拟列表随时会把缩略图回收，查不到就是 null，
        // 它会退化成淡入淡出，而不是对着失效的节点做缩放
        images={items.map((p) => ({
          src: srcOf(p),
          key: p.url,
          originRef: { current: document.querySelector<HTMLElement>(`[data-shot="${CSS.escape(p.url)}"]`) },
        }))}
        visible={open}
        index={index}
        onIndexChange={onIndex}
        onClose={close}
        afterClose={onClose}
        loadingElement={<span className={styles.loading}>加载中…</span>}
        brokenElement={<span className={styles.broken}>这张图没加载出来</span>}
        // 库的 banner 和它自带的左右箭头是同一个开关，两个都关掉，翻页按钮画在下面的操作条里
        bannerVisible={false}
        // 底色留一点透明：还能看见背后的会话，知道自己没离开这条消息
        maskOpacity={0.86}
        overlayRender={(p) => {
          api.current = p
          const many = p.images.length > 1
          const name = items[p.index]?.name ?? cur.name
          return (
            <>
              <button className={styles.close} title="关闭（Esc）" onClick={close}><IconClose size={13} /></button>
              <div className={styles.bar}>
                {many && (
                  <>
                    <button className={styles.act} title="上一张（←）" disabled={p.index === 0} onClick={() => p.onIndexChange(p.index - 1)}><IconPrev /></button>
                    <span className={`${styles.count} mono`}>{p.index + 1} / {p.images.length}</span>
                    <button className={styles.act} title="下一张（→）" disabled={p.index === p.images.length - 1} onClick={() => p.onIndexChange(p.index + 1)}><IconNext /></button>
                    <i className={styles.sep} />
                  </>
                )}
                <button className={styles.act} title="缩小（-）" disabled={p.scale <= STEPS[0]!} onClick={() => p.onScale(down(p.scale))}><IconZoomOut /></button>
                <span className={`${styles.zoom} mono`}>×{p.scale.toFixed(1)}</span>
                <button className={styles.act} title="放大（+）" disabled={p.scale >= STEPS[STEPS.length - 1]!} onClick={() => p.onScale(up(p.scale))}><IconZoomIn /></button>
                <button className={styles.act} title="适应窗口（0）" onClick={() => { p.onScale(1); p.onRotate(0) }}><IconFit /></button>
                <button className={styles.act} title="旋转 90°" onClick={() => p.onRotate(p.rotate + 90)}><IconRotate /></button>
                <i className={styles.sep} />
                <span className={styles.name} title={name}>{name}</span>
                {showingThumb && <button className={styles.text} title="下载并显示原始尺寸" onClick={original}>原图</button>}
                <button className={styles.act} title="另存为…" onClick={save}><IconDownload /></button>
              </div>
            </>
          )
        }}
      />
    </div>
  )
}
