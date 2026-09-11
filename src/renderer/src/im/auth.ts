import type { HttpResponse } from '../../../shared/ipc'
import type { Person } from '../../../shared/model'

/**
 * yptd-server 的三个接口：邀请码注册、设备凭据登录、花名册。
 * 这一层和 OpenIM 无关——它只负责换到 im_token，然后交给 SDK 去登录。
 */
export interface ServerConfig {
  server: string
  api: string
  ws: string
}

export const DEFAULT_SERVER: ServerConfig = {
  server: 'https://im.zhanghuanyang.com/yptd',
  api: 'https://im.zhanghuanyang.com',
  ws: 'wss://im.zhanghuanyang.com/ws',
}

/** OpenIM 的平台 id。服务端拿它做多端登录策略，每条消息也带着。 */
export const PLATFORM_ID = 4 // macOS

export interface AuthSession {
  userID: string
  nickname: string
  /** 只在注册时返回，是要长期保存的设备凭据 */
  deviceToken: string
  imToken: string
}

export class AuthError extends Error {
  constructor(message: string, readonly code?: string) { super(message); this.name = 'AuthError' }
}

export async function register(cfg: ServerConfig, invite: string, nickname: string, userID?: string): Promise<AuthSession> {
  return post(`${cfg.server}/v1/register`, {
    invite_code: invite, nickname, ...(userID ? { user_id: userID } : {}), platform_id: PLATFORM_ID,
  })
}

export async function login(cfg: ServerConfig, deviceToken: string): Promise<AuthSession> {
  const s = await post(`${cfg.server}/v1/login`, { device_token: deviceToken, platform_id: PLATFORM_ID })
  // 登录不重发设备凭据，调用方手里的那份继续用
  return { ...s, deviceToken: s.deviceToken || deviceToken }
}

export async function roster(cfg: ServerConfig, deviceToken: string): Promise<Person[]> {
  const res = await window.desktop.http({ url: `${cfg.server}/v1/users`, headers: { Authorization: `Bearer ${deviceToken}` } })
  check(res)
  const data = JSON.parse(res.text) as { users?: RawPerson[] }
  return (data.users ?? []).map((u) => ({
    userID: u.user_id, nickname: u.nickname, isAgent: !!u.is_agent, tag: u.tag ?? null, color: u.color ?? null,
  }))
}

interface RawPerson { user_id: string; nickname: string; is_agent?: boolean; tag?: string; color?: string }
interface RawSession { user_id: string; nickname: string; device_token?: string; im_token: string }

async function post(url: string, body: Record<string, unknown>): Promise<AuthSession> {
  const res = await window.desktop.http({ url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  check(res)
  const r = JSON.parse(res.text) as RawSession
  if (!r.im_token) throw new AuthError('服务端没有返回 IM token')
  return { userID: r.user_id, nickname: r.nickname, deviceToken: r.device_token ?? '', imToken: r.im_token }
}

/** 读服务端自己的错误文案，让人看到「邀请码已被使用」而不是「HTTP 400」。 */
function check(res: HttpResponse): void {
  if (res.ok) return
  let detail: { error?: string; message?: string } = {}
  try { detail = JSON.parse(res.text) } catch { /* 不是 JSON 就用状态码 */ }
  throw new AuthError(detail.message ?? detail.error ?? `HTTP ${res.status}`, detail.error)
}

// ---- 凭据存取（主进程 safeStorage） ----------------------------------------------

const KEY = 'device-credential'
export interface StoredCredential { userID: string; nickname: string; deviceToken: string }

export async function loadCredential(): Promise<StoredCredential | null> {
  const raw = await window.desktop.secret.get(KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as StoredCredential } catch { return null }
}
export const saveCredential = (c: StoredCredential): Promise<void> => window.desktop.secret.set(KEY, JSON.stringify(c))
export const clearCredential = (): Promise<void> => window.desktop.secret.delete(KEY)
