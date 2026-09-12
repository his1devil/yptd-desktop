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
