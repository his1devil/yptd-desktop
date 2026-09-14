import { useMemo } from 'react'
import type { Conversation, ConversationKind, Member, Person } from '../../../shared/model'
import type { Mentions } from '../views/rich'
import { glyphOf, pairOf } from '../components/Avatar'
import { kindOf, peerFrom, useSession } from './session'

/**
 * 一个会话在界面上需要知道的一切：叫什么、是哪种、对面是谁、有哪些成员。
 *
 * 会话列表里可能还没有它（第一次从名册点开一个 agent），这时从 id 和名册推。
 */
export interface Place {
  id: string
  kind: ConversationKind
  /** 和单个 agent 的会话：harness 形态 */
  isAgent: boolean
  title: string
  avatar: string | null
  glyph: string
  pair: number
  groupID: string | null
  peer: Person | null
  members: Member[]
  conversation: Conversation | null
}

interface Source { conversations: Conversation[]; roster: Person[]; members: Record<string, Member[]>; me: string }

export function placeOf(id: string, s: Source): Place {
  const conversation = s.conversations.find((c) => c.id === id) ?? null
  const kind = kindOf(id, s)
  const peerID = conversation?.peerID ?? (kind === 'channel' ? null : peerFrom(id, s.me))
  const peer = peerID ? s.roster.find((p) => p.userID === peerID) ?? null : null
  const groupID = conversation?.groupID ?? (kind === 'channel' ? id.slice(3) : null)
  const title = conversation?.title || peer?.nickname || peerID || groupID || id
  return {
    id, kind, isAgent: kind === 'agent_session', title,
    avatar: conversation?.avatar ?? null,
    glyph: glyphOf(title), pair: pairOf(peerID ?? groupID ?? id),
    groupID, peer,
    members: groupID ? s.members[groupID] ?? [] : [],
    conversation,
  }
}

export function usePlace(id: string | null): Place | null {
  const conversations = useSession((s) => s.conversations)
  const roster = useSession((s) => s.roster)
  const members = useSession((s) => s.members)
  const me = useSession((s) => s.me)
  return useMemo(() => (id ? placeOf(id, { conversations, roster, members, me }) : null), [id, conversations, roster, members, me])
}
