import { useSyncExternalStore } from 'react'

/**
 * 每个 agent 的身份色。名册（/v1/users）带着它，服务端按位次分配，四个 agent 四个色。
 *
 * 放在这里而不是 store 里，是为了让 Avatar 保持纯展示：它只认一个 userID，颜色自己查，
 * 十几个调用点就不用各自把颜色一路传下来。会话 store 拉到名册时灌一次。
 */
const colors = new Map<string, string>()

export function setAgentColors(pairs: Iterable<[string, string | null]>): void {
  colors.clear()
  for (const [id, c] of pairs) if (c) colors.set(id, c)
}

/** 没登记过就返回 null，调用方退回统一的 --agent */
export const agentColor = (userID?: string | null): string | null => (userID ? colors.get(userID) ?? null : null)

/**
 * 每个人的头像地址，按账号查。和上面的颜色一样放在这里，是为了让 Avatar 只认一个 userID：
 * 十几个调用点里有一半（侧栏的 Agents 列表、会话标题）手上没有头像地址，以前 agent 反正
 * 只画标记，传不传无所谓；现在 agent 的脸是服务端给的图（三端同一张），不传就看不到。
 *
 * 用 useSyncExternalStore 而不是直接读 Map：名册是登录之后才到的，到的时候这些头像早就
 * 画完了，得有人叫它们重画。
 */
let faces: Record<string, string> = {}
const watchers = new Set<() => void>()

export function setFaces(next: Record<string, string>): void {
  if (next === faces) return
  faces = next
  for (const w of watchers) w()
}

const watch = (fn: () => void): (() => void) => {
  watchers.add(fn)
  return () => watchers.delete(fn)
}

export function useFace(userID?: string | null): string | null {
  return useSyncExternalStore(watch, () => (userID ? faces[userID] ?? null : null), () => null)
}
