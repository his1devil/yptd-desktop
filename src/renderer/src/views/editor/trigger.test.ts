import { describe, expect, it } from 'vitest'
import { trigger } from './MentionsPlugin'

/**
 * @ 的触发规则。官方的 useBasicTypeaheadTriggerMatch 按英文单词边界切，中文名字匹配不上，
 * 所以这套规则是自己写的，用例把边界情况钉住。
 */
describe('@ 触发', () => {
  const q = (text: string) => trigger(text)?.matchingString ?? null

  it('行首或空白、标点后面的 @ 才触发', () => {
    expect(q('@')).toBe('')
    expect(q('你好 @')).toBe('')
    expect(q('你好，@')).toBe('')
    expect(q('（@')).toBe('')
    // 邮箱这种黏在词里的 @ 不触发
    expect(q('someone@')).toBeNull()
    expect(q('a@b')).toBeNull()
  })

  it('查询串可以是中文，也可以是字母', () => {
    expect(q('@李')).toBe('李')
    expect(q('找 @HAL')).toBe('HAL')
    expect(q('@李娜')).toBe('李娜')
  })

  it('遇到空白就不再是一个待选的 @', () => {
    expect(q('@李 娜')).toBeNull()
    expect(q('@ ')).toBeNull()
  })

  it('取最后一个 @，前面已经插过的不影响', () => {
    expect(q('麻烦 @HALX 和 @李')).toBe('李')
  })

  it('查询串太长就放弃，避免把整段话当成查询', () => {
    expect(q('@' + 'x'.repeat(21))).toBeNull()
    expect(q('@' + 'x'.repeat(20))).toBe('x'.repeat(20))
  })

  it('没有 @ 就没有', () => {
    expect(q('就是一句话')).toBeNull()
    expect(q('')).toBeNull()
  })

  it('替换范围包含 @ 本身，选中候选时整段被换掉', () => {
    expect(trigger('找 @HAL')).toMatchObject({ leadOffset: 2, replaceableString: '@HAL' })
  })
})
