import { describe, expect, it } from 'vitest'
import type { Conversation, Person } from '../../../shared/model'
import { nextConversation, orderedConversationIds } from './order'

const conv = (id: string, kind: Conversation['kind'], unread = 0): Conversation => ({
  id, kind, renderMode: kind === 'agent_session' ? 'harness' : 'im', title: id, avatar: null, unread, mentioned: false,
  pinned: false, preview: '', lastAt: 0, groupID: kind === 'channel' ? id.slice(3) : null, peerID: null,
})
const person = (userID: string, isAgent: boolean): Person => ({ userID, nickname: userID, isAgent, tag: null, color: null, joinable: true })

describe('键盘切会话的顺序', () => {
  const s = { conversations: [conv('si_bob_me', 'dm', 2), conv('sg_1', 'channel'), conv('sg_2', 'channel', 1), conv('si_agentbot_me', 'agent_session')], roster: [person('bob', false), person('agentbot', true)], me: 'me' }
  it('频道、私聊、agent；agent 按名册不按会话表', () => {
    expect(orderedConversationIds(s)).toEqual(['sg_1', 'sg_2', 'si_bob_me', 'si_agentbot_me'])
  })
  it('⌥↓ 往下循环，⌥↑ 往上循环', () => {
    const ids = orderedConversationIds(s)
    expect(nextConversation(ids, 'sg_2', 1, new Set(), false)).toBe('si_bob_me')
    expect(nextConversation(ids, 'si_agentbot_me', 1, new Set(), false)).toBe('sg_1')
    expect(nextConversation(ids, 'sg_1', -1, new Set(), false)).toBe('si_agentbot_me')
    expect(nextConversation(ids, null, 1, new Set(), false)).toBe('sg_1')
  })
  it('带 ⇧ 只在有未读的里找，都没有就不动', () => {
    const ids = orderedConversationIds(s)
    const unread = new Set(['sg_2', 'si_bob_me'])
    expect(nextConversation(ids, 'sg_1', 1, unread, true)).toBe('sg_2')
    expect(nextConversation(ids, 'si_bob_me', 1, unread, true)).toBe('sg_2')
    expect(nextConversation(ids, 'sg_1', 1, new Set(), true)).toBeNull()
  })
})
