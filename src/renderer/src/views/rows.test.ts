import { describe, expect, it } from 'vitest'
import type { Message } from '../../../shared/model'
import { buildRows } from './rows'

const base = (id: string, at: number, over: Partial<Message> = {}): Message => ({
  id, conversation: 'sg_1', sender: 'a', senderName: 'A', senderAvatar: null, sentAt: at, seq: 0,
  body: { kind: 'text', text: id }, attachments: [], quote: null, reactions: [], sendState: 'sent', mentionsMe: false,
  isAgent: false, agentTag: null, transient: false, runID: null, mentions: [], agentMentions: [], dayIndex: 1, ...over,
})
const pic = (id: string, at: number, sender = 'a'): Message => base(id, at, { sender, body: { kind: 'picture', url: `u/${id}`, name: id, natural: null } })

describe('画廊分组', () => {
  it('同一个人连着发的图并成一行，别人的不并', () => {
    const rows = buildRows([pic('p1', 1000), pic('p2', 2000), pic('p3', 3000), pic('q1', 4000, 'b'), pic('p4', 5000)])
    expect(rows.map((r) => r.kind)).toEqual(['day', 'gallery', 'msg', 'msg'])
    const g = rows[1]!
    expect(g.kind === 'gallery' && g.messages.map((m) => m.id)).toEqual(['p1', 'p2', 'p3'])
  })
  it('中间隔了文字或隔太久就断开', () => {
    const rows = buildRows([pic('p1', 1000), base('t', 1500), pic('p2', 2000), pic('p3', 2000 + 91_000)])
    expect(rows.map((r) => r.kind)).toEqual(['day', 'msg', 'msg', 'msg', 'msg'])
  })
  it('带引用的图单独成行', () => {
    const rows = buildRows([pic('p1', 1000), { ...pic('p2', 1200), quote: { messageId: 'x', senderID: 'b', senderName: 'B', excerpt: 'hi' } }])
    expect(rows.map((r) => r.kind)).toEqual(['day', 'msg', 'msg'])
  })
})
