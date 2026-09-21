import { describe, expect, it } from 'vitest'
import { CLOSED, parsePolicy } from './channel'

describe('频道开关', () => {
  it('没设过的一律算两个都关', () => {
    // 这个功能之前建的群 ex 都是空的，不能因为上线就变成人人可搜可进
    for (const ex of [undefined, '', 'not json', '{"yptd":"rich","a":[]}', '{"find":1,"join":1}']) {
      expect(parsePolicy(ex)).toEqual(CLOSED)
    }
  })

  it('和服务端是同一套字节', () => {
    // 服务端 server/internal/channel 的 Encode 产出的就是这些字符串，它的测试
    // 断言的是同一个字面量。写入侧现在只有服务端一份，这里只要读得懂。
    expect(parsePolicy('{"yptd":"channel","find":1,"join":0}')).toEqual({ findable: true, joinable: false })
    expect(parsePolicy('{"yptd":"channel","find":0,"join":1}')).toEqual({ findable: false, joinable: true })
    expect(parsePolicy('{"yptd":"channel","find":1,"join":1}')).toEqual({ findable: true, joinable: true })
    expect(parsePolicy('{"yptd":"channel","find":0,"join":0}')).toEqual(CLOSED)
  })
})
