import { useEffect, useState } from 'react'
import { Avatar, glyphOf } from '../components/Avatar'
import { api, type AgentProfile as Profile, type RunSummary } from '../im/api'
import { encodePolicy, parsePolicy, verificationFor, type ChannelPolicy } from '../im/channel'
import { im } from '../im/client'
import { loadAgents } from '../store/agents'
import type { Place } from '../store/selectors'
import { useRuns } from '../store/runs'
import { describe, useSession } from '../store/session'
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
        <Avatar glyph={glyphOf(name)} pair={0} size={44} kind="agent" id={place.peer?.userID} src={avatar} />
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

/**
 * 频道设置：两个开关。
 *
 * 只有群主和管理员改得动——OpenIM 的 setGroupInfo 本来就只让他们写，所以这里
 * 不用再造一套权限。但**所有人都看得见**：知道自己待的这个频道是公开的还是私密的，
 * 本身就是有用的信息，藏起来只会让人以为它不存在。
 */
export function ChannelSettings({ place }: { place: Place }): React.ReactElement {
  const me = useSession((s) => s.me)
  const canEdit = place.members.some((m) => m.id === me && (m.role === 'owner' || m.role === 'admin'))
  const [policy, setPolicy] = useState<ChannelPolicy | null>(null)
  const [busy, setBusy] = useState<keyof ChannelPolicy | null>(null)
  const [err, setErr] = useState('')

  const groupID = place.groupID
  useEffect(() => {
    if (!groupID) return
    let alive = true
    void im.groupInfo(groupID)
      .then((g) => { if (alive) setPolicy(parsePolicy(g?.ex)) })
      .catch((e) => { if (alive) setErr(describe(e)) })
    return () => { alive = false }
  }, [groupID])

  const flip = async (key: keyof ChannelPolicy, value: boolean): Promise<void> => {
    if (!policy || !groupID) return
    const next = { ...policy, [key]: value }
    setBusy(key); setErr('')
    setPolicy(next) // 先画出来，失败再退回去
    try {
      // ex 和 needVerification 必须一起写：只改 ex 的话，一个「可加入」的频道
      // 仍然停在「要验证」上，每次加入都变成一条没人会批的挂起申请。
      await im.setGroupInfo(groupID, { ex: encodePolicy(next), needVerification: verificationFor(next) })
    } catch (e) {
      setPolicy(policy)
      setErr(describe(e))
    } finally { setBusy(null) }
  }

  if (!groupID) return <div className={styles.empty}>这里不是频道</div>
  return (
    <div className={styles.pad}>
      {err && <div className={styles.err}>{err}</div>}
      <label className={styles.switchRow}>
        <input type="checkbox" disabled={!policy || !canEdit || busy !== null}
          checked={!!policy?.findable} onChange={(e) => void flip('findable', e.target.checked)} />
        <span>能被搜到</span>
      </label>
      <p className={styles.note}>关着的时候，只有知道这个频道的人找得到它——⌘K 里搜不出来。</p>

      <label className={styles.switchRow}>
        <input type="checkbox" disabled={!policy || !canEdit || busy !== null}
          checked={!!policy?.joinable} onChange={(e) => void flip('joinable', e.target.checked)} />
        <span>允许自己加入</span>
      </label>
      <p className={styles.note}>
        关着的时候只能被邀请进来。别人自己申请加入会被服务端拒绝——不是客户端不给按钮，是真的进不来。
      </p>

      {!canEdit && <p className={styles.note}>只有频道的群主和管理员能改这两项。</p>}
    </div>
  )
}
