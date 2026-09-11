import type { Message } from '../../../shared/model'
import { dayLabel } from '../im/translate'

/**
 * 消息 → 消息流里的行。
 *
 * 日期变了插一条分隔；agent 的占位是 pending 行；同一个人连着发的几张图并成一行
 * 画廊（并列显示），中间隔了别的消息、或隔得太久（90 秒）就断开。
 */
export type Row =
  | { key: string; kind: 'day'; label: string }
  | { key: string; kind: 'msg'; message: Message }
  | { key: string; kind: 'pending'; message: Message }
  | { key: string; kind: 'gallery'; messages: Message[] }

/** 两张图隔多久还算同一组 */
export const GALLERY_GAP_MS = 90_000

export function buildRows(messages: readonly Message[]): Row[] {
  const rows: Row[] = []
  let day = -1
  for (const m of messages) {
    if (m.dayIndex !== day) {
      day = m.dayIndex
      rows.push({ key: `d${day}`, kind: 'day', label: dayLabel(day) })
    }
    if (m.transient) { rows.push({ key: m.id, kind: 'pending', message: m }); continue }
    if (m.body.kind === 'picture' && !m.quote) {
      const last = rows[rows.length - 1]
      if (last?.kind === 'gallery' && joins(last.messages[last.messages.length - 1]!, m)) { last.messages.push(m); continue }
      if (last?.kind === 'msg' && last.message.body.kind === 'picture' && !last.message.quote && joins(last.message, m)) {
        rows[rows.length - 1] = { key: last.key, kind: 'gallery', messages: [last.message, m] }
        continue
      }
    }
    rows.push({ key: m.id, kind: 'msg', message: m })
  }
  return rows
}

const joins = (a: Message, b: Message): boolean => a.sender === b.sender && b.sentAt - a.sentAt < GALLERY_GAP_MS

/** 一行里包含这条消息吗（跳转要用） */
export function rowHas(row: Row, messageId: string): boolean {
  if (row.kind === 'day') return false
  if (row.kind === 'gallery') return row.messages.some((m) => m.id === messageId)
  return row.message.id === messageId
}
