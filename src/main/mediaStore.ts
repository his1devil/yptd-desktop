import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 这台机器上存着的、服务器也有的那些东西。
 *
 * 以前桌面端没有自己的媒体缓存——图片、头像、视频封面全是渲染进程直接把 https 地址塞进
 * `<img src>`，唯一的缓存是 Chromium 那份：**全账号共用、没有上限、没有清理入口**，实测
 * 186 MB 里 902 条记录只指向 39 个对象（那时 `/object/` 每次重新签名，按 URL 做键的缓存
 * 永远不命中）。
 *
 * 现在主进程自己存。三件事只有在这一层才做得到：按账号隔离、有上限能清、以后加鉴权头。
 */

export type Pool = 'avatars' | 'images' | 'files'

/** 字节。视频最大也最容易重新拿到，所以它先让位 */
const LIMIT: Record<Pool, number> = {
  avatars: 50 * 1024 * 1024,
  images: 1024 * 1024 * 1024,
  files: 2 * 1024 * 1024 * 1024,
}

/** 目录名是哈希不是账号名：Finder 里、备份里都不该列出谁用过这台电脑 */
const scopeOf = (userID: string, server: string): string =>
  createHash('sha256').update(`${server}|${userID}`).digest('hex').slice(0, 16)

let scope: string | null = null

const root = (): string => join(app.getPath('userData'), 'media')

/** 当前账号的某个池子。没登录返回 null——调用方据此决定「这次不存」 */
function poolDir(pool: Pool): string | null {
  if (!scope) return null
  const dir = join(root(), scope, pool)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 缓存键 = 对象自己的路径 + 变体，**不含 query**。同一个对象带不同签名参数来是同一个
 * 对象；把签名算进键里正是桌面端命中率曾经为 0 的原因。
 */
function fileName(url: string, variant = ''): string {
  let key: string
  try {
    const u = new URL(url)
    key = u.host + u.pathname
  } catch {
    key = url
  }
  const hex = createHash('sha256').update(variant ? `${key}#${variant}` : key).digest('hex')
  const ext = /\.([a-z0-9]{1,5})$/i.exec(key)?.[1]?.toLowerCase()
  return ext ? `${hex}.${ext}` : hex
}

export function adopt(userID: string | null, server: string): void {
  scope = userID ? scopeOf(userID, server) : null
}

export function currentScope(): string | null { return scope }

// ---- 读写 -----------------------------------------------------------------

function entryPath(url: string, pool: Pool, variant: string): string | null {
  const dir = poolDir(pool)
  return dir ? join(dir, fileName(url, variant)) : null
}

/** 命中就返回字节，并把 mtime 往前推一下——淘汰按「最近用过」排 */
function read(url: string, pool: Pool, variant: string): { data: Buffer; type: string } | null {
  const file = entryPath(url, pool, variant)
  if (!file || !existsSync(file)) return null
  try {
    const data = readFileSync(file)
    const now = new Date()
    utimesSync(file, now, now)
    const type = existsSync(file + '.t') ? readFileSync(file + '.t', 'utf8') : 'application/octet-stream'
    return { data, type }
  } catch {
    return null
  }
}

function write(url: string, pool: Pool, variant: string, data: Buffer, type: string): void {
  const file = entryPath(url, pool, variant)
  if (!file) return
  try {
    writeFileSync(file, data)
    // mime 单独存一个小文件：对象名里没有可靠的扩展名（现在是随机 id），而
    // `<img>` / `<video>` 认 Content-Type。
    writeFileSync(file + '.t', type)
  } catch { /* 盘满了就当没缓存，不该因此让图挂掉 */ }
}

/**
 * 主进程这一层只有一个纯兜底的信号量，**不做优先级**。谁先谁后、哪些该取消，由渲染进程
 * 决定（它才知道什么在视口里）；这里只防一次几十个请求同时出去。
 */
const MAX_INFLIGHT = 6
let inflight = 0
const waiting: (() => void)[] = []

async function slot(): Promise<void> {
  if (inflight < MAX_INFLIGHT) { inflight++; return }
  await new Promise<void>((r) => waiting.push(r))
  inflight++
}
function release(): void {
  inflight--
  waiting.pop()?.()   // 后进先出：用户正在看的那张比两屏之前的更该先走
}

/** 同一个地址同时被要几次只下一次 */
const running = new Map<string, Promise<{ data: Buffer; type: string }>>()

async function fetchOnce(url: string, headers: Record<string, string>): Promise<{ data: Buffer; type: string }> {
  const existing = running.get(url)
  if (existing) return existing
  const work = (async () => {
    await slot()
    try {
      const res = await net.fetch(url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return {
        data: Buffer.from(await res.arrayBuffer()),
        type: res.headers.get('content-type') ?? 'application/octet-stream',
      }
    } finally {
      release()
    }
  })()
  running.set(url, work)
  try {
    return await work
  } finally {
    running.delete(url)
  }
}

/**
 * 取一个媒体对象：先看盘上有没有，没有再下，下完存起来。
 *
 * Range 请求（视频拖动）不走缓存直接转发：缓存整段再切片对一个几十 MB 的视频不划算，
 * 而 `<video>` 本来就是靠 Range 工作的。真正要缓存的视频走 prefetch。
 */
export async function serve(req: Request, url: string, pool: Pool, variant: string): Promise<Response> {
  const range = req.headers.get('range')
  if (range) {
    return net.fetch(url, { headers: { range } })
  }
  const hit = read(url, pool, variant)
  if (hit) {
    return new Response(new Uint8Array(hit.data), {
      status: 200,
      headers: { 'content-type': hit.type, 'cache-control': 'no-cache', 'x-yptd-cache': 'hit' },
    })
  }
  const scopeAtStart = scope
  const got = await fetchOnce(url, {})
  // 中途换了账号：这份字节属于上一个人，别落进新账号的目录
  if (scope === scopeAtStart) {
    write(url, pool, variant, got.data, got.type)
    queueMicrotask(() => prune(pool))
  }
  return new Response(new Uint8Array(got.data), {
    status: 200,
    headers: { 'content-type': got.type, 'cache-control': 'no-cache', 'x-yptd-cache': 'miss' },
  })
}

/** 把一个对象整个拿到本地（视频播放前用）。返回本地文件路径 */
export async function prefetch(url: string, pool: Pool): Promise<string | null> {
  const file = entryPath(url, pool, '')
  if (file && existsSync(file)) {
    const now = new Date()
    utimesSync(file, now, now)
    return file
  }
  const scopeAtStart = scope
  const got = await fetchOnce(url, {})
  if (!file || scope !== scopeAtStart) return null
  write(url, pool, '', got.data, got.type)
  queueMicrotask(() => prune(pool))
  return file
}

// ---- 容量 -----------------------------------------------------------------

function entries(dir: string): { path: string; size: number; at: number }[] {
  try {
    return readdirSync(dir)
      .filter((n) => !n.endsWith('.t'))
      .map((n) => {
        const path = join(dir, n)
        const s = statSync(path)
        return { path, size: s.size, at: s.mtimeMs }
      })
  } catch {
    return []
  }
}

export function usage(pool: Pool): number {
  const dir = poolDir(pool)
  return dir ? entries(dir).reduce((n, e) => n + e.size, 0) : 0
}

export function clear(pool: Pool): void {
  const dir = poolDir(pool)
  if (dir) rmSync(dir, { recursive: true, force: true })
}

/** 当前账号的全部媒体 */
export function purge(): void {
  if (scope) rmSync(join(root(), scope), { recursive: true, force: true })
}

/** 超了就按最久没用过的删到 80%，省得下一次写入又触发一轮 */
function prune(pool: Pool): void {
  const dir = poolDir(pool)
  if (!dir) return
  const list = entries(dir)
  let total = list.reduce((n, e) => n + e.size, 0)
  const limit = LIMIT[pool]
  if (total <= limit) return
  list.sort((a, b) => a.at - b.at)
  for (const e of list) {
    if (total <= limit * 0.8) break
    rmSync(e.path, { force: true })
    rmSync(e.path + '.t', { force: true })
    total -= e.size
  }
}

export const limits = LIMIT
