import { serverAuth } from './auth'

/**
 * yptd-server 在登录之外的几个接口：名册里的 agent 是谁、最近的运行、邀请码、改昵称。
 * 都走主进程的 http（CORS），都带设备凭据。
 */

export interface AgentProfile {
  userID: string
  nickname: string
  tag: string
  color: string | null
  model: string
  opencode: string
  description: string
}

export interface RunSummary {
  id: string
  agentID: string
  conversationID: string
  requesterID: string
  prompt: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  startedAt: number
  endedAt: number | null
  text: string
  toolCount: number
  finalMsgID: string | null
}

export interface Invite {
  code: string
  note: string
  createdAt: number
  expiresAt: number
  expired: boolean
  usedBy: string | null
  usedAt: number | null
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'ApiError' }
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { base, token } = serverAuth()
  const res = await window.desktop.http({
    url: `${base}${path}`,
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    let detail: { error?: string; message?: string } = {}
    try { detail = JSON.parse(res.text) } catch { /* 用状态码 */ }
    throw new ApiError(detail.message ?? detail.error ?? `HTTP ${res.status}`, res.status, detail.error)
  }
  return JSON.parse(res.text) as T
}

export const api = {
  async agents(): Promise<AgentProfile[]> {
    const r = await call<{ agents: RawAgent[] }>('/v1/agents')
    return r.agents.map((a) => ({
      userID: a.user_id, nickname: a.nickname, tag: a.tag || 'AGENT', color: a.color ?? null,
      model: a.model ?? '', opencode: a.opencode ?? '', description: a.description ?? '',
    }))
  },
  async runs(opts: { conversation?: string; limit?: number } = {}): Promise<RunSummary[]> {
    const q = new URLSearchParams()
    if (opts.conversation) q.set('conversation', opts.conversation)
    if (opts.limit) q.set('limit', String(opts.limit))
    const r = await call<{ runs: RawRun[] }>(`/v1/runs${q.size ? `?${q}` : ''}`)
    return r.runs.map((x) => ({
      id: x.id, agentID: x.agent_id, conversationID: x.conversation_id, requesterID: x.requester_id ?? '',
      prompt: x.prompt ?? '', status: x.status, startedAt: x.started_at, endedAt: x.ended_at ?? null,
      text: x.text ?? '', toolCount: x.tools?.length ?? 0, finalMsgID: x.final_msg_id ?? null,
    }))
  },
  async invites(all = false): Promise<Invite[]> {
    const r = await call<{ invites: RawInvite[] }>(`/v1/invites${all ? '?all=1' : ''}`)
    return r.invites.map(fromInvite)
  },
  async createInvites(note: string, count = 1): Promise<Invite[]> {
    const r = await call<{ invites: RawInvite[] }>('/v1/invites', { method: 'POST', body: { note, count } })
    return r.invites.map(fromInvite)
  },
  /** 把 agent 移出频道。服务端验资格（群主或邀请人）、让它在群里道个别、清掉它在这个频道的配置 */
  removeAgent: (groupID: string, agentID: string) =>
    call<{ ok: boolean }>(`/v1/groups/${encodeURIComponent(groupID)}/agents/${encodeURIComponent(agentID)}`, { method: 'DELETE' }),
  rename: (nickname: string) => call<{ user_id: string; nickname: string }>('/v1/me', { method: 'PATCH', body: { nickname } }),
  /** 我是谁，以及这个账号有没有设过密码 */
  me: () => call<{ user_id: string; nickname: string; disabled: boolean; has_password: boolean; discoverable: boolean; joinable: boolean }>('/v1/me'),
  /** 两个隐私开关，各自可单独改：不传的那个不动 */
  privacy: (p: { discoverable?: boolean; joinable?: boolean }) =>
    call<{ discoverable: boolean; joinable: boolean }>('/v1/me/privacy', { method: 'PUT', body: p }),
  /**
   * agent 在某个频道里怎么表现。表单由服务端描述（字段、类型、范围、每个字段的
   * 解释），客户端按 type 通用渲染——以后加新 agent 不用改客户端。
   */
  agentConfig: (agentID: string, groupID: string) =>
    call<AgentConfig>(`/v1/agents/${encodeURIComponent(agentID)}/config?group=${encodeURIComponent(groupID)}`),
  saveAgentConfig: (agentID: string, groupID: string, value: Record<string, unknown>) =>
    call<{ ok: boolean }>(`/v1/agents/${encodeURIComponent(agentID)}/config?group=${encodeURIComponent(groupID)}`,
      { method: 'PUT', body: value }),
  /**
   * 频道的两个开关。**写必须走服务端，不要自己 setGroupInfo 写 `ex`。**
   *
   * 要守的不变量是 `ex.join=1` 必须配 `needVerification=Directly`：前者管目录和入群钩子，
   * 后者管「放进来的请求到底插不插人」。两者脱钩的后果是静默的——按钮在、请求成功、
   * 人不出现，哪里都不报错。服务端一次写完两个字段，这条规律就只有一处实现。
   *
   * 读还是客户端自己做（`parsePolicy(group.ex)`），那边没有不变量问题。
   */
  channelPolicy: (groupID: string) =>
    call<{ findable: boolean; joinable: boolean }>(`/v1/groups/${encodeURIComponent(groupID)}/channel`),
  setChannelPolicy: (groupID: string, p: { findable: boolean; joinable: boolean }) =>
    call<{ findable: boolean; joinable: boolean }>(
      `/v1/groups/${encodeURIComponent(groupID)}/channel`, { method: 'PUT', body: p }),
  /** 频道目录。客户端 SDK 的 searchGroups 只搜本地库，找没加入的频道只能走这里。 */
  channels: (q: string) =>
    call<{ channels: { group_id: string; name: string; members: number; joinable: boolean }[] }>(
      `/v1/channels?q=${encodeURIComponent(q)}`),
  /** 按完整 ID 找人。没开放被搜索的人只有这一条路找得到，所以不接受前缀和昵称。 */
  lookup: (id: string) =>
    call<{ user: { user_id: string; nickname: string; is_agent?: boolean; tag?: string; color?: string } }>(`/v1/users/${encodeURIComponent(id)}`),
  /** 设置或修改密码。已经有密码时必须给对旧的——不然谁碰到这台没锁的机器都能悄悄接管账号 */
  setPassword: (password: string, oldPassword?: string) =>
    call<{ has_password: boolean }>('/v1/me/password', { method: 'PUT', body: { password, ...(oldPassword ? { old_password: oldPassword } : {}) } }),
}

interface RawAgent { user_id: string; nickname: string; tag?: string; color?: string; model?: string; opencode?: string; description?: string }
interface RawRun {
  id: string; agent_id: string; conversation_id: string; requester_id?: string; prompt?: string
  status: RunSummary['status']; started_at: number; ended_at?: number; text?: string
  tools?: unknown[]; final_msg_id?: string
}
interface RawInvite { code: string; note?: string; created_at?: number; expires_at: number; expired?: boolean; used_by?: string; used_at?: number }
const fromInvite = (i: RawInvite): Invite => ({
  code: i.code, note: i.note ?? '', createdAt: i.created_at ?? 0, expiresAt: i.expires_at,
  expired: !!i.expired, usedBy: i.used_by ?? null, usedAt: i.used_at ?? null,
})

/** 服务端下发的表单描述 */
export interface AgentField {
  key: string
  /** symbols 是带校验的标签输入，number 是数字，duration 是时长，text 是一行字 */
  type: 'symbols' | 'number' | 'duration' | 'text'
  label: string
  hint?: string
  unit?: string
  min?: number | string
  max?: number | string
  step?: number
}

export interface AgentConfig {
  form: { kind: string; title: string; note?: string; fields: AgentField[] }
  /** 这个频道有没有单独配过。没配过时 value 是名册里的默认值。 */
  configured: boolean
  value: Record<string, unknown>
  updated_by?: string
  updated_at?: number
}
