/**
 * 频道自己的两个开关，**只读**。
 *
 * 它们存在 OpenIM 群的 `ex` 里，和服务端 `internal/channel` 是同一套约定。读在这边做，
 * 因为群信息本来就在手上，不值得再问服务端一次。
 *
 * **写不在这里**，走 `api.setChannelPolicy`。写的时候 `ex` 必须和 OpenIM 的
 * `needVerification` 一起改，而那条规律只在服务端实现一次——这里曾经有过一份
 * `encodePolicy` / `verificationFor` 的镜像，删掉了：多一份就多一个会悄悄漂移的地方，
 * 而漂移的表现是「加入按钮在、请求成功、人不出现」，哪里都不报错。
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
