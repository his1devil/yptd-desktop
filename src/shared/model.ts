/**
 * 这个 app 看到的世界。OpenIM 的形状停在翻译层外面，界面只认这里的类型。
 */

export type ConversationId = string // 'sg_<groupID>' | 'si_<a>_<b>'
export type MessageId = string      // OpenIM 的 clientMsgID，服务端保证唯一且稳定

export type ConversationKind = 'channel' | 'dm' | 'agent_session'
export type RenderMode = 'im' | 'harness'

export interface Conversation {
  id: ConversationId
  kind: ConversationKind
  /** 频道是 IM 形态；和单个 agent 的私聊是 harness 形态。形态跟随语境。 */
  renderMode: RenderMode
  title: string
  avatar: string | null
  unread: number
  mentioned: boolean
  pinned: boolean
  preview: string
  lastAt: number
  groupID: string | null
  /** 私聊对面那个人 */
  peerID: string | null
}

export interface Member {
  id: string
  name: string
  avatar: string | null
  role: 'owner' | 'admin' | 'member'
  isAgent: boolean
}

export interface Reaction {
  emoji: string
  count: number
  mine: boolean
}

export interface QuotePreview {
  messageId: MessageId | null
  senderID: string
  senderName: string
  excerpt: string
}

export interface PixelSize { width: number; height: number }

export type Body =
  | { kind: 'text'; text: string }
  | { kind: 'picture'; url: string; name: string; natural: PixelSize | null }
  | { kind: 'file'; url: string; name: string; bytes: number }
  | { kind: 'unsupported'; label: string }

export type SendState = 'sending' | 'sent' | 'failed'

export interface Message {
  id: MessageId
  conversation: ConversationId
  sender: string
  senderName: string
  senderAvatar: string | null
  sentAt: number
  seq: number
  body: Body
  quote: QuotePreview | null
  reactions: Reaction[]
  sendState: SendState
  mentionsMe: boolean
  isAgent: boolean
  agentTag: string | null
  /** 发送者标记为将被替换的占位，如 agent 的“正在处理…” */
  transient: boolean
  /** 这条消息背后的 agent 运行（占位和最终回答都带着它），没有就是普通消息 */
  runID: string | null
  /** 正文里的 @名字，人和 agent 分开，渲染时各自上色 */
  mentions: string[]
  agentMentions: string[]
  /** 本地日序号，列表按它插日期分隔 */
  dayIndex: number
}

export interface AgentIdentity {
  userID: string
  nickname: string
  tag: string
  color: string | null
}

/** 花名册里的一个人（/v1/users） */
export interface Person {
  userID: string
  nickname: string
  isAgent: boolean
  tag: string | null
  color: string | null
}

export const plainText = (b: Body): string => {
  switch (b.kind) {
    case 'text': return b.text
    case 'picture': return b.name
    case 'file': return b.name
    case 'unsupported': return b.label
  }
}
