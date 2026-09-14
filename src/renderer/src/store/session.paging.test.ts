import { beforeEach, describe, expect, it, vi } from 'vitest'

// SDK 全部替换：不登录、不发消息、不上传。session store 是真的。
const sdk = vi.hoisted(() => ({ history: vi.fn(), members: vi.fn(), users: vi.fn() }))
vi.mock('../im/client', () => ({ im: sdk, SdkEvent: {} }))

import type { Message } from '../../../shared/model'
import { timeline, useSession } from './session'

const shown: Message = {
  id: 'visible', conversation: 'c', sender: 'bob', senderName: 'Bob', senderAvatar: null,
  sentAt: 1000, seq: 2, body: { kind: 'text', text: '已有的历史' }, attachments: [], quote: null,
  reactions: [], sendState: 'sent', mentionsMe: false, isAgent: false, agentTag: null,
  transient: false, runID: null, dayIndex: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.users.mockResolvedValue([])
  useSession.setState({ members: {}, roster: [], me: 'me', notice: null })
})

describe('往上翻历史', () => {
  it('连着几页全是被过滤的消息，不能把还没问过的下一页封死', async () => {
    // 一整页可能全是系统通知或表情回应，过滤完一条不剩。轮数用完时游标已经往前走了
    // 好几页，把那个游标标成「问过了没东西」，等于让这段历史再也翻不动。
    const t = timeline('filtered')
    t.upsert(shown)
    t.status = 'ready'
    t.olderCursor = 'p0'
    sdk.history.mockImplementation(async (_id: string, cursor: string) => ({
      isEnd: false,
      messageList: [{ clientMsgID: `${cursor}+1`, contentType: 1000, sendTime: 1, seq: 1 }],
    }))
    await useSession.getState().loadOlder('filtered')

    expect(t.hasMore).toBe(true)
    expect(t.olderCursor).not.toBe('p0')   // 游标确实前进了
    expect(t.stalledAt).toBeNull()          // 所以不该被标住

    const before = sdk.history.mock.calls.length
    await useSession.getState().loadOlder('filtered')
    expect(sdk.history.mock.calls.length).toBeGreaterThan(before) // 还能接着翻
  })

  it('同一个游标要来是空的，短时间内不重复问，但过了冷却能重试', async () => {
    const t = timeline('empty')
    t.status = 'ready'
    t.olderCursor = 'edge'
    sdk.history.mockResolvedValue({ isEnd: false, messageList: [] })

    await useSession.getState().loadOlder('empty')
    expect(sdk.history).toHaveBeenCalledTimes(1)
    await useSession.getState().loadOlder('empty')
    expect(sdk.history).toHaveBeenCalledTimes(1) // 立刻再来不问第二遍

    t.stalledSince -= 10_000 // 当作过了冷却
    await useSession.getState().loadOlder('empty')
    expect(sdk.history).toHaveBeenCalledTimes(2) // 不是永久封死
  })
})

describe('拉群成员', () => {
  it('第一页拿到就交出去，不等后面的页', async () => {
    // @ 候选严格依赖群成员，攒齐几页再一次性 set 会直接卡住输入
    let release!: (v: unknown[]) => void
    sdk.members.mockImplementation(async (_g: string, offset: number) => offset === 0
      ? Array.from({ length: 200 }, (_, i) => ({ userID: `u${i}`, nickname: `成员${i}`, roleLevel: 20 }))
      : new Promise((r) => { release = r }))

    const work = useSession.getState().loadMembers('big')
    await vi.waitFor(() => expect(sdk.members).toHaveBeenCalledTimes(2))
    expect(useSession.getState().members['big']).toHaveLength(200) // 第二页还悬着，第一页已经能用

    release([])
    await work
  })

  it('到了上限要说一声，不能默默截断', async () => {
    // 默默截断的话名单看着是完整的，少掉的人既不显示也 @ 不到
    sdk.members.mockImplementation(async (_g: string, offset: number, count: number) =>
      Array.from({ length: Math.min(count, 2050 - offset) }, (_, i) => ({ userID: `u${offset + i}`, nickname: '成员', roleLevel: 20 })))
    await useSession.getState().loadMembers('huge')
    expect(useSession.getState().notice).toMatch(/2000|超过/)
  })

  it('后面的页失败，前面成功的页留着', async () => {
    sdk.members.mockImplementation(async (_g: string, offset: number) => {
      if (offset === 0) return Array.from({ length: 200 }, (_, i) => ({ userID: `u${i}`, nickname: '成员', roleLevel: 20 }))
      throw new Error('断网了')
    })
    await useSession.getState().loadMembers('flaky')
    expect(useSession.getState().members['flaky']).toHaveLength(200)
    expect(useSession.getState().notice).toMatch(/没拉全/)
  })
})
