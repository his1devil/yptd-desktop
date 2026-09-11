import { useEffect, type ReactNode } from 'react'
import { IconClose } from './Icons'
import styles from './Dialog.module.css'

/**
 * 模态卡：三层详情结构里的"全屏层"，用来做新建频道、邀请、改名这类要人填几个字的事。
 * Esc 或点空白关掉；焦点留在卡里。
 */
export function Dialog({ title, width = 440, onClose, children, footer }: { title: string; width?: number; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.card} style={{ width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          <button className={styles.close} title="关闭" onClick={onClose}><IconClose /></button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.foot}>{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
    </label>
  )
}

export const inputClass = styles.input
export const primaryClass = styles.primary
export const ghostClass = styles.ghost
export const dangerClass = styles.danger
export const errorClass = styles.error
