import { describe, expect, it } from 'vitest'
import type { Member, Person } from '../../../shared/model'
import { knownPeople, mentionLook, mentionables, resolveMention } from './mentions'
import type { Place } from './selectors'

const person = (id: string, name: string, isAgent = false): Person =>
  ({ userID: id, nickname: name, isAgent, tag: isAgent ? '热点' : null, color: null, joinable: true })
const member = (id: string, name: string, isAgent = false): Member =>
  ({ id, name, avatar: null, role: 'member', isAgent })

const ROSTER = [
  person('me', '我'),
  person('zhang', '张三'),
  person('li', '李四'),
  person('agentjomo', 'JOMO', true),
  person('agentcharlie', 'Charlie', true),
]

const channel = (members: Member[]): Place => ({
  id: 'sg_1', kind: 'channel', isAgent: false, title: '频道', avatar: null, glyph: '#', pair: 0,
  groupID: '1', peer: null, members, conversation: null,
})
const dm = (peer: Person): Place => ({
  id: `si_${peer.userID}_me`, kind: peer.isAgent ? 'agent_session' : 'dm', isAgent: peer.isAgent,
  title: peer.nickname, avatar: null, glyph: 'x', pair: 0, groupID: null, peer, members: [], conversation: null,
})

describe('能被 @ 的人', () => {
  it('频道里只有群成员，不在群里的 agent 给不出来', () => {
    const got = mentionables(channel([member('me', '我'), member('zhang', '张三'), member('agentjomo', 'JOMO', true)]), ROSTER, 'me')
    expect(got.map((p) => p.id)).toEqual(['agentjomo', 'zhang'])
  })

  it('成员还没拉下来就一个都不给，不能退回整本名册', () => {
    // 退回名册的话，不在群里的人会被列出来、被选中，发出去 @ 的是个收不到的人
    expect(mentionables(channel([]), ROSTER, 'me')).toEqual([])
  })

  it('私聊里只有对面那一个', () => {
    expect(mentionables(dm(person('zhang', '张三')), ROSTER, 'me').map((p) => p.id)).toEqual(['zhang'])
  })

  it('agent 排在人前面', () => {
    const got = mentionables(channel([member('zhang', '张三'), member('agentjomo', 'JOMO', true)]), ROSTER, 'me')
    expect(got[0]!.isAgent).toBe(true)
  })
})

describe('正文里的 @ 怎么画', () => {
  it('群里的 agent 是 agent，群里的人是人，不在群里的用户发灰', () => {
    const look = mentionLook(channel([member('me', '我'), member('zhang', '张三'), member('agentjomo', 'JOMO', true)]), ROSTER, '我')
    expect(look.agents.has('JOMO')).toBe(true)
    expect(look.members.has('张三')).toBe(true)
    // 李四和 Charlie 是这服务器的用户，但不在这个群里
    expect(look.outsiders.has('李四')).toBe(true)
    expect(look.outsiders.has('Charlie')).toBe(true)
    // 灰的不能同时又是亮的
    expect(look.members.has('李四')).toBe(false)
    expect(look.agents.has('Charlie')).toBe(false)
  })

  it('压根不是用户的名字三档都不沾，渲染成普通文字', () => {
    const look = mentionLook(channel([member('zhang', '张三')]), ROSTER, '我')
    for (const set of [look.agents, look.members, look.outsiders]) expect(set.has('王五')).toBe(false)
  })

  it('成员表还没到时先按名册画，不要闪一屏灰色', () => {
    const look = mentionLook(channel([]), ROSTER, '我')
    expect(look.members.has('张三')).toBe(true)
    expect(look.agents.has('JOMO')).toBe(true)
    expect(look.outsiders.size).toBe(0)
  })

  it('私聊里只有你俩是亮的，别人都灰', () => {
    const look = mentionLook(dm(person('zhang', '张三')), ROSTER, '我')
    expect(look.members.has('张三')).toBe(true)
    expect(look.members.has('我')).toBe(true)
    expect(look.outsiders.has('李四')).toBe(true)
    expect(look.outsiders.has('JOMO')).toBe(true)
  })

  it('自己的名字永远是亮的', () => {
    const look = mentionLook(channel([member('zhang', '张三')]), ROSTER, '我')
    expect(look.members.has('我')).toBe(true)
    expect(look.outsiders.has('我')).toBe(false)
  })

  it('没有会话时谁都不认识', () => {
    const look = mentionLook(null, ROSTER, '我')
    expect(look.agents.size + look.members.size + look.outsiders.size).toBe(0)
  })
})

describe('从 @ 后面认名字', () => {
  const look = mentionLook(
    channel([member('tui', 'tui测试'), member('agentcharlie', 'Charlie', true)]),
    [...ROSTER, person('tui', 'tui测试')],
    'tui测试',
  )

  it('中英混排的名字要整个认出来', () => {
    // 老正则遇到「@tui测试」只认得出「@tui」，自己的名字从来没高亮过
    expect(resolveMention('tui测试', look)).toBe('tui测试')
  })

  it('名字后面直接跟汉字也认得出，多出来的部分不算名字', () => {
    expect(resolveMention('JOMO也来', look)).toBe('JOMO')
    expect(resolveMention('Charlie看一下', look)).toBe('Charlie')
  })

  it('取认得出的最长前缀', () => {
    const two = mentionLook(channel([member('a', '张三'), member('b', '张三丰')]), ROSTER, '我')
    expect(resolveMention('张三丰说', two)).toBe('张三丰')
    expect(resolveMention('张三说', two)).toBe('张三')
  })

  it('谁都对不上就是普通文字', () => {
    expect(resolveMention('王五', look)).toBe('')
    expect(resolveMention('nobody', look)).toBe('')
  })
})

describe('你能看见的人', () => {
  const hidden: Member = { id: 'quiet', name: '安静', avatar: null, role: 'member', isAgent: false }

  it('名册之外，群里见过的人也算见过', () => {
    // 他关了被搜索，所以不在名册里；但你们同群，不该因此在选人和 ⌘K 里消失
    const got = knownPeople([person('zhang', '张三')], { g1: [hidden] })
    expect(got.map((p) => p.userID).sort()).toEqual(['quiet', 'zhang'])
  })

  it('名册那份说了算，不被成员表覆盖', () => {
    // 成员表只有名字，没有 tag/color/joinable，拿它盖掉名册会把 agent 的身份色弄丢
    const got = knownPeople([person('agentjomo', 'JOMO', true)], { g1: [{ ...hidden, id: 'agentjomo', name: '旧名字' }] })
    expect(got).toHaveLength(1)
    expect(got[0]!.nickname).toBe('JOMO')
    expect(got[0]!.isAgent).toBe(true)
  })

  it('只从成员表认识的人当作拉不动', () => {
    // 不知道他允不允许被拉；他已经在那个群里了，也不需要再拉一次
    expect(knownPeople([], { g1: [hidden] })[0]!.joinable).toBe(false)
  })

  it('同一个人在几个群里只出现一次', () => {
    expect(knownPeople([], { g1: [hidden], g2: [hidden] })).toHaveLength(1)
  })
})
