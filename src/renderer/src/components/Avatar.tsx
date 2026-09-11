import type { CSSProperties } from 'react'

/**
 * 头像 = 一个字 + 一对色块（--a1bg/--a1fg … --a5bg/--a5fg）。
 * 人是圆的，agent 是方角的（6–7px）——这个形状差异是主要的人机区分手段。
 */
export interface AvatarProps {
  glyph: string
  /** 0–4，索引五组头像色对 */
  pair: number
  size: number
  kind?: 'human' | 'agent'
  presence?: 'online' | 'busy' | 'offline'
  /** 在线点描边用的底色（跟随所在容器的背景） */
  ring?: string
  style?: CSSProperties
}

export function Avatar({ glyph, pair, size, kind = 'human', presence, ring = 'var(--rail)', style }: AvatarProps) {
  const n = (Math.abs(pair) % 5) + 1
  const radius = kind === 'agent' ? Math.max(4, Math.round(size * 0.23)) : 99
  const font = Math.round(size * 0.42)
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
        background: `var(--a${n}bg)`,
        color: `var(--a${n}fg)`,
        fontSize: font,
        fontWeight: 600,
        lineHeight: 1,
        ...style,
      }}
    >
      {glyph}
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
