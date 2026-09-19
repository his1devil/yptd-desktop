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
  /** 谁把这个人拉进频道的。移除 agent 的资格要看它（见 canRemove） */
  inviter: string | null
}

/**
 * 能不能把 target 移出频道。和服务端（yptd-serve 的 mayRemoveAgent）、OpenIM 自己的踢人
 * 校验、iOS 的 Membership 是同一套规则——按钮显示出来就该点得动。
 *
 * agent 走 yptd-server：群主可以，当初把它拉进来的人也可以。只靠 OpenIM 的话只有群主能踢，
 * 而线上所有频道都没有管理员，于是每个频道只有一个人动得了 agent——把一个吵人的机器人
 * 请出去，不该比请进来难。人走 OpenIM，只有群主能踢。谁也移不走群主，谁也不在这里移自己
 * （那是退出）。
 */
export function canRemove(target: Member, me: Member | undefined): boolean {
  if (!me || me.id === target.id || target.role === 'owner') return false
  if (me.role === 'owner') return true
  return target.isAgent && !!target.inviter && target.inviter === me.id
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
  | { kind: 'picture'; url: string; name: string; natural: PixelSize | null; bytes: number }
  | { kind: 'file'; url: string; name: string; bytes: number }
  | { kind: 'unsupported'; label: string }

export type SendState = 'sending' | 'sent' | 'failed'

/**
 * 随消息一起发的文件。一条消息可以带几张图和几个文件，它们和文字是同一条消息，
 * 而不是各发一条——渲染成一段：文字、并排的图、文件卡。
 */
export interface Attachment {
  /** video 是 2026-09-19 补的：以前桌面只有 image / file，iOS 发来的视频在这边是一张文件卡 */
  kind: 'image' | 'video' | 'file'
  url: string
  name: string
  bytes: number
  /** 图片/视频的像素尺寸。发送前就量好放进消息里，收到的一端不用等加载就能排版 */
  natural: PixelSize | null
  /** 视频的封面图地址和时长（秒） */
  poster?: string | null
  duration?: number | null
  /** 发送端报的 mime。没有就按扩展名猜 */
  mime?: string | null
  /**
   * 发送端生成的缩略档地址（协议里的 `th.u`）和它的尺寸。消息流里显示的就是它，不再由
   * 接收端去猜 `?type=image&width=` —— 那套要靠 URL 长什么样来判断能不能缩，换个对象存储
   * 或者加个 CDN 前缀就静默失效，而且服务端的缩图是 q75 加最近邻。
   *
   * 老消息、没更新的客户端、OpenIM 自己的图片消息都不会有它，所以按需缩图那条退路要永远留着。
   */
  thumb?: string | null
  thumbSize?: PixelSize | null
  /**
   * ThumbHash（协议里的 `b`）：二三十个字节的模糊占位，跟着消息体走，不产生任何额外请求。
   * 在 260 KB/s 的管子上，一张图到达之前的那几秒原本是一块空白。
   */
  blur?: string | null
  /** 原图（协议里的 `o`）：发的人勾了「原图」才有 */
  original?: string | null
  originalBytes?: number | null
}

/** 输入框里还没发出去的附件：有本机路径（交给 SDK 上传）和一张缩略图（发出去之前先显示它） */
export interface OutgoingAttachment {
  kind: 'image' | 'video' | 'file'
  name: string
  path: string
  bytes: number
  mime: string
  natural: PixelSize | null
  preview: string | null
  /** 视频：本机封面图的路径（单独上传成一个对象）和时长 */
  posterPath?: string | null
  duration?: number | null
  /** 发这张图时要不要连原文件一起传（输入框里的「原图」勾选） */
  wantOriginal?: boolean
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
  /** 允不允许被拉进群。服务端会拒绝整批邀请，所以选人时要先把这些人排除掉。 */
  joinable: boolean
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
