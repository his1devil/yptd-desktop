/**
 * 频道自己的两个开关。存在 OpenIM 群的 `ex` 里，和服务端 internal/channel 是同一套约定
 * ——两边都要能读懂，改了这里记得改那边。
 *
 * 没设过（`ex` 为空、不是 JSON、或者是别人的载荷）一律算**两个都关**。这个功能之前
 * 建的群 `ex` 都是空的，它们必须保持私密，而不是因为上线就突然人人可搜可进。
 */
export interface ChannelPolicy {
  /** 出现在频道目录的搜索结果里 */
  findable: boolean
  /** 找到的人可以直接走进来。关着＝只能被邀请，服务端会拦住自助加入。 */
  joinable: boolean
}

export const CLOSED: ChannelPolicy = { findable: false, joinable: false }

export function parsePolicy(ex: string | undefined): ChannelPolicy {
  if (!ex) return CLOSED
  try {
    const p = JSON.parse(ex) as { yptd?: string; find?: number; join?: number }
    if (p.yptd !== 'channel') return CLOSED
    return { findable: p.find === 1, joinable: p.join === 1 }
  } catch { return CLOSED }
}

export function encodePolicy(p: ChannelPolicy): string {
  return JSON.stringify({ yptd: 'channel', find: p.findable ? 1 : 0, join: p.joinable ? 1 : 0 })
}

/** OpenIM 的 needVerification：2 直接进，1 要验证 */
export const VERIFY_ALL = 1
export const VERIFY_DIRECT = 2

/**
 * 和开关配套的 needVerification。必须跟着一起写：可加入的频道要是留在「要验证」上，
 * 每一次被允许的加入都会变成一条没人会去批的挂起申请——我们没有审批界面。
 */
export const verificationFor = (p: ChannelPolicy): number => (p.joinable ? VERIFY_DIRECT : VERIFY_ALL)
