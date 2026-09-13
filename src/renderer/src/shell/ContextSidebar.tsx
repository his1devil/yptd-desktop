import { useRef, type ReactNode } from 'react'
import type { Conversation, Person } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconChevronDown, IconPanel, IconPlus, IconSearch } from '../components/Icons'
import { directId } from '../im/translate'
import { useFlip } from '../motion/useFlip'
import { agentsOf, useSession } from '../store/session'
import { useUI, type InboxFilter } from '../store/ui'
import styles from './ContextSidebar.module.css'

/**
 * 侧栏 268px，非模态：所有入口和会话列表在同一列里，点哪个主区换哪个，列表不消失。
 *
 * 没有独立标题栏——红绿灯直接坐在这一列的左上角（顶栏那 72px 是给它们留的空位），
 * 收起按钮在同一行的右端。收起之后这一列宽度归零，让位的 72px 由主区头部接管。
 *
 * 搜索坐在收件箱上面，个人资料在最底下。
 */
export function ContextSidebar({ fullscreen }: { fullscreen: boolean }) {
  const open = useUI((s) => s.sidebarOpen)
  const setOpen = useUI((s) => s.setSidebarOpen)
  return (
    <aside className={`${styles.side} ${open ? '' : styles.shut}`} aria-hidden={!open}>
      <div className={styles.inner}>
        <div className={styles.top}>
          {/* 红绿灯是原生的，这里只留位置；全屏时它们消失，位置也不用留 */}
          {!fullscreen && <div className={styles.lights} />}
          <div className={styles.topFill} />
          <button className={styles.topBtn} title="收起侧栏（⌘\)" onClick={() => setOpen(false)}><IconPanel size={17} /></button>
        </div>
        <div className={styles.fixed}>
          <button className={styles.search} title="搜索、跳转、派活（⌘K）" onClick={() => useUI.getState().setPalette(true)}>
            <IconSearch size={14} />
            <span className={styles.searchText}>搜索</span>
            <kbd className={`${styles.kbd} mono`}>⌘K</kbd>
          </button>
        </div>
        <InboxGroup />
        <ChatList />
        <Foot />
      </div>
    </aside>
  )
}

const INBOX_FILTERS: { id: InboxFilter; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'mention', name: '提及我的' },
  { id: 'agent', name: 'Agent 结果' },
]

/** 收件箱的三个筛选本来是页内的一排标签页，摆进侧栏当分组之后少一次跳转 */
function InboxGroup() {
  const section = useUI((s) => s.section)
  const filter = useUI((s) => s.inboxFilter)
  const conversations = useSession((s) => s.conversations)
  const mentions = conversations.filter((c) => c.unread > 0 && (c.mentioned || c.kind === 'dm' || c.kind === 'agent_session')).length
  return (
    <div className={styles.fixed}>
      <Group id="inbox" title="收件箱">
        {INBOX_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`${styles.item} ${section === 'inbox' && filter === f.id ? styles.active : ''}`}
            onClick={() => { useUI.getState().setInboxFilter(f.id); useUI.getState().go('inbox') }}
          >
            <span className={styles.dot} />
            <span className={styles.text}><span className={styles.name}>{f.name}</span></span>
            {f.id === 'mention' && mentions > 0 && <span className={`${styles.count} ${styles.countAt} mono`}>{mentions > 99 ? '99+' : mentions}</span>}
          </button>
        ))}
      </Group>
    </div>
  )
}

function Foot() {
  const section = useUI((s) => s.section)
  const me = useSession((s) => s.me)
  const myName = useSession((s) => s.myName)
  const myAvatar = useSession((s) => s.avatars[s.me] ?? s.myAvatar)
  const connected = useSession((s) => s.connected)
  const bio = useSession((s) => s.myBio)
  return (
    <div className={styles.foot}>
      {/* 只留头像这一个入口：点它就是进设置，原来上面那条「设置」是同一个去处 */}
      <button className={`${styles.me} ${section === 'set' ? styles.meOn : ''}`} title="资料与设置" onClick={() => useUI.getState().setSettingsPage('profile')}>
        <Avatar glyph={glyphOf(myName || me)} pair={pairOf(me)} size={26} src={myAvatar} presence={connected ? 'online' : 'offline'} ring="var(--sub)" />
        <span className={styles.text}>
          <span className={styles.meName}>{myName || me}</span>
          {/* 写了签名就显示签名，没写才回落到账号名 */}
          <span className={`${styles.sub} ${bio ? '' : 'mono'}`}>{!connected ? '连接中…' : bio || `@${me}`}</span>
        </span>
      </button>
    </div>
  )
}

/** 一个可折叠的分组。收起状态按 id 记在 ui store 里，跨重启保留。 */
function Group({ id, title, action, children, empty }: {
  id: string
  title: string
  action?: ReactNode
  children: ReactNode[]
  empty?: ReactNode
}) {
  const collapsed = useUI((s) => !!s.collapsed[id])
  const toggle = useUI((s) => s.toggleGroup)
  const n = children.length
  return (
    <section className={styles.group}>
      <div className={styles.groupHead}>
        <button className={styles.groupTitle} onClick={() => toggle(id)} aria-expanded={!collapsed}>
          <IconChevronDown size={10} className={`${styles.chev} ${collapsed ? styles.chevOff : ''}`} />
          <span>{title}</span>
          {/* 收起来之后条数是唯一还看得见的量，展开时它是多余的 */}
          {collapsed && n > 0 && <span className={`${styles.groupN} mono`}>{n}</span>}
        </button>
        {action}
      </div>
      {!collapsed && (n ? children : empty ? <div className={styles.emptyLine}>{empty}</div> : null)}
    </section>
  )
}

function ConversationItem({ c, active }: { c: Conversation; active: boolean }) {
  const isChannel = c.kind === 'channel'
  const isAgent = c.kind === 'agent_session'
  return (
    <button className={`${styles.item} ${active ? styles.active : ''} ${c.unread ? styles.unread : ''}`} data-flip={c.id} onClick={() => void useSession.getState().open(c.id)}>
      {isChannel ? (
        <span className={`${styles.hash} mono`}>#</span>
      ) : (
        <Avatar glyph={glyphOf(c.title)} pair={pairOf(c.peerID ?? c.id)} size={20} kind={isAgent ? 'agent' : 'human'} id={c.peerID} src={c.avatar} />
      )}
      <span className={styles.text}>
        <span className={styles.name}>{c.title}</span>
        {isAgent && c.preview && <span className={styles.sub}>{c.preview}</span>}
      </span>
      {/* 数字变了就换一个节点，让它重新弹一次 */}
      {c.unread > 0 && <span key={c.unread} className={`${styles.count} ${c.mentioned ? styles.countAt : ''} mono`}>{c.mentioned ? '@' : ''}{c.unread > 99 ? '99+' : c.unread}</span>}
    </button>
  )
}

/** 名册里的 agent，不管有没有聊过都常驻在这里 */
function AgentItem({ a, active, unread, sub }: { a: Person; active: boolean; unread: number; sub?: string }) {
  const me = useSession((s) => s.me)
  return (
    <button className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => void useSession.getState().open(directId(me, a.userID))}>
      <Avatar glyph={glyphOf(a.nickname)} pair={0} size={20} kind="agent" id={a.userID} />
      <span className={styles.text}>
        <span className={styles.name}>{a.nickname}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
      {unread > 0 && <span className={`${styles.count} mono`}>{unread}</span>}
    </button>
  )
}

function ChatList() {
  const conversationId = useUI((s) => s.conversationId)
  const section = useUI((s) => s.section)
  const conversations = useSession((s) => s.conversations)
  const roster = useSession((s) => s.roster)
  const me = useSession((s) => s.me)
  const channels = conversations.filter((c) => c.kind === 'channel')
  const dms = conversations.filter((c) => c.kind === 'dm')
  const unreadOf = (a: Person): number => conversations.find((c) => c.id === directId(me, a.userID))?.unread ?? 0
  // 会话只在会话区里算"选中"；停在收件箱或设置时列表不该有高亮
  const on = (id: string): boolean => section === 'chat' && id === conversationId
  // 新消息把会话顶上去时，它是滑上去的，不是跳
  const listRef = useRef<HTMLDivElement>(null)
  useFlip(listRef, [conversations])

  const plus = (title: string, onClick: () => void) => (
    <button className={styles.groupBtn} title={title} onClick={onClick}><IconPlus size={13} /></button>
  )

  return (
    <div className={styles.scroll} ref={listRef}>
      <Group
        id="channels"
        title="频道"
        action={plus('新建频道', () => useUI.getState().openDialog({ kind: 'newChannel' }))}
        empty={<>还没有频道 · <button className={styles.emptyAction} onClick={() => useUI.getState().openDialog({ kind: 'newChannel' })}>新建一个</button></>}
      >
        {channels.map((c) => <ConversationItem key={c.id} c={c} active={on(c.id)} />)}
      </Group>
      <Group
        id="dms"
        title="私聊"
        action={plus('找人（⌘K）', () => useUI.getState().setPalette(true))}
        empty={<>还没有私聊 · <button className={styles.emptyAction} onClick={() => useUI.getState().setPalette(true)}>⌘K 找人</button></>}
      >
        {dms.map((c) => <ConversationItem key={c.id} c={c} active={on(c.id)} />)}
      </Group>
      <Group id="agents" title="Agents" empty="名册里还没有 agent">
        {agentsOf(roster).map((a) => (
          <AgentItem key={a.userID} a={a} active={on(directId(me, a.userID))} unread={unreadOf(a)} sub={a.tag ?? undefined} />
        ))}
      </Group>
    </div>
  )
}
