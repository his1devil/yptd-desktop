import { useEffect } from 'react'
import { useSession } from '../store/session'
import { IconClose } from './Icons'
import styles from './Toast.module.css'

/** 会话层的一句话提示（发送失败、被踢下线……），6 秒自己消失。 */
export function Toast() {
  const notice = useSession((s) => s.notice)
  const dismiss = useSession((s) => s.dismissNotice)
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(dismiss, 6000)
    return () => window.clearTimeout(t)
  }, [notice, dismiss])
  if (!notice) return null
  return (
    <div className={styles.toast} role="status">
      <span className={styles.text}>{notice}</span>
      <button className={styles.close} title="关闭" onClick={dismiss}><IconClose size={11} /></button>
    </div>
  )
}
