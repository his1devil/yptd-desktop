import { describe, expect, it } from 'vitest'
import type { Message } from '../../../shared/model'
import { buildRows, textLines } from './rows'

const base = (id: string, at: number, over: Partial<Message> = {}): Message => ({
  id, conversation: 'sg_1', sender: 'a', senderName: 'A', senderAvatar: null, sentAt: at, seq: 0,
  body: { kind: 'text', text: id }, attachments: [], quote: null, reactions: [], sendState: 'sent', mentionsMe: false,
  isAgent: false, agentTag: null, transient: false, runID: null, dayIndex: 1, ...over,
})
const pic = (id: string, at: number, sender = 'a'): Message => base(id, at, { sender, body: { kind: 'picture', url: `u/${id}`, name: id, natural: null, bytes: 0 } })

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

describe('连续发言折叠', () => {
  const cont = (rows: ReturnType<typeof buildRows>) => rows.filter((r) => r.kind === 'msg' || r.kind === 'gallery').map((r) => (r.kind === 'msg' || r.kind === 'gallery') && r.continued)
  it('同一个人 5 分钟内接着说的是续行；换人、隔太久、带引用、运行卡、运行卡之后的都从头来', () => {
    const q = { messageId: 'x', senderID: 'b', senderName: 'B', excerpt: 'hi' }
    const rows = buildRows([
      base('a1', 1000), base('a2', 2000),
      base('b1', 3000, { sender: 'b' }), base('b2', 3000 + 5 * 60_000 + 1, { sender: 'b' }),
      base('b3', 3000 + 5 * 60_000 + 2, { sender: 'b', quote: q }),
      base('b4', 3000 + 5 * 60_000 + 3, { sender: 'b', runID: 'run_1' }),
      base('b5', 3000 + 5 * 60_000 + 4, { sender: 'b' }),
      base('b6', 3000 + 5 * 60_000 + 5, { sender: 'b' }),
    ])
    expect(cont(rows)).toEqual([false, true, false, false, false, false, false, true])
  })
  it('跨了日期分隔就从头来', () => {
    const rows = buildRows([base('a1', 1000, { dayIndex: 1 }), base('a2', 2000, { dayIndex: 2 })])
    expect(cont(rows)).toEqual([false, false])
  })
  it('图接在同一个人的话后面也是续行，并成画廊后还是', () => {
    const rows = buildRows([base('t', 1000), pic('p1', 2000), pic('p2', 3000)])
    expect(rows.map((r) => r.kind)).toEqual(['day', 'msg', 'gallery'])
    expect(cont(rows)).toEqual([false, true])
  })
})

describe('正文估高', () => {
  it('按真实换行数算，不是把整条当一行折', () => {
    // 三行短句：原来 length/67 算出来是 1 行，实际画三行
    expect(textLines('第一行\n第二行\n第三行')).toBe(3)
  })
  it('空行也占一行', () => {
    expect(textLines('a\n\nb')).toBe(3)
  })
  it('链接按画出来的字算，不按 URL 长度', () => {
    const line = '[路透](https://www.reuters.com/technology/tsmc-2nm-ahead-of-schedule) · 6 小时前'
    expect(textLines(line)).toBe(1)
    // 不去掉 URL 的话这一行就被算成两行
    expect(Math.ceil(line.length / 67)).toBe(2)
  })
  it('长段落还是要折', () => {
    expect(textLines('x'.repeat(140))).toBe(3)
  })
  it('JOMO 那条新闻推送', () => {
    const digest = [
      '**科技热点** · 2 条',
      '',
      '**OpenAI 开放 Sora 2 API**',
      '定价压到 Runway 一档以下，视频生成的价格战从这里开始。',
      '[OpenAI 博客](https://openai.com/index/sora-2-api) · 2 小时前',
      '',
      '**台积电 2nm 提前量产**',
      '比原定快一个季度，苹果 A21 和高通的排产窗口都要往前挪。',
      '[路透](https://www.reuters.com/technology/tsmc-2nm) · 6 小时前',
    ].join('\n')
    expect(textLines(digest)).toBe(9)
    // 老算法不数换行，9 行的播报被估成 4 行——一条消息矮了一百多像素
    expect(Math.ceil(digest.length / 67)).toBeLessThan(textLines(digest))
  })
})
