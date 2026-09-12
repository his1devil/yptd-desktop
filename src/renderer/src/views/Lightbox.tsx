import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../components/Icons'
import styles from './Lightbox.module.css'

/** 一张能看的图 */
export interface Pic { url: string; name: string }

/**
 * 三层详情结构的第 3 层：图片全屏。
 *
 * 送到 body 下面，不受消息区的布局、层叠和祖先 transform 影响（0.3.4 就是被主区的启动动画
 * 坑成了半屏遮罩）。模态该有的都有：焦点进来后限制在层内，Esc 或点空白关闭，关掉焦点还回原处，
 * 打开期间应用级快捷键让位（App.tsx 认 data-modal）。同一条消息里的图用左右键切。
 */
export function Lightbox({ items, index, onIndex, onClose }: { items: Pic[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)
  const cur = items[index] ?? items[0]
  const many = items.length > 1
  const go = (step: number): void => onIndex((index + step + items.length) % items.length)

  // 打开时把焦点收进来，关掉还回去——还回去的多半是刚点的那个缩略图
  useEffect(() => {
    restore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    return () => { if (restore.current?.isConnected) restore.current.focus() }
  }, [])

  // Esc 关、左右切。挂在 window 上：焦点万一被别处抢走，这两个键也还管用
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowLeft' && many) { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight' && many) { e.preventDefault(); go(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Tab 在层内打转，不跑到背后的界面上去
  const trap = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return
    const f = [...(ref.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])]
    if (f.length === 0) { e.preventDefault(); return }
    const first = f[0]!
    const last = f[f.length - 1]!
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  }

  if (!cur) return null
  return createPortal(
    <div
      ref={ref}
      className={styles.layer}
      role="dialog"
      aria-modal="true"
      aria-label={`查看图片 ${cur.name}`}
      data-modal="true"
      tabIndex={-1}
      onKeyDown={trap}
      onMouseDown={onClose}
    >
      <img className={styles.img} src={cur.url} alt={cur.name} draggable={false} onMouseDown={(e) => e.stopPropagation()} />

      <button className={styles.close} title="关闭（Esc）" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
        <IconClose />
      </button>

      {many && (
        <>
          <button className={`${styles.nav} ${styles.prev}`} title="上一张（←）" onClick={() => go(-1)} onMouseDown={(e) => e.stopPropagation()}>‹</button>
          <button className={`${styles.nav} ${styles.next}`} title="下一张（→）" onClick={() => go(1)} onMouseDown={(e) => e.stopPropagation()}>›</button>
        </>
      )}

      <div className={styles.bar} onMouseDown={(e) => e.stopPropagation()}>
        {many && <span className={`${styles.count} mono`}>{index + 1} / {items.length}</span>}
        <span className="mono">{cur.name}</span>
        <a href={cur.url} target="_blank" rel="noreferrer">在浏览器里打开</a>
      </div>
    </div>,
    document.body,
  )
}
