import { describe, expect, it } from 'vitest'
import { canRemove, type Member } from './model'

const m = (id: string, role: Member['role'], isAgent = false, inviter: string | null = null): Member =>
  ({ id, name: id, avatar: null, role, isAgent, inviter })

describe('谁能把谁移出频道', () => {
  const owner = m('asen', 'owner'), lina = m('lina', 'member'), bob = m('bob', 'member')
  const bot = m('agentbot', 'member', true, 'lina')
  it('群主谁都能移，除了自己', () => {
    expect(canRemove(bot, owner)).toBe(true)
    expect(canRemove(lina, owner)).toBe(true)
    expect(canRemove(owner, owner)).toBe(false)
  })
  it('把 agent 拉进来的人能移它，路人不能', () => {
    expect(canRemove(bot, lina)).toBe(true)
    expect(canRemove(bot, bob)).toBe(false)
  })
  it('拉人进来不等于能把人踢走', () => {
    expect(canRemove(m('eve', 'member', false, 'lina'), lina)).toBe(false)
  })
  it('谁也移不走群主；不在频道里的人什么也动不了；空的邀请人不匹配任何人', () => {
    expect(canRemove(owner, lina)).toBe(false)
    expect(canRemove(bot, undefined)).toBe(false)
    expect(canRemove(m('agentx', 'member', true, null), m('', 'member'))).toBe(false)
  })
})
