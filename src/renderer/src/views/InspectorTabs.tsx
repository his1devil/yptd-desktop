import { useEffect, useState } from 'react'
import { Avatar, glyphOf } from '../components/Avatar'
import { api, type AgentProfile as Profile, type RunSummary } from '../im/api'
import { loadAgents } from '../store/agents'
import type { Place } from '../store/selectors'
import { useRuns } from '../store/runs'
import { useSession } from '../store/session'
import { useUI } from '../store/ui'
import styles from './InspectorTabs.module.css'

/** 右侧栏的两个基础页签内容：agent 的资料、一个会话里的运行记录。 */

export function AgentProfile({ place }: { place: Place }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const avatar = useSession((s) => (place.peer ? s.avatars[place.peer.userID] : undefined))
  useEffect(() => {
    let alive = true
    void loadAgents().then((list) => { if (alive) setProfile(list.find((a) => a.userID === place.peer?.userID) ?? null) }).catch(() => {})
    return () => { alive = false }
  }, [place.peer?.userID])
  const name = place.peer?.nickname ?? place.title
  return (
    <div className={styles.profile}>
      <div className={styles.identity}>
        <Avatar glyph={glyphOf(name)} pair={0} size={44} kind="agent" src={avatar} />
        <div className={styles.idText}>
          <div className={styles.name}>{name}</div>
          <div className={styles.tagRow}>
            <span className={`${styles.tag} mono`}>{profile?.tag ?? place.peer?.tag ?? 'AGENT'}</span>
            <span className={`${styles.id} mono`}>@{place.peer?.userID}</span>
          </div>
        </div>
      </div>
      <p className={styles.desc}>{profile?.description || '（这个 agent 还没写自我介绍）'}</p>
      <dl className={styles.facts}>
        <dt>模型</dt><dd className="mono">{profile?.model || '—'}</dd>
        <dt>人设</dt><dd className="mono">{profile?.opencode || '—'}</dd>
        <dt>怎么用</dt><dd>在这里直接说；或在频道里 @{name} 派活，它会带着频道上下文回答。</dd>
      </dl>
    </div>
  )
}

const STATUS: Record<RunSummary['status'], string> = { running: '运行中', done: '已完成', error: '出错', cancelled: '已停止' }

export function RunsList({ place }: { place: Place }) {
  const roster = useSession((s) => s.roster)
  const live = useRuns((s) => s.runs)
  const [stored, setStored] = useState<RunSummary[] | null>(null)
  useEffect(() => {
    let alive = true
    setStored(null)
    void api.runs({ conversation: place.id, limit: 40 }).then((r) => { if (alive) setStored(r) }).catch(() => { if (alive) setStored([]) })
    return () => { alive = false }
  }, [place.id])

  const seen = new Set<string>()
  const runs: RunSummary[] = [
    ...Object.values(live).filter((r) => r.conversationID === place.id).map((r) => ({
      id: r.id, agentID: r.agentID, conversationID: r.conversationID, requesterID: '', prompt: r.prompt, status: r.status,
      startedAt: r.startedAt, endedAt: r.endedAt, text: r.text, toolCount: r.tools.length, finalMsgID: r.finalMsgID,
    })),
    ...(stored ?? []),
  ].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).sort((a, b) => b.startedAt - a.startedAt)

  const nameOf = (id: string): string => roster.find((p) => p.userID === id)?.nickname ?? id
  const jump = (r: RunSummary): void => {
    if (r.finalMsgID) useUI.getState().setJumpTo({ conversationId: place.id, messageId: r.finalMsgID })
  }

  if (stored === null && runs.length === 0) return <div className={styles.empty}>正在读运行记录…</div>
  if (runs.length === 0) return <div className={styles.empty}>这里还没有 agent 跑过东西。{place.kind === 'channel' ? '@ 一个 agent 试试。' : '直接说要做什么。'}</div>
  return (
    <div className={styles.runs}>
      {runs.map((r) => (
        <button key={r.id} className={styles.run} onClick={() => jump(r)} title="跳到这条回答">
          <div className={styles.runHead}>
            <span className={`${styles.runId} mono`}>#{r.id.slice(4, 10).toUpperCase()}</span>
            <span className={styles.runAgent}>{nameOf(r.agentID)}</span>
            <span className={`${styles.pill} ${styles[`pill_${r.status}`] ?? ''}`}>{STATUS[r.status]}</span>
            <span className={`${styles.runWhen} mono`}>{when(r.startedAt)}{r.endedAt ? ` · ${Math.round((r.endedAt - r.startedAt) / 1000)}s` : ''}</span>
          </div>
          <div className={styles.runPrompt}>{r.prompt || '…'}</div>
          {r.toolCount > 0 && <div className={`${styles.runMeta} mono`}>{r.toolCount} 次工具调用</div>}
        </button>
      ))}
    </div>
  )
}

const when = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
