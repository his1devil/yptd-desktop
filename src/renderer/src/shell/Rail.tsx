import { useEffect, useRef, useState } from 'react'
import { IconAgents, IconChat, IconInbox, IconMoon, IconSettings, IconSun } from '../components/Icons'
import { useSession } from '../store/session'
import { useUI, type Section } from '../store/ui'
import styles from './Rail.module.css'

const NAV: { id: Section; name: string; Icon: typeof IconInbox }[] = [
  { id: 'inbox', name: '收件箱', Icon: IconInbox },
  { id: 'chat', name: '会话', Icon: IconChat },
  { id: 'agent', name: 'Agent', Icon: IconAgents },
]

/**
 * 图标栏，纯图标无文字。高亮读的是 section，不是会话——同一个 agent
 * 会话从私聊列表打开时这里仍亮着「会话」。高亮底是一块会滑的板。
 */
export function Rail() {
  const section = useUI((s) => s.section)
  const go = useUI((s) => s.go)
  const theme = useUI((s) => s.theme)
  const toggleTheme = useUI((s) => s.toggleTheme)
  // 收件箱角标 = 有人 @ 我还没看的会话数；「会话」上是未读总数
  const mentioned = useSession((s) => s.conversations.filter((c) => c.mentioned && c.unread > 0).length)
  const unread = useSession((s) => s.conversations.reduce((n, c) => n + c.unread, 0))
  const badges: Partial<Record<Section, number>> = { inbox: mentioned, chat: unread }

  const refs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({})
  const [y, setY] = useState<number | null>(null)
  useEffect(() => {
    const el = refs.current[section]
    setY(el ? el.offsetTop : null)
  }, [section])

  const item = (id: Section, name: string, Icon: typeof IconInbox) => (
    <button
      key={id}
      ref={(el) => { refs.current[id] = el }}
      className={`${styles.item} ${section === id ? styles.active : ''}`}
      title={name}
      onClick={() => go(id)}
    >
      <Icon />
      {badges[id] ? <span className={`${styles.badge} mono`}>{badges[id]! > 99 ? '99+' : badges[id]}</span> : null}
    </button>
  )

  return (
    <nav className={styles.rail}>
      <div className={styles.indicator} style={{ transform: `translateY(${y ?? 0}px)`, opacity: y === null ? 0 : 1 }} />
      {NAV.map(({ id, name, Icon }) => item(id, name, Icon))}
      <div className={styles.spacer} />
      <button className={styles.item} title={theme === 'dark' ? '切到浅色' : '切到深色'} onClick={(e) => toggleTheme({ x: e.clientX, y: e.clientY })}>
        {theme === 'dark' ? <IconMoon /> : <IconSun />}
      </button>
      {item('set', '设置', IconSettings)}
    </nav>
  )
}
