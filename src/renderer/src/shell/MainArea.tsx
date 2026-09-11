import { useState, type DragEvent } from 'react'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconPanel } from '../components/Icons'
import { directId } from '../im/translate'
import { usePlace, type Place } from '../store/selectors'
import { agentsOf, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { Composer } from '../views/Composer'
import { Stream } from '../views/Stream'
import styles from './MainArea.module.css'

/**
 * 主区：频道头 + 消息流 + 输入框。消息流和输入框按会话 key 挂载——切会话就是新的一份，
 * 滚动位置、量高缓存、草稿各归各。
 */
export function MainArea() {
  const conversationId = useUI((s) => s.conversationId)
  const place = usePlace(conversationId)
  const [dragging, setDragging] = useState(false)

  const onDragOver = (e: DragEvent): void => {
    if (!place || ![...e.dataTransfer.types].includes('Files')) return
    e.preventDefault()
    setDragging(true)
  }
  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    if (!place) return
    for (const f of e.dataTransfer.files) {
      const path = window.desktop.files.pathFor(f)
      if (!path) continue
      if (f.type.startsWith('image/')) void useSession.getState().sendPicture(place.id, path)
      else void useSession.getState().sendFile(place.id, path, f.name)
    }
  }

  if (!place) return <main className={styles.main}><Landing /></main>

  return (
    <main className={styles.main} onDragOver={onDragOver} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <Head place={place} />
      <Stream key={`stream-${place.id}`} place={place} />
      <Composer key={`composer-${place.id}`} place={place} />
      {dragging && <div className={styles.drop}><span>放开就发到 {place.kind === 'channel' ? `#${place.title}` : place.title}</span></div>}
    </main>
  )
}

function Head({ place }: { place: Place }) {
  const inspectorOpen = useUI((s) => s.inspectorOpen)
  const setInspectorOpen = useUI((s) => s.setInspectorOpen)
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
          {place.kind !== 'channel' && (
            <Avatar glyph={place.glyph} pair={place.pair} size={22} kind={place.isAgent ? 'agent' : 'human'} src={place.avatar} />
          )}
          <span className={styles.title}>{place.kind === 'channel' ? `#${place.title}` : place.title}</span>
          {place.isAgent ? (
            <span className={`${styles.tag} mono`}>{place.peer?.tag || 'AGENT'}</span>
          ) : place.groupID ? (
            <span className={`${styles.slug} mono`}>{place.groupID.slice(0, 8)}</span>
          ) : null}
        </div>
        <div className={styles.topic}>{subtitle}</div>
      </div>
      <div className={styles.right}>
        {place.kind === 'channel' && place.members.length > 0 && (
          <>
            <div className={styles.stack}>
              {place.members.slice(0, 3).map((m) => (
                <Avatar key={m.id} glyph={glyphOf(m.name)} pair={pairOf(m.id)} size={22} kind={m.isAgent ? 'agent' : 'human'} src={m.avatar} style={{ border: '2px solid var(--bg)', boxSizing: 'content-box', marginLeft: -6 }} />
              ))}
            </div>
            <span className={`${styles.count} mono`}>{place.members.length}</span>
          </>
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
              <Avatar glyph={glyphOf(a.nickname)} pair={0} size={28} kind="agent" />
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
