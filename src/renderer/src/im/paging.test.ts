import { describe, expect, it } from 'vitest'
import { step } from './paging'

describe('往上翻历史的边界与游标', () => {
  it('SDK 说到头了就到头了', () => {
    expect(step({ count: 12, shown: 12, isEnd: true, edge: 'm1' }, 'm9')).toMatchObject({ hasMore: false, again: false })
  })

  it('整页被过滤成空也不算到头——这是原来那个会把历史截断的 bug', () => {
    // 一页 40 条全是回应和通知，翻译层一条都不留
    const s = step({ count: 40, shown: 0, isEnd: false, edge: 'm1' }, 'm41')
    expect(s.hasMore).toBe(true)
    expect(s.again).toBe(true)
    expect(s.cursor).toBe('m1')
  })

  it('游标取原始页的边界，不是过滤后最老的那条', () => {
    expect(step({ count: 40, shown: 3, isEnd: false, edge: 'raw-oldest' }, 'm41').cursor).toBe('raw-oldest')
  })

  it('游标没往前动就不再翻，免得原地打转', () => {
    expect(step({ count: 40, shown: 0, isEnd: false, edge: 'same' }, 'same').again).toBe(false)
  })

  it('原始页本身就是空的，没什么可再翻的', () => {
    expect(step({ count: 0, shown: 0, isEnd: false, edge: null }, 'm41')).toMatchObject({ again: false, cursor: 'm41' })
  })

  it('这一页有能显示的内容就停下来交给界面', () => {
    expect(step({ count: 40, shown: 40, isEnd: false, edge: 'm1' }, 'm41').again).toBe(false)
  })

  it('第一页（没有游标）也照样给出下一次的游标', () => {
    expect(step({ count: 40, shown: 40, isEnd: false, edge: 'm1' }, '')).toMatchObject({ cursor: 'm1', hasMore: true })
  })
})
