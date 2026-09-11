import { useUpdate } from '../store/update'
import styles from './UpdateBanner.module.css'

/** 右下角一条：新版本下好了，重启装上；下载中显示进度。不打断正在做的事。 */
export function UpdateBanner() {
  const status = useUpdate((s) => s.status)
  const dismissed = useUpdate((s) => s.dismissed)
  const install = useUpdate((s) => s.install)
  const dismiss = useUpdate((s) => s.dismiss)
  if (status.kind !== 'ready' && status.kind !== 'downloading') return null
  if (dismissed === status.version) return null
  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} />
      <span className={styles.text}>
        {status.kind === 'ready' ? (
          <>新版本 <span className="mono">v{status.version}</span> 已下载好</>
        ) : (
          <>正在下载 <span className="mono">v{status.version}</span> · {status.percent}%</>
        )}
      </span>
      {status.kind === 'ready' && <button className={styles.primary} onClick={install}>重启安装</button>}
      <button className={styles.ghost} onClick={dismiss}>稍后</button>
    </div>
  )
}
