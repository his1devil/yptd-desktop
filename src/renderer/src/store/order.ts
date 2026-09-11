import type { Conversation, Person } from '../../../shared/model'
import { directId } from '../im/translate'

/** 侧栏「会话」区里的顺序：频道、私聊、名册里的 agent。⌥↑↓ 和 ⌘1–9 按它走。纯函数，测试不用碰 SDK。 */
export function orderedConversationIds(s: { conversations: Conversation[]; roster: Person[]; me: string }): string[] {
  return [
    ...s.conversations.filter((c) => c.kind === 'channel').map((c) => c.id),
    ...s.conversations.filter((c) => c.kind === 'dm').map((c) => c.id),
    ...s.roster.filter((p) => p.isAgent).map((a) => directId(s.me, a.userID)),
  ]
}

/** 从 current 出发按 dir 找下一个会话；unreadOnly 只在有未读的里找。循环，找不到给 null。 */
export function nextConversation(ids: string[], current: string | null, dir: 1 | -1, unread: Set<string>, unreadOnly: boolean): string | null {
  if (ids.length === 0) return null
  let i = current ? ids.indexOf(current) : -1
  for (let n = 0; n < ids.length; n++) {
    i = (i + dir + ids.length) % ids.length
    const id = ids[i]!
    if (id === current) continue
    if (!unreadOnly || unread.has(id)) return id
  }
  return null
}
