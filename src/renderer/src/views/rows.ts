import type { Message } from '../../../shared/model'
import { dayLabel } from '../im/translate'

/**
 * 消息 → 消息流里的行。
 *
 * 日期变了插一条分隔；agent 的占位是 pending 行；同一个人连着发的几张图并成一行
 * 画廊（并列显示），中间隔了别的消息、或隔得太久（90 秒）就断开。
 *
 * 同一个人 5 分钟内接着说的话是「续行」：不再重复头像和名字，行距收紧，悬停才看时间。
 * 带引用的、agent 的运行卡、跨了日期分隔的都从头来，它们需要头部说清语境。
 */
export type Row =
  | { key: string; kind: 'day'; label: string }
  | { key: string; kind: 'msg'; message: Message; continued: boolean }
  | { key: string; kind: 'pending'; message: Message }
  | { key: string; kind: 'gallery'; messages: Message[]; continued: boolean }

/** 两张图隔多久还算同一组 */
export const GALLERY_GAP_MS = 90_000
/** 同一个人隔多久还算接着说 */
export const GROUP_GAP_MS = 5 * 60_000

export function buildRows(messages: readonly Message[]): Row[] {
  const rows: Row[] = []
  let day = -1
  for (const m of messages) {
    if (m.dayIndex !== day) {
      day = m.dayIndex
      rows.push({ key: `d${day}`, kind: 'day', label: dayLabel(day) })
    }
    if (m.transient) { rows.push({ key: m.id, kind: 'pending', message: m }); continue }
    const last = rows[rows.length - 1]
    if (m.body.kind === 'picture' && !m.quote) {
      if (last?.kind === 'gallery' && joins(last.messages[last.messages.length - 1]!, m)) { last.messages.push(m); continue }
      if (last?.kind === 'msg' && last.message.body.kind === 'picture' && !last.message.quote && joins(last.message, m)) {
        rows[rows.length - 1] = { key: last.key, kind: 'gallery', messages: [last.message, m], continued: last.continued }
        continue
      }
    }
    rows.push({ key: m.id, kind: 'msg', message: m, continued: follows(last, m) })
  }
  return rows
}

const joins = (a: Message, b: Message): boolean => a.sender === b.sender && b.sentAt - a.sentAt < GALLERY_GAP_MS

/** m 是不是紧接着上一行、同一个人在说 */
function follows(prev: Row | undefined, m: Message): boolean {
  if (!prev || prev.kind === 'day' || prev.kind === 'pending') return false
  const last = prev.kind === 'gallery' ? prev.messages[prev.messages.length - 1]! : prev.message
  if (last.runID || m.runID || m.quote) return false
  return last.sender === m.sender && m.sentAt >= last.sentAt && m.sentAt - last.sentAt < GROUP_GAP_MS
}

/** 一行里包含这条消息吗（跳转要用） */
export function rowHas(row: Row, messageId: string): boolean {
  if (row.kind === 'day') return false
  if (row.kind === 'gallery') return row.messages.some((m) => m.id === messageId)
  return row.message.id === messageId
}

/**
 * 正文占几行。先按真实换行切，每行再按可见宽度折——原来是把整条当一行连续折行，
 * 换行一个都不算，agent 的多行播报会被估矮一大截。
 *
 * 折行按「画得出来的字符」数，不是原文长度：`[标题](很长的链接)` 只画得出「标题」，
 * 把 URL 算进去能把一条两行的消息估成五行，进来那一下滚动位置就会跳。
 * 这只是个估值，真高度由 measureElement 量，估准一点只是为了少跳。
 */
export function textLines(text: string): number {
  return text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(visibleWidth(line) / 67)), 0)
}

const visibleWidth = (line: string): number =>
  line
    .replace(/\[([^\]\n]+?)\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/\*\*|~~|`/g, '')
    .length
