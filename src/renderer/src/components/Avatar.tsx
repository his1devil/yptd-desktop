import type { CSSProperties } from 'react'

/**
 * 头像 = 一个字 + 一对色块（--a1bg/--a1fg … --a5bg/--a5fg），有真头像图就贴图。
 * 人是圆的，agent 是方角的（size 的 23%）——这个形状差异是主要的人机区分手段；
 * agent 一律用 --atint/--agent 这对色，和正文里的 @agent、AGENT 标签同色。
 */
export interface AvatarProps {
  glyph: string
  /** 0–4，索引五组头像色对；agent 不用 */
  pair: number
  size: number
  kind?: 'human' | 'agent'
  src?: string | null
  presence?: 'online' | 'busy' | 'offline'
  /** 在线点描边用的底色（跟随所在容器的背景） */
  ring?: string
  style?: CSSProperties
}

export function Avatar({ glyph, pair, size, kind = 'human', src, presence, ring = 'var(--rail)', style }: AvatarProps) {
  const n = (Math.abs(pair) % 5) + 1
  const agent = kind === 'agent'
  const radius = agent ? Math.max(4, Math.round(size * 0.23)) : 99
  const font = Math.round(size * (agent ? 0.4 : 0.42))
  const dot = Math.round(size / 3)
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: radius,
        background: agent ? 'var(--atint)' : `var(--a${n}bg)`,
        color: agent ? 'var(--agent)' : `var(--a${n}fg)`,
        fontSize: font,
        fontWeight: agent ? 700 : 600,
        lineHeight: 1,
        overflow: 'hidden',
        ...style,
      }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        glyph
      )}
      {presence && (
        <span
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: 99,
            background: presence === 'online' ? 'var(--ok)' : presence === 'busy' ? 'var(--warn)' : 'var(--ink3)',
            border: `2px solid ${ring}`,
          }}
        />
      )}
    </span>
  )
}

/** 名字的第一个字：中文取首字，英文取首字母大写。 */
export function glyphOf(name: string): string {
  const t = name.trim()
  if (!t) return '?'
  const first = [...t][0]!
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}

/** 由 id 稳定地选一组头像色，各端、各次打开都一样。 */
export function pairOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 5
}
