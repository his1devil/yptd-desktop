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

/**
 * 随消息一起发的文件。一条消息可以带几张图和几个文件，它们和文字是同一条消息，
 * 而不是各发一条——渲染成一段：文字、并排的图、文件卡。
 */
export interface Attachment {
  kind: 'image' | 'file'
  url: string
  name: string
  bytes: number
  /** 图片的原始尺寸。发送前就量好放进消息里，收到的一端不用等图片加载就能排版 */
  natural: PixelSize | null
}

/** 输入框里还没发出去的附件：有本机路径（交给 SDK 上传）和一张缩略图（发出去之前先显示它） */
export interface OutgoingAttachment {
  kind: 'image' | 'file'
  name: string
  path: string
  bytes: number
  mime: string
  natural: PixelSize | null
  preview: string | null
}

export interface Message {
  id: MessageId
  conversation: ConversationId
  sender: string
  senderName: string
  senderAvatar: string | null
  sentAt: number
  seq: number
  body: Body
  /** 和文字同一条消息里的图和文件；普通消息是空数组 */
  attachments: Attachment[]
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

/** 一条消息的一句话：正文，加上附件的占位——会话列表、通知、复制、引用都用它 */
export function summarize(m: Pick<Message, 'body' | 'attachments'>): string {
  const parts: string[] = []
  const text = plainText(m.body).trim()
  if (text) parts.push(text)
  const images = m.attachments.filter((a) => a.kind === 'image').length
  if (images) parts.push(images > 1 ? `[图片]×${images}` : '[图片]')
  for (const a of m.attachments) if (a.kind === 'file') parts.push(`[文件] ${a.name}`)
  return parts.join(' ')
}
