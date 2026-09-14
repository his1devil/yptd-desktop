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

/** 安装包的稳定地址（publish.sh 每次发版把 latest 链接指到新版）；邀请文案里写它 */
export const DOWNLOADS = 'https://im.zhanghuanyang.com/dl/desktop/'

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

export async function register(cfg: ServerConfig, invite: string, nickname: string, password?: string): Promise<AuthSession> {
  return post(`${cfg.server}/v1/register`, {
    invite_code: invite, nickname, ...(password ? { password } : {}), platform_id: PLATFORM_ID,
  })
}

/**
 * 用账号和密码登录：这台机器上没有设备凭据时的入口。
 *
 * 服务端会发一份新的设备凭据，之后这台机器就自动登录了，和用邀请码进来的机器没有区别。
 */
export async function loginWithPassword(cfg: ServerConfig, userID: string, password: string): Promise<AuthSession> {
  return post(`${cfg.server}/v1/login/password`, {
    user_id: userID, password, device_name: deviceName(), platform_id: PLATFORM_ID,
  })
}

/** 这台机器叫什么，服务端记在凭据上，设置里能看到是哪台机器 */
function deviceName(): string {
  if (typeof navigator === 'undefined') return 'yptd desktop'
  return /Mac/.test(navigator.platform || navigator.userAgent) ? 'Mac' : 'yptd desktop'
}

export interface InviteCheck {
  valid: boolean
  reason: 'invalid' | 'unknown' | 'used' | 'expired' | null
  expiresAt: number | null
  /** 发这个码的人的昵称，服务端知道的话 */
  invitedBy: string | null
}

/** 注册前先问一句这个码能不能用：抄错、用过、过期当场说清，不用填完名字再失败 */
export async function checkInvite(cfg: ServerConfig, code: string): Promise<InviteCheck> {
  const res = await window.desktop.http({ url: `${cfg.server}/v1/invites/check`, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
  check(res)
  const r = JSON.parse(res.text) as { valid?: boolean; reason?: InviteCheck['reason']; expires_at?: number; invited_by?: string }
  return { valid: !!r.valid, reason: r.reason ?? null, expiresAt: r.expires_at ?? null, invitedBy: r.invited_by ?? null }
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
    joinable: !!u.joinable,
  }))
}

interface RawPerson { user_id: string; nickname: string; is_agent?: boolean; tag?: string; color?: string; joinable?: boolean }
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

// ---- 当前服务端与凭据（给运行流这类直连服务端的模块） ----------------------------------

let current = { base: DEFAULT_SERVER.server, token: '' }
export const setServerAuth = (base: string, token: string): void => { current = { base, token } }
export const serverAuth = (): { base: string; token: string } => current

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
