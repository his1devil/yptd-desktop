import { useEffect, useState } from 'react'
import type { Conversation } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { ghostClass } from '../components/Dialog'
import { api, type RunSummary } from '../im/api'
import { useRuns } from '../store/runs'
import { useSession } from '../store/session'
import { useUI } from '../store/ui'
import styles from './Inbox.module.css'

/**
 * 收件箱：需要我看一眼的东西，两类——有人 @ 我或私聊我、agent 出了结果。
 * 每张卡点开就到那条消息，右上「全部标记已读」一次清掉。
 */
export function Inbox() {
  const filter = useUI((s) => s.inboxFilter)
  const conversations = useSession((s) => s.conversations)
  const roster = useSession((s) => s.roster)
  const live = useRuns((s) => s.runs)
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  useEffect(() => { void api.runs({ limit: 30 }).then(setRuns).catch(() => setRuns([])) }, [])

  const attention = conversations.filter((c) => c.unread > 0 && (c.mentioned || c.kind === 'dm' || c.kind === 'agent_session'))
  // 记录里的加上正在跑的，去重
  const seen = new Set<string>()
  const agentRuns = [
    ...Object.values(live).map((r) => ({ id: r.id, agentID: r.agentID, conversationID: r.conversationID, prompt: r.prompt, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, text: r.text, finalMsgID: r.finalMsgID, toolCount: r.tools.length, requesterID: '' }) as RunSummary),
    ...(runs ?? []),
  ].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).sort((a, b) => b.startedAt - a.startedAt)

  const showMentions = filter !== 'agent'
  const showRuns = filter !== 'mention'
  const nameOf = (id: string): string => roster.find((p) => p.userID === id)?.nickname ?? id
  const whereOf = (id: string): string => {
    const c = conversations.find((x) => x.id === id)
    if (!c) return id.startsWith('si_') ? '私聊' : id
    return c.kind === 'channel' ? `#${c.title}` : `和 ${c.title} 的私聊`
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>收件箱</div>
          <div className={styles.sub}>{attention.length} 个会话在等你 · {agentRuns.length} 次 agent 运行</div>
        </div>
        <button className={ghostClass} onClick={() => void useSession.getState().markAllRead()}>全部标记已读</button>
      </div>
      <div className={styles.list}>
        {showMentions && attention.map((c) => <AttentionCard key={c.id} c={c} />)}
        {showMentions && attention.length === 0 && filter === 'mention' && <Empty text="没有人 @ 你，也没有新的私聊。" />}
        {showRuns && agentRuns.map((r) => (
          <RunRow key={r.id} r={r} agent={nameOf(r.agentID)} where={whereOf(r.conversationID)} />
        ))}
        {showRuns && runs && agentRuns.length === 0 && filter === 'agent' && <Empty text="还没有 agent 跑过东西。在频道里 @ 一个试试。" />}
        {filter === 'all' && attention.length === 0 && runs && agentRuns.length === 0 && <Empty text="都看完了。" />}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>
}

function AttentionCard({ c }: { c: Conversation }) {
  const kind = c.kind === 'channel' ? (c.mentioned ? '@ 了你' : '未读') : c.kind === 'dm' ? '私聊' : 'agent'
  return (
    <button className={`${styles.card} ${styles.cardAt}`} onClick={() => void useSession.getState().open(c.id)}>
      {c.kind === 'channel' ? (
        <span className={`${styles.hash} mono`}>#</span>
      ) : (
        <Avatar glyph={glyphOf(c.title)} pair={pairOf(c.peerID ?? c.id)} size={30} kind={c.kind === 'agent_session' ? 'agent' : 'human'} src={c.avatar} />
      )}
      <span className={styles.body}>
        <span className={styles.row}>
          <span className={styles.who}>{c.kind === 'channel' ? `#${c.title}` : c.title}</span>
          <span className={styles.kind}>{kind}</span>
          <span className={`${styles.when} mono`}>{ago(c.lastAt)}</span>
        </span>
        <span className={styles.text}>{c.preview || '…'}</span>
      </span>
      <span className={`${styles.count} ${c.mentioned ? styles.countAt : ''} mono`}>{c.mentioned ? '@' : ''}{c.unread}</span>
    </button>
  )
}

const STATUS: Record<RunSummary['status'], string> = { running: '运行中', done: '已完成', error: '出错', cancelled: '已停止' }

function RunRow({ r, agent, where }: { r: RunSummary; agent: string; where: string }) {
  const go = (): void => {
    void useSession.getState().open(r.conversationID)
    if (r.finalMsgID) useUI.getState().setJumpTo({ conversationId: r.conversationID, messageId: r.finalMsgID })
  }
  return (
    <button className={`${styles.card} ${styles.cardRun}`} onClick={go}>
      <Avatar glyph={glyphOf(agent)} pair={0} size={30} kind="agent" />
      <span className={styles.body}>
        <span className={styles.row}>
          <span className={styles.who}>{agent}</span>
          <span className={styles.kind}>在 {where}</span>
          <span className={`${styles.pill} ${styles[`pill_${r.status}`] ?? ''}`}>{STATUS[r.status]}</span>
          <span className={`${styles.when} mono`}>{ago(r.startedAt)}</span>
        </span>
        <span className={styles.prompt}>{r.prompt || '…'}</span>
        {r.text && <span className={styles.text}>{r.text.replace(/\s+/g, ' ').slice(0, 160)}</span>}
      </span>
    </button>
  )
}

function ago(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return '刚刚'
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`
  const t = new Date(ms)
  return `${t.getMonth() + 1}/${t.getDate()}`
}
