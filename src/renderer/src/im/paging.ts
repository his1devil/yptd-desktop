/**
 * 往上翻历史时，一页回来之后边界和游标怎么定。
 *
 * 单独拎出来是因为这里有个不显眼的坑：SDK 一页里可能全是回应、通知或认不出的自定义消息，
 * 翻译层会把它们全过滤掉，过滤后一条不剩。拿过滤后的条数判断「到底了」，就会把还有历史的
 * 会话直接截断；游标拿过滤后最老的那条，整页被过滤时它根本没动，再翻还是同一页。
 *
 * 所以：边界只看 SDK 的 isEnd，游标只看原始页的边界。
 */
export interface RawPage {
  /** SDK 这一页原始返回了几条 */
  count: number
  /** 过滤之后还剩几条能显示的 */
  shown: number
  /** SDK 说这个方向到头了 */
  isEnd: boolean
  /** 这一页里最老那条的 clientMsgID；空页就是 null */
  edge: string | null
}

export interface PageStep {
  /** 还能不能继续往上翻 */
  hasMore: boolean
  /** 下一次该用的游标；拿不到边界就保持原样 */
  cursor: string | null
  /** 这一页什么也没显示出来，但还有历史：接着翻下一页 */
  again: boolean
}

export function step(page: RawPage, cursor: string): PageStep {
  const hasMore = !page.isEnd
  return {
    hasMore,
    cursor: page.edge ?? (cursor || null),
    // 原始页有内容但全被过滤了，才值得再翻一页；游标没往前动就别再试，那是原地打转
    again: hasMore && page.shown === 0 && page.count > 0 && !!page.edge && page.edge !== cursor,
  }
}
