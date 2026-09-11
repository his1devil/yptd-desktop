import { useEffect } from 'react'
import styles from './Lightbox.module.css'

/** 三层详情结构的第 3 层：图片全屏。点空白或按 Esc 关。 */
export function Lightbox({ url, name, onClose }: { url: string; name: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={styles.layer} onMouseDown={onClose}>
      <img className={styles.img} src={url} alt={name} draggable={false} onMouseDown={(e) => e.stopPropagation()} />
      <div className={styles.bar} onMouseDown={(e) => e.stopPropagation()}>
        <span className="mono">{name}</span>
        <a href={url} target="_blank" rel="noreferrer">在浏览器里打开</a>
      </div>
    </div>
  )
}
