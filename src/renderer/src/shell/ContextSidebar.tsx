import type { ReactNode } from 'react'
import type { Conversation, Person } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconPlus } from '../components/Icons'
import { directId } from '../im/translate'
import { agentsOf, useSession } from '../store/session'
import { useUI, type InboxFilter, type Section } from '../store/ui'
import { SETTINGS_PAGES } from '../views/Settings'
import styles from './ContextSidebar.module.css'

/**
 * 上下文侧栏 252px。内容读 section：会话区是频道 / 私聊 / 常驻 agent，
 * Agent 区是会话 / 已启用，收件箱和设置是分组（M5 接内容）。
 */
export function ContextSidebar() {
  const section = useUI((s) => s.section)
  return (
    <aside className={styles.side}>
      {section === 'chat' ? <ChatList /> : section === 'agent' ? <AgentList /> : section === 'set' ? <SettingsList /> : section === 'inbox' ? <InboxList /> : <Static section={section} />}
    </aside>
  )
}

function SettingsList() {
  const page = useUI((s) => s.settingsPage)
  const setPage = useUI((s) => s.setSettingsPage)
  const group = (g: 'workspace' | 'personal') => SETTINGS_PAGES.filter((p) => p.group === g).map((p) => (
    <button key={p.id} className={`${styles.item} ${page === p.id ? styles.active : ''}`} onClick={() => setPage(p.id)}>
      <span className={styles.dot} />
      <span className={styles.text}><span className={styles.name}>{p.name}</span></span>
    </button>
  ))
  return (
    <>
      <Header title="设置" />
      <div className={styles.scroll}>
        <Group title="工作区 WORKSPACE">{group('workspace')}</Group>
        <Group title="个人 PERSONAL">{group('personal')}</Group>
      </div>
    </>
  )
}

function InboxList() {
  const filter = useUI((s) => s.inboxFilter)
  const setFilter = useUI((s) => s.setInboxFilter)
  const conversations = useSession((s) => s.conversations)
  const mentions = conversations.filter((c) => c.unread > 0 && (c.mentioned || c.kind === 'dm' || c.kind === 'agent_session')).length
  const items: { id: InboxFilter; name: string; badge?: number }[] = [
    { id: 'all', name: '全部' },
    { id: 'mention', name: '@提及我的 / 私聊', badge: mentions },
    { id: 'agent', name: 'Agent 结果' },
  ]
  return (
    <>
      <Header title="收件箱" />
      <div className={styles.scroll}>
        <Group title="筛选 FILTER">
          {items.map((it) => (
            <button key={it.id} className={`${styles.item} ${filter === it.id ? styles.active : ''}`} onClick={() => setFilter(it.id)}>
              <span className={styles.dot} />
              <span className={styles.text}><span className={styles.name}>{it.name}</span></span>
              {it.badge ? <span className={`${styles.count} mono`}>{it.badge}</span> : null}
            </button>
          ))}
        </Group>
      </div>
    </>
  )
}

function Header({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className={styles.head}>
      <span className={styles.heading}>{title}</span>
      {action}
    </div>
  )
}

function Group({ title, children, empty }: { title: string; children: ReactNode[]; empty?: string }) {
  return (
    <section className={styles.group}>
      <div className={`${styles.groupTitle} mono`}>{title}</div>
      {children.length ? children : empty ? <div className={styles.emptyLine}>{empty}</div> : null}
    </section>
  )
}

function ConversationItem({ c, active }: { c: Conversation; active: boolean }) {
  const isChannel = c.kind === 'channel'
  const isAgent = c.kind === 'agent_session'
  return (
    <button className={`${styles.item} ${active ? styles.active : ''} ${c.unread ? styles.unread : ''}`} onClick={() => void useSession.getState().open(c.id)}>
      {isChannel ? (
        <span className={`${styles.hash} mono`}>#</span>
      ) : (
        <Avatar glyph={glyphOf(c.title)} pair={pairOf(c.peerID ?? c.id)} size={20} kind={isAgent ? 'agent' : 'human'} src={c.avatar} />
      )}
      <span className={styles.text}>
        <span className={styles.name}>{c.title}</span>
        {isAgent && c.preview && <span className={styles.sub}>{c.preview}</span>}
      </span>
      {c.unread > 0 && <span className={`${styles.count} ${c.mentioned ? styles.countAt : ''} mono`}>{c.mentioned ? '@' : ''}{c.unread > 99 ? '99+' : c.unread}</span>}
    </button>
  )
}

/** 名册里的 agent，不管有没有聊过都常驻在这里 */
function AgentItem({ a, active, unread, sub }: { a: Person; active: boolean; unread: number; sub?: string }) {
  const me = useSession((s) => s.me)
  return (
    <button className={`${styles.item} ${active ? styles.active : ''}`} onClick={() => void useSession.getState().open(directId(me, a.userID))}>
      <Avatar glyph={glyphOf(a.nickname)} pair={0} size={20} kind="agent" />
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
  const conversations = useSession((s) => s.conversations)
  const roster = useSession((s) => s.roster)
  const me = useSession((s) => s.me)
  const channels = conversations.filter((c) => c.kind === 'channel')
  const dms = conversations.filter((c) => c.kind === 'dm')
  const unreadOf = (a: Person): number => conversations.find((c) => c.id === directId(me, a.userID))?.unread ?? 0

  return (
    <>
      <Header title="会话" action={<button className={styles.headBtn} title="新建频道" onClick={() => useUI.getState().openDialog({ kind: 'newChannel' })}><IconPlus /></button>} />
      <div className={styles.scroll}>
        <Group title="频道 CHANNELS" empty="还没有频道">
          {channels.map((c) => <ConversationItem key={c.id} c={c} active={c.id === conversationId} />)}
        </Group>
        <Group title="私聊 DIRECT" empty="还没有私聊">
          {dms.map((c) => <ConversationItem key={c.id} c={c} active={c.id === conversationId} />)}
        </Group>
        <Group title="AGENTS">
          {agentsOf(roster).map((a) => (
            <AgentItem key={a.userID} a={a} active={directId(me, a.userID) === conversationId} unread={unreadOf(a)} sub={a.tag ?? undefined} />
          ))}
        </Group>
      </div>
    </>
  )
}

function AgentList() {
  const conversationId = useUI((s) => s.conversationId)
  const conversations = useSession((s) => s.conversations)
  const roster = useSession((s) => s.roster)
  const me = useSession((s) => s.me)
  const sessions = conversations.filter((c) => c.kind === 'agent_session')
  return (
    <>
      <Header title="Agent" />
      <div className={styles.scroll}>
        <Group title="会话 SESSIONS" empty="还没和 agent 聊过">
          {sessions.map((c) => <ConversationItem key={c.id} c={c} active={c.id === conversationId} />)}
        </Group>
        <Group title="已启用 ENABLED" empty="名册里还没有 agent">
          {agentsOf(roster).map((a) => (
            <AgentItem key={a.userID} a={a} active={directId(me, a.userID) === conversationId} unread={0} sub={a.tag ?? undefined} />
          ))}
        </Group>
      </div>
    </>
  )
}

// ---- 还没接真数据的区段，保留设计稿的分组骨架 ----------------------------------------

const STATIC: Record<Exclude<Section, 'chat' | 'agent' | 'set' | 'inbox'>, { heading: string; groups: { title: string; items: string[] }[] }> = {
  vm: { heading: '运行机器', groups: [] },
  lib: { heading: '知识库', groups: [] },
  market: { heading: 'Agent 市场', groups: [] },
}

function Static({ section }: { section: Exclude<Section, 'chat' | 'agent' | 'set' | 'inbox'> }) {
  const { heading, groups } = STATIC[section]
  return (
    <>
      <Header title={heading} />
      <div className={styles.scroll}>
        {groups.map((g) => (
          <Group key={g.title} title={g.title}>
            {g.items.map((name) => (
              <button key={name} className={styles.item}>
                <span className={styles.dot} />
                <span className={styles.text}><span className={styles.name}>{name}</span></span>
              </button>
            ))}
          </Group>
        ))}
        {groups.length === 0 && <div className={styles.emptyLine}>即将推出</div>}
      </div>
    </>
  )
}
