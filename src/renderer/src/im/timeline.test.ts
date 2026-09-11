import { describe, expect, it } from 'vitest'
import type { Message } from '../../../shared/model'
import { Timeline, visible } from './timeline'

const msg = (id: string, at: number, over: Partial<Message> = {}): Message => ({
  id, conversation: 'sg_1', sender: 'bob', senderName: 'Bob', senderAvatar: null,
  sentAt: at, seq: 0, body: { kind: 'text', text: id }, quote: null, reactions: [],
  sendState: 'sent', mentionsMe: false, isAgent: false, agentTag: null, transient: false, runID: null,
  mentions: [], agentMentions: [], dayIndex: 0, ...over,
})

describe('时间线', () => {
  it('按时间排序，乱序插入也能排好', () => {
    const t = new Timeline()
    t.upsert(msg('b', 20)); t.upsert(msg('a', 10)); t.upsert(msg('c', 30))
    expect(t.messages.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('同一条消息进来两次只留一条', () => {
    const t = new Timeline()
    t.upsert(msg('a', 10)); expect(t.upsert(msg('a', 10))).toBe(false)
    expect(t.length).toBe(1)
  })

  it('往上翻页是一次拼接，且跳过已有的', () => {
    const t = new Timeline()
    t.upsert(msg('c', 30))
    t.prepend([msg('b', 20), msg('a', 10), msg('c', 30)])
    expect(t.messages.map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('按 id 找、改、删之后下标表仍然正确', () => {
    const t = new Timeline()
    for (const [id, at] of [['a', 1], ['b', 2], ['c', 3], ['d', 4]] as const) t.upsert(msg(id, at))
    expect(t.edit('b', (m) => ({ ...m, reactions: [{ emoji: '👍', count: 1, mine: false }] }))).toBe(true)
    expect(t.get('b')!.reactions).toHaveLength(1)
    expect(t.remove('b')).toBe(true)
    expect(t.get('c')).toBe(t.messages[1])
    expect(t.get('d')).toBe(t.messages[2])
  })

  it('一万条按序追加是线性的', () => {
    const t = new Timeline()
    const start = performance.now()
    for (let i = 0; i < 10_000; i++) t.upsert(msg(`m${i}`, 1_800_000_000_000 + i * 1000))
    const ms = performance.now() - start
    expect(t.length).toBe(10_000)
    expect(ms).toBeLessThan(500)
  })
})

describe('占位消息', () => {
  it('答案到了，占位就不再出现', () => {
    const out = visible([
      msg('q', 1, { sender: 'lina' }),
      msg('p', 2, { sender: 'halx', transient: true }),
      msg('a', 3, { sender: 'halx' }),
    ])
    expect(out.map((m) => m.id)).toEqual(['q', 'a'])
  })
  it('还没回答的占位要留着；别人插话不算把它顶掉', () => {
    const out = visible([
      msg('p', 1, { sender: 'halx', transient: true }),
      msg('x', 2, { sender: 'lina' }),
    ])
    expect(out.map((m) => m.id)).toEqual(['p', 'x'])
  })
  it('没有占位的时候原数组直接返回', () => {
    const list = [msg('a', 1), msg('b', 2)]
    expect(visible(list)).toBe(list)
  })
})
