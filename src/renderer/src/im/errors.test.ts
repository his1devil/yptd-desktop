import { describe, expect, it } from 'vitest'
import { tidyError } from './errors'

describe('收拾 OpenIM 的错误文案', () => {
  it('层层包装之后的真实样子', () => {
    // 这是拉一个没开放被加入群聊的人时，界面上真的会拿到的字符串
    const raw = '10001 10001 huanyangzhang 没有开放被加入群聊 10001 huanyangzhang 没有开放被加入群聊'
    expect(tidyError(raw, 10001)).toBe('huanyangzhang 没有开放被加入群聊')
  })

  it('没重复的就原样留着', () => {
    expect(tidyError('群不存在', 1004)).toBe('群不存在')
  })

  it('不知道错误码时也不该更糟', () => {
    expect(tidyError('  网络超时  ')).toBe('网络超时')
  })

  it('正文里本来就有数字的不误伤', () => {
    expect(tidyError('第 3 个附件太大', 10001)).toBe('第 3 个附件太大')
  })

  it('半句重复不算重复，别自作主张剪掉', () => {
    expect(tidyError('删除失败 删除', 0)).toBe('删除失败 删除')
  })
})
