import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconSearch } from '../components/Icons'
import { api } from '../im/api'
import { im } from '../im/client'
import { directId } from '../im/translate'
import { knownPeople } from '../store/mentions'
import { agentsOf, describe, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import styles from './CommandPalette.module.css'

/**
 * ⌘K：一个框，搜会话、agent、成员、消息，回车就到。
 * 在频道里搜到 agent 时多一条「在这个频道里 @ 它派活」，这是设计稿里"派活"的入口。
 */
interface Item {
  key: string
  group: '会话' | 'AGENT' | '成员' | '频道' | '消息'
  title: string
  sub: string
  avatar?: { glyph: string; pair: number; agent?: boolean; id?: string | null; src?: string | null; hash?: boolean }
  run(): void
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen)
  const setOpen = useUI((s) => s.setPalette)
  if (!open) return null
  return <Palette onClose={() => setOpen(false)} />
}

function Palette({ onClose }: { onClose(): void }) {
  const conversations = useSession((s) => s.conversations)
  const roster = useSession((s) => s.roster)
  const allMembers = useSession((s) => s.members)
  // 名册只列开放了搜索的人；同群的人也该找得到，不然关了搜索就等于对同事失联
  const people = useMemo(() => knownPeople(roster, allMembers), [roster, allMembers])
  const me = useSession((s) => s.me)
  const avatars = useSession((s) => s.avatars)
  const currentId = useUI((s) => s.conversationId)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [hits, setHits] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const current = conversations.find((c) => c.id === currentId)
  const inChannel = current?.kind === 'channel'

  // 这里也能找人，同样在打开时补一次（store 那边有节流，和选人面板不会打架）
  useEffect(() => { void useSession.getState().refreshRoster() }, [])

  // 频道目录：只有这条能找到「还没加入的频道」——SDK 的 searchGroups 只搜本地库，
  // 本地库里只有已经加入的群。走网络，所以比消息搜索多等一会儿。
  const [channels, setChannels] = useState<{ group_id: string; name: string; members: number; joinable: boolean }[]>([])
  useEffect(() => {
    const kw = q.trim()
    if (kw.length < 2) { setChannels([]); return }
    let alive = true
    const t = window.setTimeout(() => {
      api.channels(kw)
        .then((r) => { if (alive) setChannels(r.channels) })
        .catch(() => { if (alive) setChannels([]) }) // 找不到频道不该把整个搜索框弄坏
    }, 300)
    return () => { alive = false; window.clearTimeout(t) }
  }, [q])

  // 消息全文搜索：两个字起，停 200ms 再搜
  useEffect(() => {
    const kw = q.trim()
    if (kw.length < 2) { setHits([]); return }
    const t = window.setTimeout(() => {
      im.searchMessages(kw, 20).then((r) => {
        const out: Item[] = []
        for (const conv of r.searchResultItems ?? []) {
          for (const m of conv.messageList ?? []) {
            const text = m.textElem?.content ?? m.atTextElem?.text ?? m.quoteElem?.text ?? ''
            if (!text) continue
            out.push({
              key: `m:${m.clientMsgID}`, group: '消息',
              title: text.replace(/\s+/g, ' ').slice(0, 90),
              sub: `${m.senderNickname || m.sendID} · ${conv.showName || conv.conversationID}`,
              run: () => {
                void useSession.getState().open(conv.conversationID)
                useUI.getState().setJumpTo({ conversationId: conv.conversationID, messageId: m.clientMsgID ?? '' })
              },
            })
          }
        }
        setHits(out)
      }).catch(() => setHits([]))
    }, 200)
    return () => window.clearTimeout(t)
  }, [q])

  const items = useMemo<Item[]>(() => {
    const kw = q.trim().toLowerCase()
    const match = (...xs: string[]) => !kw || xs.some((x) => x.toLowerCase().includes(kw))
    const open = (id: string) => () => { void useSession.getState().open(id) }
    const conv: Item[] = conversations
      .filter((c) => match(c.title))
      .slice(0, kw ? 8 : 6)
      .map((c) => ({
        key: `c:${c.id}`, group: '会话', title: c.kind === 'channel' ? `#${c.title}` : c.title,
        sub: c.kind === 'channel' ? '频道' : c.kind === 'dm' ? '私聊' : 'agent 会话',
        avatar: c.kind === 'channel' ? { glyph: '#', pair: 0, hash: true } : { glyph: glyphOf(c.title), pair: pairOf(c.peerID ?? c.id), agent: c.kind === 'agent_session', id: c.peerID, src: c.avatar },
        run: open(c.id),
      }))
    const agents: Item[] = agentsOf(people).filter((a) => match(a.nickname, a.tag ?? '')).flatMap((a) => {
      const av = { glyph: glyphOf(a.nickname), pair: 0, agent: true, id: a.userID }
      const out: Item[] = []
      if (inChannel && current) {
        out.push({
          key: `a:${a.userID}:here`, group: 'AGENT', title: `在 #${current.title} 里派活给 ${a.nickname}`, sub: a.tag ?? 'AGENT', avatar: av,
          run: () => composerBus.insert(`@${a.nickname} `),
        })
      }
      out.push({ key: `a:${a.userID}`, group: 'AGENT', title: `和 ${a.nickname} 单聊`, sub: a.tag ?? 'AGENT', avatar: av, run: open(directId(me, a.userID)) })
      return out
    })
    const humans: Item[] = people
      .filter((p) => !p.isAgent && p.userID !== me && match(p.nickname, p.userID))
      .slice(0, 8)
      .map((p) => ({
        key: `p:${p.userID}`, group: '成员', title: p.nickname, sub: `@${p.userID} · 私聊`,
        avatar: { glyph: glyphOf(p.nickname), pair: pairOf(p.userID), src: avatars[p.userID] ?? null },
        run: open(directId(me, p.userID)),
      }))
    const rooms: Item[] = channels.map((c) => ({
      key: `c:${c.group_id}`, group: '频道' as const,
      title: c.name,
      sub: c.joinable ? `${c.members} 位成员 · 回车加入` : `${c.members} 位成员 · 只能被邀请`,
      avatar: { glyph: '#', pair: 0, hash: true },
      run: () => {
        if (!c.joinable) {
          // 不开放自由加入的频道也照样列出来：知道它存在、去找人要邀请，
          // 比假装它不存在有用。但别让回车变成一次注定失败的请求。
          useSession.setState({ notice: `「${c.name}」没有开放自由加入，找频道里的人邀请你` })
          return
        }
        void useSession.getState().joinChannel(c.group_id).catch((e) => {
          useSession.setState({ notice: `加入失败：${describe(e)}` })
        })
      },
    }))
    return [...conv, ...agents, ...humans, ...rooms, ...hits]
  }, [q, conversations, people, me, avatars, hits, channels, inChannel, current])

  useEffect(() => { setIdx(0) }, [q, items.length])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const pick = (it: Item | undefined): void => { if (!it) return; it.run(); onClose() }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[idx]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  let lastGroup = ''
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <IconSearch size={14} />
          <input ref={inputRef} className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="搜会话、成员、agent、消息… 回车打开" autoFocus spellCheck={false} />
          <kbd className={`${styles.kbd} mono`}>ESC</kbd>
        </div>
        <div ref={listRef} className={styles.list}>
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.key}>
                {head && <div className={`${styles.group} mono`}>{head}</div>}
                <button data-idx={i} className={`${styles.item} ${i === idx ? styles.itemOn : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(it)}>
                  {it.avatar?.hash ? (
                    <span className={`${styles.hash} mono`}>#</span>
                  ) : it.avatar ? (
                    <Avatar glyph={it.avatar.glyph} pair={it.avatar.pair} size={22} kind={it.avatar.agent ? 'agent' : 'human'} id={it.avatar.id} src={it.avatar.src} />
                  ) : (
                    <span className={styles.msgDot} />
                  )}
                  <span className={styles.itemText}>
                    <span className={styles.itemTitle}>{it.title}</span>
                    <span className={styles.itemSub}>{it.sub}</span>
                  </span>
                  {i === idx && <span className={`${styles.enter} mono`}>↵</span>}
                </button>
              </div>
            )
          })}
          {items.length === 0 && <div className={styles.none}>{q.trim().length < 2 ? '再打一两个字' : '没找到'}</div>}
        </div>
      </div>
    </div>
  )
}
