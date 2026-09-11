import { Avatar } from '../components/Avatar'
import { IconChevronDown, IconSearch } from '../components/Icons'
import styles from './TitleBar.module.css'

/**
 * 标题栏 48px。左起：58px 红绿灯区（macOS 用原生红绿灯，这里只留位置，右边框
 * 与图标栏右边框连成同一条竖线）→ 个人中心 → 居中的搜索框。
 *
 * 搜索框要在**窗口**里居中，而它左边已经被 58 + 个人中心 156 + 边距 9 = 223px
 * 占掉了，所以容器右侧补同样的内边距做配重，否则会偏右 104px。
 */
export function TitleBar({ fullscreen }: { fullscreen: boolean }) {
  return (
    <header className={styles.bar}>
      {!fullscreen && <div className={styles.lights} />}
      <button className={styles.profile} title="个人中心">
        <Avatar glyph="幻" pair={4} size={27} presence="online" ring="var(--rail)" />
        <span className={styles.who}>
          <span className={styles.name}>张幻阳</span>
          <span className={styles.sig}>产品 · 盯 v2.4 发布</span>
        </span>
        <IconChevronDown className={styles.chev} />
      </button>
      <div className={styles.center} style={{ paddingRight: fullscreen ? 165 : 223 }}>
        <button className={styles.search} title="搜索、跳转、派活（⌘K）">
          <IconSearch />
          <span className={styles.searchText}>搜索消息、频道、agent…</span>
          <kbd className={`${styles.kbd} mono`}>⌘K</kbd>
        </button>
      </div>
    </header>
  )
}
