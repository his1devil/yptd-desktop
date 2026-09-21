import { describe, expect, it } from 'vitest'
import { isMention } from './mention'

describe('isMention', () => {
  it('认得三种真的被 @', () => {
    expect(isMention(1)).toBe(true) // MentionedMe
    expect(isMention(2)).toBe(true) // MentionedAll
    expect(isMention(3)).toBe(true) // MentionedAllAndMe
  })

  it('没人 @ 就是没人 @', () => {
    expect(isMention(0)).toBe(false)
    expect(isMention(undefined)).toBe(false)
  })

  // 这是修掉的那条：改一次群公告，频道就顶着红色「@1」进待处理，而没人找你。
  it('群公告不是 @ 我', () => {
    expect(isMention(4)).toBe(false)
  })

  it('不认识的值当作没有', () => {
    expect(isMention(5)).toBe(false)
    expect(isMention(-1)).toBe(false)
  })
})
