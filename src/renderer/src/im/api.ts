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
  rename: (nickname: string) => call<{ user_id: string; nickname: string }>('/v1/me', { method: 'PATCH', body: { nickname } }),
  /** 我是谁，以及这个账号有没有设过密码 */
  me: () => call<{ user_id: string; nickname: string; disabled: boolean; has_password: boolean; discoverable: boolean; joinable: boolean }>('/v1/me'),
  /** 两个隐私开关，各自可单独改：不传的那个不动 */
  privacy: (p: { discoverable?: boolean; joinable?: boolean }) =>
    call<{ discoverable: boolean; joinable: boolean }>('/v1/me/privacy', { method: 'PUT', body: p }),
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
