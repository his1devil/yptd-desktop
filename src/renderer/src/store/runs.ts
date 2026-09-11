import { create } from 'zustand'
import type { StreamBatch } from '../../../shared/ipc'
import { serverAuth } from '../im/auth'

/**
 * agent 运行的实时状态。
 *
 * 服务端把一次运行记成追加日志（思考、正文、工具、用量、结束），流过来先是一份快照，
 * 之后是增量。这里把它们折成"当前值"。几百个 token 的增量不逐个进 store：先攒在
 * 缓冲里，每帧最多提交一次——只有这一次运行的组件会重画，消息列表的其他行不动。
 */
export interface ToolCall {
  callID: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'error'
  title?: string
  input?: string
  output?: string
  error?: string
  startedAt?: number
  endedAt?: number
}

export interface RunState {
  id: string
  agentID: string
  conversationID: string
  prompt: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  startedAt: number
  endedAt: number | null
  /** 本地看到第一个正文字的时刻——"思考了多久"就是它减开始时间；从记录里加载的没有 */
  firstTextAt: number | null
  thinking: string
  text: string
  tools: ToolCall[]
  usage: { input: number; output: number; reasoning: number; cost: number; steps: number }
  error: string | null
  finalMsgID: string | null
  /** 流断了且服务端没说结束——显示成"连接断了"，让人重连 */
  detached: boolean
}

interface RunsState {
  runs: Record<string, RunState>
  /** 接上一次运行的实时流；已经接着就什么都不做 */
  attach(runID: string): void
  /** 结束了的运行按需从记录里取一次（历史消息展开思考/工具时） */
  load(runID: string): Promise<void>
  cancel(runID: string): Promise<void>
}

// ---- 服务端事件的形状 ----------------------------------------------------------------

interface Snapshot {
  id: string; agent_id: string; conversation_id: string; prompt?: string; status: RunState['status']
  started_at: number; ended_at?: number; thinking: string; text: string
  tools: RawTool[]; usage: RunState['usage']; error?: string; final_msg_id?: string; seq: number
}
interface RawTool {
  call_id: string; name: string; status: ToolCall['status']; title?: string
  input?: string; output?: string; error?: string; started_at?: number; ended_at?: number
}
interface Envelope<T> { seq: number; type: string; at: number; data: T }

const fromSnapshot = (s: Snapshot, prev?: RunState): RunState => ({
  id: s.id, agentID: s.agent_id, conversationID: s.conversation_id, prompt: s.prompt ?? '', status: s.status,
  startedAt: s.started_at, endedAt: s.ended_at ?? null, firstTextAt: prev?.firstTextAt ?? null,
  thinking: s.thinking ?? '', text: s.text ?? '',
  tools: (s.tools ?? []).map(fromTool),
  usage: s.usage ?? { input: 0, output: 0, reasoning: 0, cost: 0, steps: 0 },
  error: s.error ?? null, finalMsgID: s.final_msg_id ?? null,
  detached: prev?.detached ?? false,
})
const fromTool = (t: RawTool): ToolCall => ({
  callID: t.call_id, name: t.name, status: t.status, title: t.title, input: t.input, output: t.output,
  error: t.error, startedAt: t.started_at, endedAt: t.ended_at,
})

// ---- 帧内合并 -------------------------------------------------------------------------

/** 一帧里攒下的改动，提交时一次性折进 store */
interface Pending { thinking: string; text: string; tools: ToolCall[]; rest: Partial<RunState> }
const pending = new Map<string, Pending>()
let flushScheduled = false
const schedule = (): void => {
  if (flushScheduled) return
  flushScheduled = true
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16)
  raf(() => { flushScheduled = false; flush() })
}
const pendingFor = (id: string): Pending => {
  let p = pending.get(id)
  if (!p) pending.set(id, (p = { thinking: '', text: '', tools: [], rest: {} }))
  return p
}

function flush(): void {
  if (pending.size === 0) return
  // 复制一份再清：batch 和 pending 是同一个 Map 的话，clear 会把自己也清空
  const batch = new Map(pending)
  pending.clear()
  useRuns.setState((s) => {
    const runs = { ...s.runs }
    for (const [id, p] of batch) {
      const cur = runs[id]
      if (!cur) continue
      let tools = cur.tools
      if (p.tools.length) {
        tools = [...cur.tools]
        for (const t of p.tools) {
          const i = tools.findIndex((x) => x.callID === t.callID)
          // 后来的状态只带它知道的字段：undefined 不能把先前的入参、开始时间冲掉
          if (i >= 0) tools[i] = mergeTool(tools[i]!, t)
          else tools.push(t)
        }
      }
      const firstTextAt = cur.firstTextAt ?? (cur.text === '' && p.text !== '' ? Date.now() : null)
      runs[id] = { ...cur, ...p.rest, thinking: cur.thinking + p.thinking, text: cur.text + p.text, tools, firstTextAt }
    }
    return { runs }
  })
}

function mergeTool(prev: ToolCall, next: ToolCall): ToolCall {
  const out: ToolCall = { ...prev }
  for (const k of Object.keys(next) as (keyof ToolCall)[]) {
    const v = next[k]
    if (v !== undefined && v !== '') (out as unknown as Record<string, unknown>)[k] = v
  }
  return out
}

// ---- 流 -----------------------------------------------------------------------------

const streams = new Map<string, number>()   // runID -> stream id
const byStream = new Map<number, string>()  // stream id -> runID
let listening = false

function listen(): void {
  if (listening || typeof window === 'undefined' || !window.desktop?.stream) return
  listening = true
  window.desktop.stream.onBatch(onBatch)
}

export function onBatch(batch: StreamBatch): void {
  const runID = byStream.get(batch.id)
  if (!runID) return
  for (const { event, data } of batch.events) apply(runID, event, data)
  if (batch.closed) {
    byStream.delete(batch.id)
    streams.delete(runID)
    // 同一批里可能就带着 done：先把攒着的提交了再判断
    flush()
    const cur = useRuns.getState().runs[runID]
    // 服务端说完了才算完；没说完就断了，标出来
    if (cur && cur.status === 'running') { pendingFor(runID).rest.detached = true; schedule() }
  }
}

/** 一条服务端事件折进运行。导出给测试。 */
export function apply(runID: string, event: string, data: string): void {
  let payload: unknown
  try { payload = JSON.parse(data) } catch { return }
  switch (event) {
    case 'snapshot': {
      const snap = payload as Snapshot
      // 快照是全量：直接换，之前攒的增量作废
      pending.delete(runID)
      useRuns.setState((s) => ({ runs: { ...s.runs, [runID]: fromSnapshot(snap, s.runs[runID]) } }))
      return
    }
    case 'thinking': pendingFor(runID).thinking += (payload as Envelope<{ delta: string }>).data.delta; break
    case 'text': pendingFor(runID).text += (payload as Envelope<{ delta: string }>).data.delta; break
    case 'tool': pendingFor(runID).tools.push(fromTool((payload as Envelope<RawTool>).data)); break
    case 'step': pendingFor(runID).rest.usage = (payload as Envelope<RunState['usage']>).data; break
    case 'error': {
      const p = pendingFor(runID)
      p.rest.status = 'error'; p.rest.error = (payload as Envelope<{ message: string }>).data.message
      break
    }
    case 'cancelled': pendingFor(runID).rest.status = 'cancelled'; break
    case 'done': {
      const d = (payload as Envelope<{ status: RunState['status']; final_msg_id: string; ended_at: number }>).data
      const p = pendingFor(runID)
      p.rest.status = d.status; p.rest.finalMsgID = d.final_msg_id || null; p.rest.endedAt = d.ended_at; p.rest.detached = false
      break
    }
    default: return
  }
  schedule()
}

export const useRuns = create<RunsState>()((set, get) => ({
  runs: {},

  attach(runID) {
    if (streams.has(runID)) return
    const cur = get().runs[runID]
    if (cur && cur.status !== 'running') return
    listen()
    const { base, token } = serverAuth()
    if (!base || !token) return
    streams.set(runID, -1) // 占住，避免同一帧里两个组件各开一条
    void window.desktop.stream.open(`${base}/v1/runs/${runID}/events`, { Authorization: `Bearer ${token}` }).then((id) => {
      streams.set(runID, id)
      byStream.set(id, runID)
    })
  },

  async load(runID) {
    if (get().runs[runID]) return
    const { base, token } = serverAuth()
    try {
      const res = await window.desktop.http({ url: `${base}/v1/runs/${runID}`, headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const snap = JSON.parse(res.text) as Snapshot
      set((s) => ({ runs: { ...s.runs, [runID]: fromSnapshot(snap) } }))
    } catch { /* 没拿到就不显示细节 */ }
  },

  async cancel(runID) {
    const { base, token } = serverAuth()
    await window.desktop.http({ url: `${base}/v1/runs/${runID}/cancel`, method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  },
}))

/** 只给测试：把一条流绑到一个运行上，不经过主进程 */
export function bindForTest(streamID: number, runID: string): void {
  streams.set(runID, streamID)
  byStream.set(streamID, runID)
}
export const flushForTest = flush
