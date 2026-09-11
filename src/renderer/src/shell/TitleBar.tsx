import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconChevronDown, IconSearch } from '../components/Icons'
import { useSession } from '../store/session'
import { useUI } from '../store/ui'
import styles from './TitleBar.module.css'

/**
 * 标题栏 48px。左起：58px 红绿灯区（macOS 用原生红绿灯，这里只留位置，右边框
 * 与图标栏右边框连成同一条竖线）→ 个人中心 → 居中的搜索框。
 *
 * 搜索框要在**窗口**里居中，而它左边被红绿灯区和个人中心占掉了一截。设计稿用
 * 一个写死的 223px 右内边距做配重，但那个数假设个人中心恰好 156px 宽——换一套
 * 中文字体宽度就变了，要么偏、要么签名被截。这里改成在右侧渲染一份不可见的
 * 镜像，宽度永远和左边一样，不用算。
 */
export function TitleBar({ fullscreen }: { fullscreen: boolean }) {
  const me = useSession((s) => s.me)
  const myName = useSession((s) => s.myName)
  const myAvatar = useSession((s) => s.avatars[s.me] ?? s.myAvatar)
  const connected = useSession((s) => s.connected)
  const setPalette = useUI((s) => s.setPalette)
  const setSettingsPage = useUI((s) => s.setSettingsPage)
  const cluster = (
    <>
      {!fullscreen && <div className={styles.lights} />}
      <button className={styles.profile} title="资料与设置" tabIndex={0} onClick={() => setSettingsPage('profile')}>
        <Avatar glyph={glyphOf(myName || me)} pair={pairOf(me)} size={27} src={myAvatar} presence={connected ? 'online' : 'offline'} ring="var(--rail)" />
        <span className={styles.who}>
          <span className={styles.name}>{myName || me}</span>
          <span className={`${styles.sig} mono`}>{connected ? `@${me}` : '连接中…'}</span>
        </span>
        <IconChevronDown className={styles.chev} />
      </button>
    </>
  )
  return (
    <header className={styles.bar}>
      {cluster}
      <div className={styles.center}>
        <button className={styles.search} title="搜索、跳转、派活（⌘K）" onClick={() => setPalette(true)}>
          <IconSearch />
          <span className={styles.searchText}>搜索消息、频道、agent…</span>
          <kbd className={`${styles.kbd} mono`}>⌘K</kbd>
        </button>
      </div>
      <div className={styles.balance} aria-hidden>{cluster}</div>
    </header>
  )
}
