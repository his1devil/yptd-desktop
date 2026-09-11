import { IconPanel } from '../components/Icons'
import { useUI } from '../store/ui'
import styles from './MainArea.module.css'

/**
 * 主区。M0 只有频道头骨架和一块空白，用来校外壳比例；
 * M2 换成虚拟化消息流与输入框。
 */
export function MainArea() {
  const conversationId = useUI((s) => s.conversationId)
  const inspectorOpen = useUI((s) => s.inspectorOpen)
  const setInspectorOpen = useUI((s) => s.setInspectorOpen)

  const title = conversationId?.startsWith('ch:') ? conversationId.slice(3) : conversationId ?? 'engineering'

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <span className={styles.title}>#{title}</span>
            <span className={`${styles.slug} mono`}>ch:{title.slice(0, 3)}</span>
          </div>
          <div className={styles.topic}>线上故障分诊 · Triage 分诊在这里值班</div>
        </div>
        <div className={styles.right}>
          <div className={styles.stack}>
            {['知', '越', '帆'].map((g, i) => (
              <span key={g} className={styles.stackAv} style={{ background: `var(--a${i + 1}bg)`, color: `var(--a${i + 1}fg)` }}>{g}</span>
            ))}
          </div>
          <span className={`${styles.count} mono`}>12</span>
          <button className={styles.panelBtn} title={inspectorOpen ? '收起右侧栏' : '展开右侧栏'} onClick={() => setInspectorOpen(!inspectorOpen)}>
            <IconPanel open={inspectorOpen} />
          </button>
        </div>
      </div>
      <div className={styles.stream} />
    </main>
  )
}
