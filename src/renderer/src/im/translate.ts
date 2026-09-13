import type { MessageItem } from '@openim/wasm-client-sdk'
import type {
  AgentIdentity, Attachment, Body, ConversationId, Message, MessageId, PixelSize, QuotePreview, Reaction,
} from '../../../shared/model'

/**
 * 把 OpenIM 送来的东西翻成这个 app 显示的东西。
 *
 * 它是有状态的，而且是故意的：表情回应折叠成表；哪些回应消息已经折过要记住
 * （历史每翻一页都会把同一条再送一遍，而回应是个开关）；名册里谁是 agent、
 * 谁现在叫什么，都是在这里决定的，行组件不用再问任何人。
 *
 * 这里收录的每一条怪癖都是在真实部署上踩出来的，对应的测试在 translate.test.ts。
 */

export const ContentType = {
  text: 101, picture: 102, voice: 103, video: 104, file: 105, atText: 106,
  custom: 110, quote: 114, advancedText: 117, markdown: 118,
  notificationFrom: 1000, notificationTo: 5000,
} as const

const MENTION = /@[A-Za-z][A-Za-z0-9_]*|@[一-龥]{2,4}/g

export interface ReactionPayload { yptd: 'reaction'; target: string; emoji: string }

export function reactionData(target: string, emoji: string): string {
  return JSON.stringify({ yptd: 'reaction', target, emoji } satisfies ReactionPayload)
}

export class Translator {
  private agents = new Map<string, AgentIdentity>()
  private agentNames = new Set<string>()
  /** 每个人当前的显示名。OpenIM 把发送时的昵称烤进每条消息，改名后旧消息还是旧名，这里覆盖它。 */
  private names = new Map<string, string>()
  /** 目标 clientMsgID → emoji → 点了的人 */
  private reacted = new Map<string, Map<string, Set<string>>>()
  private foldedReactions = new Set<string>()
  private touched = new Set<string>()
  /** OpenIM 的 @全体 占位 id，从 SDK 读，像真用户 id 一样出现在 atUserList 里 */
  atAllTag = ''

  constructor(readonly me: string) {}

  setAgents(list: AgentIdentity[]): void {
    this.agents = new Map(list.map((a) => [a.userID, a]))
    this.agentNames = new Set(list.map((a) => a.nickname))
  }
  setNames(map: Record<string, string>): void {
    this.names = new Map(Object.entries(map))
  }

  /** 一页历史或一批推送，最老的在前。回应先折，行后建——一页里消息和它的回应同时到，
   *  单遍会在回应折进去之前就把消息建完，到屏幕上是光的。 */
  messages(raws: MessageItem[]): Message[] {
    for (const r of raws) this.foldReaction(r)
    const out: Message[] = []
    for (const r of raws) {
      const m = this.message(r)
      if (m) out.push(m)
    }
    return out
  }

  /** `null` 表示这不是一行消息：通知、回应、认不出的自定义消息。 */
  message(raw: MessageItem): Message | null {
    const ct = raw.contentType
    if (ct >= ContentType.notificationFrom && ct <= ContentType.notificationTo) return null
    if (this.isReaction(raw)) return null
    let body = this.body(raw)
    if (!body) return null

    // 文字和附件一条消息：附件在 ex 里；没打字时正文是给别的端看的占位（"[图片]"），这里不显示它
    const rich = parseRich(raw.ex)
    if (rich?.textless && body.kind === 'text') body = { kind: 'text', text: '' }
    const text = body.kind === 'text' ? body.text : ''
    const mentioned = raw.atTextElem?.atUserList ?? []
    const mentions = text.includes('@') ? (text.match(MENTION) ?? []) : []
    const agentMentions = mentions.filter((m) => this.agentNames.has(m.slice(1)))

    // SDK 的类型把这几个字段标成可选；服务端实际上总会给，缺了就当空串
    const id = raw.clientMsgID ?? ''
    const sender = raw.sendID ?? ''
    const agent = this.agents.get(sender)
    return {
      id,
      conversation: conversationOf(raw, this.me),
      sender,
      senderName: this.names.get(sender) ?? (raw.senderNickname || sender),
      senderAvatar: raw.senderFaceUrl || null,
      sentAt: raw.sendTime ?? 0,
      seq: raw.seq ?? 0,
      body,
      attachments: rich?.attachments ?? [],
      quote: this.quote(raw),
      reactions: this.reactionsOn(id),
      sendState: raw.status === 3 ? 'failed' : raw.status === 1 ? 'sending' : 'sent',
      mentionsMe: mentioned.includes(this.me) || (!!this.atAllTag && mentioned.includes(this.atAllTag)),
      isAgent: !!agent,
      agentTag: agent?.tag ?? null,
      transient: isTransient(raw.ex),
      runID: runOf(raw.ex),
      mentions: mentions.filter((m) => !agentMentions.includes(m)),
      agentMentions,
      dayIndex: dayIndex(raw.sendTime),
    }
  }

  private body(raw: MessageItem): Body | null {
    // SDK 的 MessageType 枚举没有 117/118，但服务端会发；按数字比
    switch (raw.contentType as number) {
      case ContentType.text:
        return { kind: 'text', text: raw.textElem?.content ?? '' }
      case ContentType.atText:
        return { kind: 'text', text: raw.atTextElem?.text ?? raw.textElem?.content ?? '' }
      case ContentType.quote:
        return { kind: 'text', text: raw.quoteElem?.text ?? '' }
      case ContentType.markdown:
      case ContentType.advancedText:
        return { kind: 'text', text: raw.advancedTextElem?.text ?? raw.textElem?.content ?? '' }
      case ContentType.picture: {
        const el = raw.pictureElem
        if (!el) return null
        // 刚发出去那条的回显里 sourcePicture.size 是 0，要在三张里找一张非零的
        const best = [el.sourcePicture, el.bigPicture, el.snapshotPicture].find((p) => p && p.size > 0 && p.url)
          ?? [el.sourcePicture, el.bigPicture, el.snapshotPicture].find((p) => p && p.url)
        if (!best) return null
        const natural: PixelSize | null = best.width > 0 && best.height > 0 ? { width: best.width, height: best.height } : null
        // bytes 给查看器判断「原图本来就不大，别去要更大的 PNG 缩图」；回显里可能是 0，当成未知
        return { kind: 'picture', url: best.url, name: fileName(el.sourcePath, best.uuid, 'png'), natural, bytes: best.size > 0 ? best.size : 0 }
      }
      case ContentType.file: {
        const el = raw.fileElem
        if (!el) return null
        return { kind: 'file', url: el.sourceUrl, name: el.fileName, bytes: el.fileSize }
      }
      case ContentType.custom:
        // 回应走这条；认不出的自定义消息宁可不显示，也不显示成噪音
        return null
      case ContentType.voice: return { kind: 'unsupported', label: '[语音]' }
      case ContentType.video: return { kind: 'unsupported', label: '[视频]' }
      default: return { kind: 'unsupported', label: '[这条消息需要更新客户端]' }
    }
  }

  private quote(raw: MessageItem): QuotePreview | null {
    // 既回复又 @ 人的消息以 106 到达，引用塞在 atTextElem 里，不是 114
    const q = raw.quoteElem?.quoteMessage ?? raw.atTextElem?.quoteMessage
    // createAt / createQuote 在没有引用时也会塞一个空的 quoteMessage（{} 或全空字段），
    // 得看它到底指没指向一条真消息，否则每条 @消息都会挂一个「? [图片]」的幽灵引用
    const real = !!(q && (q.clientMsgID || q.textElem?.content || q.atTextElem?.text || q.pictureElem || q.fileElem))
    if (!q || !real) return null
    const excerpt = q.textElem?.content ?? q.atTextElem?.text ?? (q.pictureElem ? '[图片]' : '')
    const qSender = q.sendID ?? ''
    return {
      messageId: q.clientMsgID || null,
      senderID: qSender,
      senderName: this.names.get(qSender) ?? (q.senderNickname || qSender),
      excerpt: excerpt.replace(/\s*\n\s*/g, ' ').trim(),
    }
  }

  // ---- 表情回应 ------------------------------------------------------------

  private isReaction(raw: MessageItem): boolean {
    return raw.contentType === ContentType.custom && !!parseReaction(raw.customElem?.data)
  }

  /** 折一条回应进表。同一条消息只折一次——历史会把它再送来，而回应是个开关。 */
  private foldReaction(raw: MessageItem): void {
    if (raw.contentType !== ContentType.custom) return
    const p = parseReaction(raw.customElem?.data)
    if (!p) return
    const id = raw.clientMsgID ?? ''
    const sender = raw.sendID ?? ''
    if (this.foldedReactions.has(id)) return
    this.foldedReactions.add(id)
    let byEmoji = this.reacted.get(p.target)
    if (!byEmoji) this.reacted.set(p.target, (byEmoji = new Map()))
    let people = byEmoji.get(p.emoji)
    if (!people) byEmoji.set(p.emoji, (people = new Set()))
    if (people.has(sender)) people.delete(sender); else people.add(sender)
    if (people.size === 0) byEmoji.delete(p.emoji)
    if (byEmoji.size === 0) this.reacted.delete(p.target)
    this.touched.add(p.target)
  }

  reactionsOn(target: MessageId): Reaction[] {
    const byEmoji = this.reacted.get(target)
    if (!byEmoji) return []
    return [...byEmoji.entries()]
      .map(([emoji, people]) => ({ emoji, count: people.size, mine: people.has(this.me) }))
      // 多的在前，同数按表情本身排：各端顺序一致，重绘也不跳
      .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.emoji < b.emoji ? -1 : 1))
  }

  /** 上次取走之后回应变过的消息。回应可能比它指向的消息先到，那就先不报，等消息建出来时自己带上。 */
  drainReactionChanges(known: (id: MessageId) => boolean): { id: MessageId; reactions: Reaction[] }[] {
    const out: { id: MessageId; reactions: Reaction[] }[] = []
    for (const id of this.touched) if (known(id)) out.push({ id, reactions: this.reactionsOn(id) })
    this.touched.clear()
    return out
  }
}

// ---- 纯函数 -----------------------------------------------------------------

export function conversationOf(
  raw: { groupID?: string; sendID?: string; recvID?: string }, me: string,
): ConversationId {
  if (raw.groupID) return `sg_${raw.groupID}`
  const sender = raw.sendID ?? ''
  return directId(me, sender === me ? raw.recvID ?? '' : sender)
}

/** 私聊会话 id 是两个 user id 按字典序拼的，两端不用问谁就算出同一个串 */
export function directId(a: string, b: string): ConversationId {
  const [x, y] = [a, b].sort()
  return `si_${x}_${y}`
}

export function isTransient(ex: string | undefined): boolean {
  return parseEx(ex)?.yptd === 'pending'
}

/** 占位和最终回答的 ex 里都带 run id：`{"yptd":"pending"|"run","run":"run_…"}` */
export function runOf(ex: string | undefined): string | null {
  const p = parseEx(ex)
  return p && (p.yptd === 'pending' || p.yptd === 'run') && p.run ? p.run : null
}

interface Ex { yptd?: string; run?: string; a?: RichAtt[]; t?: number }

function parseEx(ex: string | undefined): Ex | null {
  if (!ex) return null
  try { return JSON.parse(ex) as Ex } catch { return null }
}

// ---- 文字 + 附件一条消息 ---------------------------------------------------------
//
// 消息本身还是文本（101/106），别的端和服务端照旧读到文字、@ 和引用；附件列表放在 ex：
//   {"yptd":"rich","a":[{"k":"i","u":url,"n":name,"s":bytes,"w":W,"h":H},{"k":"f",…}],"t":1}
// t=0 表示发的人没打字，正文是给不认识 ex 的端看的占位（"[图片]"），认识的端把它藏掉。

/** ex 里一个附件：k 类型（i 图 / f 文件），u 地址，n 名字，s 字节，w/h 图片原始尺寸 */
interface RichAtt { k: 'i' | 'f'; u: string; n: string; s: number; w?: number; h?: number }

export function richEx(attachments: Attachment[], hasText: boolean): string {
  const a: RichAtt[] = attachments.map((x) => ({
    k: x.kind === 'image' ? 'i' : 'f', u: x.url, n: x.name, s: x.bytes,
    ...(x.natural ? { w: x.natural.width, h: x.natural.height } : {}),
  }))
  return JSON.stringify({ yptd: 'rich', a, t: hasText ? 1 : 0 })
}

export function parseRich(ex: string | undefined): { attachments: Attachment[]; textless: boolean } | null {
  const p = parseEx(ex)
  if (!p || p.yptd !== 'rich' || !Array.isArray(p.a)) return null
  const attachments: Attachment[] = []
  for (const x of p.a) {
    if (!x || typeof x.u !== 'string' || !x.u) continue
    attachments.push({
      kind: x.k === 'i' ? 'image' : 'file', url: x.u, name: typeof x.n === 'string' && x.n ? x.n : '文件', bytes: typeof x.s === 'number' ? x.s : 0,
      natural: x.k === 'i' && typeof x.w === 'number' && typeof x.h === 'number' && x.w > 0 && x.h > 0 ? { width: x.w, height: x.h } : null,
    })
  }
  return { attachments, textless: p.t === 0 }
}

/** 没打字时的正文：给不认识 ex 的端、会话列表和通知看。只看种类和名字，所以上传之前就能算出来 */
export function placeholderFor(attachments: readonly Pick<Attachment, 'kind' | 'name'>[]): string {
  const images = attachments.filter((a) => a.kind === 'image').length
  const parts: string[] = []
  if (images) parts.push(images > 1 ? `[图片]×${images}` : '[图片]')
  for (const a of attachments) if (a.kind === 'file') parts.push(`[文件] ${a.name}`)
  return parts.join(' ') || '[附件]'
}

export function parseReaction(data: string | undefined): ReactionPayload | null {
  if (!data) return null
  try {
    const p = JSON.parse(data) as Partial<ReactionPayload>
    return p.yptd === 'reaction' && p.target && p.emoji ? (p as ReactionPayload) : null
  } catch { return null }
}

/** 本地日序号。按本地午夜切，不是按 UTC——东八区早上八点前的消息不能算到前一天。 */
export function dayIndex(millis: number): number {
  const d = new Date(millis)
  const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((localMidnight - new Date(1970, 0, 1).getTime()) / 86_400_000)
}

export function dayLabel(index: number, today = dayIndex(Date.now())): string {
  const d = new Date(1970, 0, 1 + index)
  const date = `${d.getMonth() + 1}月${d.getDate()}日`
  if (index === today) return `今天 · ${date}`
  if (index === today - 1) return `昨天 · ${date}`
  return d.getFullYear() === new Date().getFullYear() ? date : `${d.getFullYear()}年${date}`
}

function fileName(path: string | undefined, uuid: string | undefined, ext: string): string {
  const fromPath = (path ?? '').split('/').pop() ?? ''
  if (fromPath && fromPath !== '/') return fromPath
  if (uuid) return `${uuid}.${ext}`
  return `图片.${ext}`
}
