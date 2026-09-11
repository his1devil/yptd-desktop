import { useEffect, useState } from 'react'
import { api, type AgentProfile } from '../im/api'

/** agent 的资料（自我介绍、模型、人设）：服务端一次给全，进程里缓存一份；拉失败下次再试 */
let cache: Promise<AgentProfile[]> | null = null
export const loadAgents = (): Promise<AgentProfile[]> => (cache ??= api.agents().catch((e) => { cache = null; throw e }))

/** 用在欢迎页、agent 会话的空态、右侧栏资料页；没拉到之前是 null，拉失败是空数组 */
export function useAgentProfiles(): AgentProfile[] | null {
  const [list, setList] = useState<AgentProfile[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadAgents().then((l) => { if (alive) setList(l) }).catch(() => { if (alive) setList([]) })
    return () => { alive = false }
  }, [])
  return list
}
