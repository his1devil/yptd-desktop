import type { Message, MessageId } from '../../../shared/model'

/**
 * 一个会话的消息，按时间排好，另带一张 id → 下标的表。
 *
 * 几千条消息里找一条、改一条（回应、撤回）都是 O(1)；新消息到达是追加，
 * 不是整个数组重排。往上翻一页是一次拼接。
 */
export type TimelineStatus = 'idle' | 'loading' | 'ready' | 'failed'

export class Timeline {
  private items: Message[] = []
  private index = new Map<MessageId, number>()
  hasMore = true
  /** 第一页到了没：idle 还没要过，loading 在路上，ready 到了（可能是空的），failed 没到。
   *  消息流按它决定画骨架、画空态还是画「重试」——不能用 hasMore 猜，猜错就是永远的骨架。 */
  status: TimelineStatus = 'idle'
  error: string | null = null
  /**
   * 往上翻页的游标：上一页原始 SDK 结果里最老那条的 clientMsgID。
   *
   * 不能用最老的**可见**消息：一整页全是回应或通知时它们会被过滤光，游标原地不动，
   * 再翻还是同一页。分页要跟着 SDK 的原始边界走。
   */
  olderCursor: string | null = null
  /** 这个会话自己的「正在往上翻」。原来是全局一个开关，A 会话的慢请求会把 B 的历史卡住。 */
  loadingOlder = false
  /**
   * 上一次用这个游标往上翻什么也没拿到。SDK 说还有历史却给不出来时不要原地打转，
   * 也不要就此宣告到底——游标一动就自动解开。
   */
  stalledAt: string | null = null
  /** stalledAt 是什么时候标上的。同一个游标短时间内不再问，但过一会儿要能重试。 */
  stalledSince = 0

  get messages(): readonly Message[] { return this.items }
  get length(): number { return this.items.length }
  get newest(): Message | undefined { return this.items[this.items.length - 1] }
  get oldest(): Message | undefined { return this.items[0] }

  get(id: MessageId): Message | undefined {
    const i = this.index.get(id)
    return i === undefined ? undefined : this.items[i]
  }

  /** 新增或替换。比最后一条新就直接追加——推送来的消息几乎都走这条快路径。返回是否是新消息。 */
  upsert(m: Message): boolean {
    const at = this.index.get(m.id)
    if (at !== undefined) { this.items[at] = m; return false }
    const last = this.items[this.items.length - 1]
    if (!last || compare(last, m) <= 0) {
      this.index.set(m.id, this.items.length)
      this.items.push(m)
      return true
    }
    const pos = this.bisect(m)
    this.items.splice(pos, 0, m)
    this.reindex(pos)
    return true
  }

  /** 更早的一页，整块拼到前面。 */
  prepend(page: Message[]): void {
    const fresh = page.filter((m) => !this.index.has(m.id)).sort(compare)
    if (fresh.length === 0) return
    this.items = [...fresh, ...this.items]
    this.reindex(0)
  }

  edit(id: MessageId, change: (m: Message) => Message): boolean {
    const at = this.index.get(id)
    if (at === undefined) return false
    this.items[at] = change(this.items[at]!)
    return true
  }

  remove(id: MessageId): boolean {
    const at = this.index.get(id)
    if (at === undefined) return false
    this.items.splice(at, 1)
    this.index.delete(id)
    this.reindex(at)
    return true
  }

  private bisect(m: Message): number {
    let lo = 0, hi = this.items.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (compare(this.items[mid]!, m) <= 0) lo = mid + 1; else hi = mid
    }
    return lo
  }

  private reindex(from: number): void {
    for (let i = from; i < this.items.length; i++) this.index.set(this.items[i]!.id, i)
  }
}

const compare = (a: Message, b: Message): number =>
  a.sentAt !== b.sentAt ? a.sentAt - b.sentAt : a.seq - b.seq

/**
 * 把已经被答案顶掉的占位藏起来。
 *
 * agent 先发“⏳ 正在处理…”再单独发答案；它撤不回占位（撤回按序号寻址，刚发出去时序号
 * 还读不到），所以打个标记留给客户端藏。规则：同一个发送者后面还有消息，占位就不算。
 */
export function visible(messages: readonly Message[]): Message[] {
  if (!messages.some((m) => m.transient)) return messages as Message[]
  const superseded = new Set<string>()
  const keep: Message[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (!(m.transient && superseded.has(m.sender))) keep.push(m)
    superseded.add(m.sender)
  }
  return keep.reverse()
}
