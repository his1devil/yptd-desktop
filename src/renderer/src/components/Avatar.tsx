import { useState, type CSSProperties } from 'react'
import { avatarSized } from '../im/files'
import { agentColor } from './identity'
import { Mark } from './Mark'
import styles from './Avatar.module.css'

/** 屏幕像素密度。26px 的槽在 2 倍屏要 52 物理像素，按它挑档位 */
const DPR = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)

/**
 * 头像 = 一个字 + 一对色块（--a1bg/--a1fg … --a5bg/--a5fg），有真头像图就贴图。
 * 人是圆的，agent 是方角的（size 的 23%）——这个形状差异是主要的人机区分手段。
 *
 * agent 不画字，画 yptd 的标记，颜色用它自己的身份色（名册里的 color，服务端按位次分配）；
 * 没给色就退回统一的 --agent。四个 agent 长得一样、只靠颜色分，这是刻意的。
 */
export interface AvatarProps {
  glyph: string
  /** 0–4，索引五组头像色对；agent 不用 */
  pair: number
  size: number
  kind?: 'human' | 'agent'
  /** 这个人的账号。agent 用它查身份色；不给或查不到就用统一的 --agent */
  id?: string | null
  src?: string | null
  presence?: 'online' | 'busy' | 'offline'
  /** 在线点描边用的底色（跟随所在容器的背景） */
  ring?: string
  style?: CSSProperties
}

export function Avatar({ glyph, pair, size, kind = 'human', id, src, presence, ring = 'var(--rail)', style }: AvatarProps) {
  const n = (Math.abs(pair) % 5) + 1
  const agent = kind === 'agent'
  const color = agent ? agentColor(id) : null
  const radius = agent ? Math.max(4, Math.round(size * 0.23)) : 99
  const font = Math.round(size * 0.42)
  const dot = Math.round(size / 3)
  // 按槽位挑一档，不下原图：右栏 26px 的槽原来在下最高 1200px、1MB 多的原文件，
  // 实测三个头像 2.95MB，换成 64 档合计 22KB
  const [ready, setReady] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const want = src ? avatarSized(src, Math.round(size * DPR)) : null
  const face = want && want !== failed ? want : null
  return (
    <span
      className={agent ? styles.agent : undefined}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flex: 'none',
        borderRadius: radius,
        // agent 的底色和前景由 Avatar.module.css 按主题从 --c 派生
        ...(agent ? { ['--c' as string]: color || 'var(--agent)' } : { background: `var(--a${n}bg)`, color: `var(--a${n}fg)` }),
        fontSize: font,
        fontWeight: 600,
        lineHeight: 1,
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* 字形和 agent 标记始终铺在底下：下载期间看到的是字，不是一块空色；失败也还留着它 */}
      {agent ? <Mark size={Math.round(size * 0.82)} /> : glyph}
      {face && (
        <img
          src={face} alt="" draggable={false} loading="lazy"
          onLoad={() => setReady(face)}
          onError={() => setFailed(face)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
            opacity: ready === face ? 1 : 0, transition: 'opacity .14s ease-out',
          }}
        />
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
