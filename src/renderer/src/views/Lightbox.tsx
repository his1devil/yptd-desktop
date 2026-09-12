import { useEffect, useRef } from 'react'
import { PhotoSlider } from 'react-photo-view'
import 'react-photo-view/dist/react-photo-view.css'
import { IconClose } from '../components/Icons'
import styles from './Lightbox.module.css'

/** 一张能看的图 */
export interface Pic { url: string; name: string }

/**
 * 三层详情结构的第 3 层：图片全屏，可缩放、拖动、旋转。
 *
 * 显示层用 react-photo-view 的受控模式：图片数组和当前下标由我们给，它不去扫描页面上挂着的
 * 缩略图——虚拟列表随时会把缩略图卸载，靠扫描就只能翻当前屏附近那几张。
 * 从缩略图原位放大也交给它（originRef）。
 *
 * 模态那一套仍然是我们自己的：它不设 role/aria-modal，也不做焦点约束。
 * 焦点进来后限制在层内，关掉还回原来的缩略图；打开期间应用级快捷键让位（App.tsx 认 data-modal）。
 */
export function Lightbox({ items, index, onIndex, onClose }: { items: Pic[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const shellRef = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)
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

  // Tab 在层内打转，不跑到背后的界面上去。
  // 查看器的 DOM 被库 portal 到了 body，不是我们这个壳的后代；但 React 的事件沿组件树冒泡，
  // 所以键盘事件照样到这里，只是找可聚焦元素要去它那一层找。
  const trap = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const f = [...document.querySelectorAll<HTMLElement>('.PhotoView-Portal button, .PhotoView-Portal a[href]')]
    if (f.length === 0) { e.preventDefault(); return }
    const first = f[0]!
    const last = f[f.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === shellRef.current || !f.includes(active as HTMLElement))) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && (active === last || !f.includes(active as HTMLElement))) { e.preventDefault(); first.focus() }
  }

  if (!cur) return null
  return (
    <div ref={shellRef} className={styles.shell} data-modal="true" role="dialog" aria-modal="true" aria-label={`查看图片 ${cur.name}`} tabIndex={-1} onKeyDown={trap}>
      <PhotoSlider
        // 每张图挂自己的缩略图作为放大的起点。虚拟列表随时会把缩略图回收，查不到就是 null，
        // 它会退化成淡入淡出，而不是对着失效的节点做缩放
        images={items.map((p) => ({
          src: p.url,
          key: p.url,
          originRef: { current: document.querySelector<HTMLElement>(`[data-shot="${CSS.escape(p.url)}"]`) },
        }))}
        visible
        index={index}
        onIndexChange={onIndex}
        onClose={onClose}
        loadingElement={<span className={styles.loading}>加载中…</span>}
        brokenElement={<span className={styles.broken}>这张图没加载出来</span>}
        bannerVisible={false}
        // 底色留一点透明：还能看见背后的会话，知道自己没离开这条消息
        maskOpacity={0.86}
        overlayRender={({ index: i, images }) => (
          <>
            <button className={styles.close} title="关闭（Esc）" onClick={onClose}><IconClose /></button>
            <div className={styles.bar}>
              {images.length > 1 && <span className={`${styles.count} mono`}>{i + 1} / {images.length}</span>}
              <span className="mono">{items[i]?.name ?? cur.name}</span>
              <a href={items[i]?.url ?? cur.url} target="_blank" rel="noreferrer">在浏览器里打开</a>
            </div>
          </>
        )}
      />
    </div>
  )
}
