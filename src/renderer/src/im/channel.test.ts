import { describe, expect, it } from 'vitest'
import { CLOSED, encodePolicy, parsePolicy, VERIFY_ALL, VERIFY_DIRECT, verificationFor } from './channel'

describe('频道开关', () => {
  it('没设过的一律算两个都关', () => {
    // 这个功能之前建的群 ex 都是空的，不能因为上线就变成人人可搜可进
    for (const ex of [undefined, '', 'not json', '{"yptd":"rich","a":[]}', '{"find":1,"join":1}']) {
      expect(parsePolicy(ex)).toEqual(CLOSED)
    }
  })

  it('存完再读还是原样', () => {
    for (const p of [CLOSED, { findable: true, joinable: false }, { findable: false, joinable: true }, { findable: true, joinable: true }]) {
      expect(parsePolicy(encodePolicy(p))).toEqual(p)
    }
  })

  it('和服务端是同一套字节', () => {
    // server/internal/channel 的 TestEncodeKeepsTheTag 断言的是同一个字符串
    expect(encodePolicy({ findable: true, joinable: false })).toBe('{"yptd":"channel","find":1,"join":0}')
  })

  it('needVerification 跟着可加入走', () => {
    expect(verificationFor({ findable: true, joinable: true })).toBe(VERIFY_DIRECT)
    expect(verificationFor({ findable: true, joinable: false })).toBe(VERIFY_ALL)
  })
})
