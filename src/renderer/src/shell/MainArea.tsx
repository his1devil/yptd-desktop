import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconMore, IconPanel, IconSearch } from '../components/Icons'
import { directId } from '../im/translate'
import { usePlace, type Place } from '../store/selectors'
import { agentsOf, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { Composer } from '../views/Composer'
import { composerBus } from '../views/composerBus'
import { Inbox } from '../views/Inbox'
import { Settings } from '../views/Settings'
import { Stream } from '../views/Stream'
import { Welcome } from '../views/Welcome'
import styles from './MainArea.module.css'

/**
 * 主区：频道头 + 消息流 + 输入框。消息流和输入框按会话 key 挂载——切会话就是新的一份，
 * 滚动位置、量高缓存、草稿各归各。
 */
/**
 * 侧栏收起时，红绿灯会浮到主区上。这一条负责给它们让位，并补回侧栏里那两个入口：
 * 展开侧栏和搜索。侧栏展开时它整条不存在。
 *
 * 放在 MainArea 这层而不是会话头部里——收件箱和设置页没有会话头部，
 * 挂在头部里的话，侧栏一收起那两个页面就再也展不开了。
 */
function TopBar() {
  const open = useUI((s) => s.sidebarOpen)
  if (open) return null
  return (
    <div className={styles.topbar}>
      <button className={styles.iconBtn} title="展开侧栏（⌘\\）" onClick={() => useUI.getState().setSidebarOpen(true)}><IconPanel size={17} /></button>
      <button className={styles.iconBtn} title="搜索、跳转、派活（⌘K）" onClick={() => useUI.getState().setPalette(true)}><IconSearch size={16} /></button>
    </div>
  )
}

export function MainArea() {
  const section = useUI((s) => s.section)
  const conversationId = useUI((s) => s.conversationId)
  const place = usePlace(conversationId)
  const welcome = useUI((s) => s.welcome)
  const [dragging, setDragging] = useState(false)

  if (section === 'inbox') return <main className={styles.main}><TopBar /><Inbox /></main>
  if (section === 'set') return <main className={styles.main}><TopBar /><Settings /></main>

  const onDragOver = (e: DragEvent): void => {
    if (!place || ![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (!place) return
    // 先进输入框的附件栏，让人看一眼、配上文字再发
    composerBus.attach([...e.dataTransfer.files])
  }

  if (!place) return <main className={styles.main}><TopBar />{welcome ? <Welcome /> : <Landing />}</main>

  return (
    <main className={styles.main} onDragOver={onDragOver} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <TopBar />
      <Head place={place} />
      <Stream key={`stream-${place.id}`} place={place} />
      <Composer key={`composer-${place.id}`} place={place} />
      {dragging && <div className={styles.drop}><span>放开，先放进输入框</span></div>}
    </main>
  )
}

function Head({ place }: { place: Place }) {
  const inspectorOpen = useUI((s) => s.inspectorOpen)
  const setInspectorOpen = useUI((s) => s.setInspectorOpen)
  const openDialog = useUI((s) => s.openDialog)
  const me = useSession((s) => s.me)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])
  const owner = place.members.some((m) => m.id === me && m.role === 'owner')
  const agents = place.members.filter((m) => m.isAgent).length
  const subtitle = place.kind === 'channel'
    ? place.members.length ? `${place.members.length} 位成员${agents ? ` · ${agents} 个 agent` : ''}` : '频道'
    : place.isAgent
      ? '直接派活或追问，回答会出现在这里'
      : `和 ${place.title} 的私聊`

  return (
    <div className={styles.head}>
      <div className={styles.titleBlock}>
        <div className={styles.titleRow}>
          {/* 切会话时这两个是「共享元素」：从旧位置滑到新位置，眼睛盯着的东西一直在 */}
          {place.kind !== 'channel' && (
            <Avatar glyph={place.glyph} pair={place.pair} size={22} kind={place.isAgent ? 'agent' : 'human'} id={place.peer?.userID} src={place.avatar} style={{ viewTransitionName: 'conv-avatar' }} />
          )}
          <span className={styles.title} style={{ viewTransitionName: 'conv-title' }}>{place.kind === 'channel' ? `#${place.title}` : place.title}</span>
          {/* 群号挪到右栏成员页了：它是查东西时才用的，占着标题行没意义 */}
          {place.isAgent && <span className={`${styles.tag} mono`}>{place.peer?.tag || 'AGENT'}</span>}
        </div>
        <div className={styles.topic}>{subtitle}</div>
      </div>
      <div className={styles.right}>
        {place.kind === 'channel' && place.members.length > 0 && (
          <>
            <div className={styles.stack}>
              {place.members.slice(0, 3).map((m) => (
                <Avatar key={m.id} glyph={glyphOf(m.name)} pair={pairOf(m.id)} size={26} kind={m.isAgent ? 'agent' : 'human'} id={m.id} src={m.avatar} style={{ border: '2px solid var(--bg)', boxSizing: 'content-box', marginLeft: -7 }} />
              ))}
            </div>
            <span className={`${styles.count} mono`}>{place.members.length}</span>
          </>
        )}
        {place.groupID && (
          <div className={styles.menuWrap} ref={menuRef}>
            <button className={styles.panelBtn} title="频道操作" onClick={() => setMenu((m) => !m)}><IconMore /></button>
            {menu && (
              <div className={styles.menu}>
                <button className={styles.menuItem} onClick={() => { setMenu(false); openDialog({ kind: 'invite', groupID: place.groupID! }) }}>邀请成员</button>
                <button className={styles.menuItem} onClick={() => { setMenu(false); openDialog({ kind: 'rename', groupID: place.groupID!, current: place.title }) }}>改频道名</button>
                <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => { setMenu(false); openDialog({ kind: 'leave', groupID: place.groupID!, owner, title: place.title }) }}>{owner ? '解散频道' : '退出频道'}</button>
              </div>
            )}
          </div>
        )}
        <button className={styles.panelBtn} title={inspectorOpen ? '收起右侧栏' : '展开右侧栏'} onClick={() => setInspectorOpen(!inspectorOpen)}>
          <IconPanel open={inspectorOpen} />
        </button>
      </div>
    </div>
  )
}

/** 没选会话时的主区。新账号第一眼看到的就是它，所以把「找 agent 聊」放在手边。 */
function Landing() {
  const roster = useSession((s) => s.roster)
  const me = useSession((s) => s.me)
  const conversations = useSession((s) => s.conversations)
  const agents = agentsOf(roster)
  return (
    <div className={styles.landing}>
      <div className={styles.landingTitle}>{conversations.length ? '挑一个会话开始' : '还没有会话'}</div>
      <div className={styles.landingDesc}>左边是频道、私聊和常驻的 agent。在频道里 @ 一个 agent 就是派活；也可以直接找它单聊。</div>
      {agents.length > 0 && (
        <div className={styles.landingAgents}>
          {agents.map((a) => (
            <button key={a.userID} className={styles.landingAgent} onClick={() => void useSession.getState().open(directId(me, a.userID))}>
              <Avatar glyph={glyphOf(a.nickname)} pair={0} size={28} kind="agent" id={a.userID} />
              <span className={styles.landingAgentText}>
                <span className={styles.landingAgentName}>{a.nickname}</span>
                <span className={`${styles.landingAgentTag} mono`}>{a.tag || 'AGENT'}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
