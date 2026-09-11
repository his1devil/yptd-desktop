import { flushSync } from 'react-dom'

/**
 * 状态切换的连续感。能用 View Transitions 就用：命名的元素（会话头的头像和标题、放大的图）
 * 在两个状态之间连续移动，其余部分即时切换（tokens.css 里把 root 的交叉淡入关了）。
 * 不能用的时候（系统关了动效、内核太旧）就直接切，不留分支逻辑给调用方。
 *
 * `type` 走 view-transition 类型：`theme` 是从点击处圆形揭示（见 tokens.css）。
 */
export const reduceMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface ViewTransition { finished: Promise<void>; ready: Promise<void>; skipTransition(): void }
type Start = (arg: (() => void) | { update: () => void; types?: string[] }) => ViewTransition

export function transition(update: () => void, type?: string): Promise<void> {
  const start = (document as Document & { startViewTransition?: Start }).startViewTransition
  // 更新要在回调里同步落到 DOM——React 会攒着批处理，用 flushSync 逼它这一帧就画
  const run = (): void => flushSync(update)
  if (!start || reduceMotion()) { run(); return Promise.resolve() }
  try {
    const t = type ? start.call(document, { update: run, types: [type] }) : start.call(document, run)
    // 被下一次切换打断（skipTransition）会 reject，不算错
    return t.finished.catch(() => undefined)
  } catch {
    run()
    return Promise.resolve()
  }
}
