import { beforeEach, expect, it, vi } from 'vitest'

// Review-only probes: all SDK calls are replaced; no real login, message, or upload.
const sdk = vi.hoisted(() => ({ history: vi.fn(), members: vi.fn(), users: vi.fn() }))
vi.mock('../../../src/renderer/src/im/client', () => ({ im: sdk, SdkEvent: {} }))

import { timeline, useSession } from '../../../src/renderer/src/store/session'
import type { Message } from '../../../src/shared/model'

const visibleMessage: Message = {
  id: 'visible', conversation: 'review-filtered', sender: 'bob', senderName: 'Bob', senderAvatar: null,
  sentAt: 1000, seq: 2, body: { kind: 'text', text: 'Existing history' }, attachments: [], quote: null,
  reactions: [], sendState: 'sent', mentionsMe: false, isAgent: false, agentTag: null,
  transient: false, runID: null, dayIndex: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.users.mockResolvedValue([])
  useSession.setState({ members: {}, roster: [], me: 'review-user', notice: null })
})

it('reproduces: five filtered pages poison a cursor which DID advance', async () => {
  const t = timeline('review-filtered')
  t.upsert(visibleMessage)
  t.status = 'ready'
  t.olderCursor = 'before'
  sdk.history.mockImplementation(async (_id, cursor) => ({
    isEnd: false,
    messageList: [{ clientMsgID: `${cursor}-older`, contentType: 1000, sendTime: 1, seq: 1 }],
  }))
  await useSession.getState().loadOlder('review-filtered')
  expect(sdk.history).toHaveBeenCalledTimes(5)
  expect(t.hasMore).toBe(true)
  expect(t.length).toBe(1)
  expect(t.olderCursor).not.toBe('before')
  expect(t.stalledAt).toBe(t.olderCursor)
  await useSession.getState().loadOlder('review-filtered')
  expect(sdk.history).toHaveBeenCalledTimes(5)
})

it('reproduces: a temporary empty SDK page also blocks every later retry', async () => {
  const t = timeline('review-empty')
  t.status = 'ready'
  t.olderCursor = 'edge'
  sdk.history.mockResolvedValue({ isEnd: false, messageList: [] })
  await useSession.getState().loadOlder('review-empty')
  expect(t.hasMore).toBe(true)
  await useSession.getState().loadOlder('review-empty')
  expect(sdk.history).toHaveBeenCalledTimes(1)
})

it('reproduces: an available member page is withheld until the next page resolves', async () => {
  let finish!: (items: unknown[]) => void
  sdk.members.mockImplementation(async (_group, offset) => offset === 0
    ? Array.from({ length: 200 }, (_, i) => ({ userID: `u${i}`, nickname: `Member ${i}`, roleLevel: 20 }))
    : new Promise((resolve) => { finish = resolve }))
  const work = useSession.getState().loadMembers('review-members')
  await vi.waitFor(() => expect(sdk.members).toHaveBeenCalledTimes(2))
  expect(useSession.getState().members['review-members']).toBeUndefined()
  finish([])
  await work
  expect(useSession.getState().members['review-members']).toHaveLength(200)
})

it('reproduces: a 2,050-member group silently stops at 2,000', async () => {
  sdk.members.mockImplementation(async (_group, offset, count) =>
    Array.from({ length: Math.min(count, 2050 - offset) }, (_, i) => ({ userID: `u${offset+i}`, nickname: 'Member', roleLevel: 20 })))
  await useSession.getState().loadMembers('review-large-members')
  expect(sdk.members).toHaveBeenCalledTimes(10)
  expect(useSession.getState().members['review-large-members']).toHaveLength(2000)
  expect(sdk.users).toHaveBeenCalledWith(expect.arrayContaining(['u1999']))
  expect(sdk.users.mock.calls[0][0]).toHaveLength(2000)
})
