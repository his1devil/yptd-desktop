import { create } from 'zustand'
import type { Attachment, Conversation, ConversationId, ConversationKind, Member, Message, MessageId, OutgoingAttachment, Person, Reaction } from '../../../shared/model'
import { summarize } from '../../../shared/model'
import { DEFAULT_SERVER, clearCredential, loadCredential, login, loginWithPassword, register, roster, saveCredential, serverAuth, setServerAuth, AuthError, type ServerConfig } from '../im/auth'
import { api } from '../im/api'
import { im, SdkEvent, type ConversationItem, type GroupMemberItem, type MessageItem } from '../im/client'
import { tidyError } from '../im/errors'
import { Translator, directId, placeholderFor, reactionData, richEx } from '../im/translate'
import { Timeline } from '../im/timeline'
import { step } from '../im/paging'
import { mapLimit, rememberPreview } from '../im/files'
import { randomObjectName } from '../../../shared/prepare'
import { setAgentColors, setFaces } from '../components/identity'
import { composerBus } from '../views/composerBus'
import { transition } from '../motion/transition'
import { useUI } from './ui'

/**
 * 登录、连接、会话、消息——app 与服务端之间的全部状态。
 *
 * 时间线不放进 zustand 的 state 里（几千条消息每次 set 都要浅比较），而是放在 store
 * 外的 Map，state 里只放一个 `tick` 让订阅者知道该重画。行组件按 id 取消息。
 */

export type Phase =
  | { kind: 'booting' }
  | { kind: 'signedOut' }
  | { kind: 'connecting'; what: string }
  | { kind: 'ready' }
  | { kind: 'failed'; why: string; code?: string }

interface SessionState {
  phase: Phase
  /** 这台机器上存着设备凭据。连接失败时决定给「重试」还是给邀请码表单。 */
  hasCredential: boolean
  /** 这个账号设过密码没有。设置页据此显示「设置密码」还是「修改密码」 */
  hasPassword: boolean
  me: string
  myName: string
  myAvatar: string | null
  /** 个性签名。存在 OpenIM 用户的 ex 里，别人也读得到 */
  myBio: string
  /** 每个人的签名，从 getUsersInfo 的 ex 里解出来 */
  bios: Record<string, string>
  connected: boolean
  syncing: boolean
  roster: Person[]
  /** 每个人当前的头像。OpenIM 把发送时的头像烤进每条消息，换了头像旧消息还是旧图，渲染时用这张表覆盖 */
  avatars: Record<string, string>
  conversations: Conversation[]
  members: Record<string, Member[]>
  /** 时间线变过就 +1；具体内容从 timelines() 取 */
  tick: number
  notice: string | null

  boot(): Promise<void>
  register(invite: string, nickname: string, password?: string): Promise<void>
  /** 这台机器没有凭据时用账号密码进来；服务端发一份新凭据，之后照样自动登录 */
  signInWithPassword(userID: string, password: string): Promise<void>
  signOut(): Promise<void>
  /** 设置或修改密码。已有密码时必须给对旧的 */
  setPassword(password: string, oldPassword?: string): Promise<void>
  open(id: ConversationId): Promise<void>
  /** 把一个会话标成已读（快捷键用）；正看着的会话平时由消息流自己标 */
  markRead(id: ConversationId): Promise<void>
  /** 第一页还没到（或上次没到）就去拉；到过了什么都不做。消息流挂上来时调，重启后恢复的会话靠它加载。 */
  ensure(id: ConversationId): Promise<void>
  loadOlder(id: ConversationId): Promise<void>
  send(id: ConversationId, text: string, opts?: { quote?: MessageId; mentions?: string[]; draftToken?: string }): Promise<void>
  /** 文字和附件一条消息：先在时间线上摆一条「发送中」，传完文件、发出去后换成服务端回显 */
  sendRich(id: ConversationId, text: string, opts: { quote?: MessageId; mentions?: string[]; attachments: OutgoingAttachment[]; draftToken?: string }): Promise<void>
  react(id: ConversationId, target: MessageId, emoji: string): Promise<void>
  revoke(id: ConversationId, target: MessageId): Promise<void>
  loadMembers(groupID: string): Promise<void>
  /** 重新拉一次花名册。新注册的人只有这一条路能进来：服务端没有「有人注册了」这种推送。 */
  refreshRoster(): Promise<void>
  dismissNotice(): void

  createChannel(name: string, memberIDs: string[]): Promise<ConversationId>
  renameChannel(groupID: string, name: string): Promise<void>
  inviteToChannel(groupID: string, userIDs: string[]): Promise<void>
  /** 自己走进一个公开频道。没开放自由加入的话服务端会拒，错误里说得清原因。 */
  joinChannel(groupID: string): Promise<ConversationId>
  /** 把一个成员移出频道：agent 走 yptd-server，人走 OpenIM。资格见 shared/model 的 canRemove */
  removeMember(groupID: string, member: Member): Promise<void>
  leaveChannel(groupID: string): Promise<void>
  dismissChannel(groupID: string): Promise<void>
  updateNickname(nickname: string): Promise<void>
  updateAvatar(path: string): Promise<void>
  updateBio(bio: string): Promise<void>
  markAllRead(): Promise<void>
}

// ---- store 外的重对象 -----------------------------------------------------------
const timelines = new Map<ConversationId, Timeline>()
let translator = new Translator('')
let cfg: ServerConfig = DEFAULT_SERVER
let unsubscribe: (() => void)[] = []
let bootPromise: Promise<void> | null = null

export const timeline = (id: ConversationId): Timeline => {
  let t = timelines.get(id)
  if (!t) timelines.set(id, (t = new Timeline()))
  return t
}
export const agentsOf = (people: Person[]) => people.filter((p) => p.isAgent)

const PAGE = 40
/** 整页被过滤光时最多再往前翻几页。给个上限，免得一屏历史全是通知时一直转下去 */
const SKIP_ROUNDS = 5
/** 同一个游标要空之后，隔这么久才值得再问一次 */
const STALL_COOLDOWN = 5_000
/** 成员一次要多少、最多要到多少。大群要接着翻页，但也不能把几万人一次全拉下来 */
const MEMBER_PAGE = 200
const MEMBER_CAP = 2000
/** 正在路上的成员请求，按群记：open()、同步完成和成员变动事件会同时要，只发一次 */
const memberLoads = new Map<string, Promise<void>>()

/**
 * SDK 这一页里最老的那条。不假定返回顺序：游标取错一次，翻页就会原地打转。
 */
function oldestRaw(raws: readonly MessageItem[]): MessageItem | undefined {
  let best: MessageItem | undefined
  for (const r of raws) {
    if (!best) { best = r; continue }
    const older = r.sendTime !== best.sendTime ? r.sendTime < best.sendTime : (r.seq ?? 0) < (best.seq ?? 0)
    if (older) best = r
  }
  return best
}

export const useSession = create<SessionState>()((set, get) => ({
  phase: { kind: 'booting' },
  hasCredential: false, hasPassword: false,
  me: '', myName: '', myAvatar: null, myBio: '', bios: {},
  connected: false, syncing: false,
  roster: [], avatars: {}, conversations: [], members: {},
  tick: 0, notice: null,

  boot() {
    // StrictMode 会把挂载效果跑两遍；两次并发的 boot 只连一次
    if (!bootPromise) {
      bootPromise = (async () => {
        const cred = await loadCredential()
        set({ hasCredential: !!cred })
        if (!cred) { set({ phase: { kind: 'signedOut' } }); return }
        await connect(set, get, async () => login(cfg, cred.deviceToken), cred.deviceToken)
      })().finally(() => { bootPromise = null })
    }
    return bootPromise
  },

  async register(invite, nickname, password) {
    await connect(set, get, async () => {
      const s = await register(cfg, invite, nickname, password)
      await saveCredential({ userID: s.userID, nickname: s.nickname, deviceToken: s.deviceToken })
      set({ hasCredential: true })
      return s
    })
    // 新账号：主区先是欢迎页，打开任何会话就收起
    if (get().phase.kind === 'ready') useUI.getState().setWelcome(true)
  },

  async signInWithPassword(userID, password) {
    await connect(set, get, async () => {
      const s = await loginWithPassword(cfg, userID, password)
      await saveCredential({ userID: s.userID, nickname: s.nickname, deviceToken: s.deviceToken })
      set({ hasCredential: true })
      return s
    })
  },

  async setPassword(password, oldPassword) {
    const r = await api.setPassword(password, oldPassword)
    set({ hasPassword: r.has_password })
  },

  async signOut() {
    for (const u of unsubscribe) u()
    unsubscribe = []
    try { await im.logout() } catch { /* 已经断了也无妨 */ }
    // 交回作用域：之后还没结束的下载都不会再往这个账号的目录里写东西。
    // 缓存本身不删——规格定的是「退出登录保留，下次登录秒开」。
    await window.desktop.media.adopt(null, '')
    await clearCredential()
    timelines.clear()
    firstPage.clear()
    memberLoads.clear()
    useUI.getState().resetAll()
    set({ phase: { kind: 'signedOut' }, hasCredential: false, conversations: [], members: {}, me: '', myName: '', myBio: '', bios: {}, connected: false })
  },

  async open(id) {
    const agent = kindOf(id, get()) === 'agent_session'
    // 换会话走 View Transition：旧流淡出、头部的头像和标题滑过去（同一个会话就不折腾）
    if (useUI.getState().conversationId !== id) void transition(() => useUI.getState().open(id, { agent }))
    else useUI.getState().open(id, { agent })
    const c = get().conversations.find((x) => x.id === id)
    // 历史和成员之间没有依赖，一起发。原来是 await 完第一页历史才去拉成员，
    // 右栏的头像要等历史回来才开始下——在 2Mbps 的出口上这一等就是好几秒。
    if (c?.groupID && !get().members[c.groupID]?.length) void get().loadMembers(c.groupID)
    // 还没聊过的会话（从名册点开的 agent）在 SDK 里不存在，标已读会报错
    if (c) void im.markRead(id).then(() => refreshConversations(set, get)).catch(() => {})
    await get().ensure(id)
  },

  async ensure(id) {
    const t = timeline(id)
    if (t.status === 'idle' || t.status === 'failed') await loadPage(set, get, id, '')
  },

  async markRead(id) {
    try { await im.markRead(id); await refreshConversations(set, get) } catch { /* 标不上就等下次 */ }
  },

  async loadOlder(id) {
    const t = timeline(id)
    // 「正在翻」记在会话自己身上：A 的慢请求不该把 B 的历史一起卡住
    if (!t.hasMore || t.loadingOlder || !t.olderCursor) return
    // 上一轮用同一个游标什么也没拿到。别每滚一下就再问一遍同一个游标，但也不能
    // 永久封死——那可能只是 SDK 同步途中的一次空页，等一会儿再试就有了。
    if (t.stalledAt && t.stalledAt === t.olderCursor && Date.now() - t.stalledSince < STALL_COOLDOWN) return
    t.loadingOlder = true
    bump(set)
    try { await loadPage(set, get, id, t.olderCursor) } finally { t.loadingOlder = false; bump(set) }
  },

  // 发送即上屏。先让 SDK 把消息建出来——纯本地操作，clientMsgID 当场就定了——按这个 id 摆一条
  // 「发送中」。回显回来还是同一个 id，时间线原位换内容，行不卸载不重挂，入场动画只播一次。
  async send(id, text, opts) {
    const fallback = { text, attachments: [], quote: opts?.quote ?? null, token: opts?.draftToken }
    let created: MessageItem
    try {
      created = await composeText(get, id, text, opts)
    } catch (e) {
      set({ notice: `发送失败：${describe(e)}` })
      composerBus.restore(id, fallback)
      return
    }
    const local = pendingMessage(get, id, created, [], true)
    if (local) { timeline(id).upsert(local); bump(set) }
    try {
      const echo = await im.send(created, recipientOf(get, id))
      absorb(set, get, translator.messages([echo]), id)
    } catch (e) {
      if (local) { timeline(id).remove(local.id); bump(set) }
      set({ notice: `发送失败：${describe(e)}` })
      composerBus.restore(id, fallback)
    }
  },

  async sendRich(id, text, opts) {
    const hasText = !!text.trim()
    const fallback = { text, attachments: opts.attachments, quote: opts.quote ?? null, token: opts.draftToken }
    // 正文还是文本消息：服务端和别的端照旧读到文字和 @；附件在 ex 里。没打字就放个占位——
    // 占位只看附件的种类和名字，上传之前就能算出来，所以消息能在传之前先上屏且 id 不变。
    let created: MessageItem
    try {
      created = await composeText(get, id, hasText ? text : placeholderFor(opts.attachments), opts)
    } catch (e) {
      set({ notice: `发送失败：${describe(e)}` })
      composerBus.restore(id, fallback)
      return
    }
    const local = pendingMessage(get, id, created, opts.attachments, hasText)
    if (local) { timeline(id).upsert(local); bump(set) }
    try {
      // 地址回来了才能写进消息。三个一起传：串行发三张图要等三倍时间，全开又互相抢上行带宽。
      // 对象名带唯一前缀，同名文件不会互相覆盖；mapLimit 保证回来的顺序还是栏里的顺序。
      const uploaded: Attachment[] = await mapLimit(opts.attachments, 3, async (a) => {
        // 图片先压一遍再传（规则见 shared/prepare）：出口只有 260 KB/s，原文件直传的话一张
        // 5 MB 的图每个接收者要等 20 秒。消息里的宽高和字节数描述的是**传上去的那个文件**。
        const ready = a.kind === 'image' ? await window.desktop.files.prepare(a.path, 'attachment') : null
        // 缩略档和模糊占位一起产：消息流里显示的是缩略档，它到达之前显示的是那二三十个
        // 字节解出来的模糊图。生成不出来就都没有，接收端退回按需缩图和一块底色。
        const small = a.kind === 'image' ? await window.desktop.files.thumb(ready?.path ?? a.path) : null
        try {
          const ext = ready?.ext ?? a.name.split('.').pop() ?? ''
          // 视频的封面是单独的一个对象：接收端先画它，点了才去拉视频本体
          let poster: string | null = null
          if (a.kind === 'video' && a.posterPath) {
            poster = (await im.upload(a.posterPath, randomObjectName('jpg'), 'image/jpeg', 'attachment')).url
            if (a.preview) rememberPreview(poster, a.preview)
          }
          let thumb: string | null = null
          if (small) thumb = (await im.upload(small.thumb.path, randomObjectName('jpg'), 'image/jpeg', 'attachment')).url
          const { url } = await im.upload(ready?.path ?? a.path, randomObjectName(ext), ready?.mime ?? a.mime, 'attachment')
          // 勾了「原图」才多传一份原文件。这一份是纯粹的增量字节（好几 MB），所以只在
          // 明确要的时候传，接收端也只在点了「查看原图」时才下。
          let original: string | null = null
          if (a.wantOriginal && ready && !ready.original) {
            original = (await im.upload(a.path, randomObjectName(a.name.split('.').pop() ?? ''), a.mime, 'attachment')).url
          }
          // 垫底图按「这一屏实际会放进 img src 的那个地址」记，不是主图地址——不然自己刚
          // 发出去的图回显时查不到垫底图，会闪一下空白
          const shown = thumb ?? url
          rememberPreview(shown, a.preview)
          return {
            kind: a.kind, url, name: a.name,
            bytes: ready?.bytes ?? a.bytes,
            natural: ready && ready.width > 0 ? { width: ready.width, height: ready.height } : a.natural,
            mime: ready?.mime ?? a.mime, poster, duration: a.duration ?? null,
            thumb, blur: small?.blur ?? null,
            thumbSize: small ? { width: small.thumb.width, height: small.thumb.height } : null,
            original, originalBytes: original ? a.bytes : null,
          }
        } finally {
          if (ready && !ready.original) window.desktop.files.discard(ready.path)
          if (small) window.desktop.files.discard(small.thumb.path)
        }
      })
      created.ex = richEx(uploaded, hasText)
      const echo = await im.send(created, recipientOf(get, id))
      absorb(set, get, translator.messages([echo]), id)
    } catch (e) {
      if (local) { timeline(id).remove(local.id); bump(set) }
      set({ notice: `发送失败：${describe(e)}` })
      // 文字和文件原样回到输入框，人改一改再发，不用重新找文件
      composerBus.restore(id, fallback)
    }
  },

  async react(id, target, emoji) {
    const c = get().conversations.find((x) => x.id === id)
    const to = c?.groupID ? { groupID: c.groupID } : { userID: c?.peerID ?? peerFrom(id, get().me) }
    try {
      const created = await im.createCustom(reactionData(target, emoji), 'reaction')
      const echo = await im.send(created, to)
      // 自己发的回应只从这条回显里回来——SDK 不会把自己的消息再推给自己
      translator.messages([echo])
      applyReactionChanges(set, get)
    } catch (e) {
      set({ notice: `回应没发出去：${describe(e)}` })
    }
  },

  async revoke(id, target) {
    try {
      await im.revoke(id, target)
      timeline(id).remove(target)
      bump(set)
    } catch (e) {
      set({ notice: `撤回失败：${describe(e)}` })
    }
  },

  async refreshRoster() {
    const { base, token } = serverAuth()
    // 没登录（或凭据还没安好）就不要打这个请求：拿回来的是 401，白白盖掉一份好名册
    if (!token || !get().me) return
    if (rosterLoad) return rosterLoad
    const at = Date.now()
    // 焦点会连着来好几次（切窗口、点回来、Cmd-Tab），压一压
    if (at - rosterAt < ROSTER_COOLDOWN) return
    rosterAt = at
    rosterLoad = (async () => {
      try {
        const people = await roster({ ...cfg, server: base }, token)
        // 拉空多半是出了什么岔子，别拿它把现有名册清掉
        if (people.length === 0) return
        const before = new Set(get().roster.map((p) => p.userID))
        seatRoster(set, people)
        // 只给新面孔拉头像和签名：焦点每来一次就重拉全员是没必要的
        const fresh = people.filter((p) => !before.has(p.userID)).map((p) => p.userID)
        if (fresh.length) void loadAvatars(set, fresh)
      } catch {
        // 拉不到就还用旧的，这是个后台刷新，不该弹任何东西
      } finally {
        rosterLoad = null
      }
    })()
    return rosterLoad
  },

  async loadMembers(groupID) {
    // 同一个群同时只发一次：open()、同步完成事件和成员变动事件会一起要
    const running = memberLoads.get(groupID)
    if (running) return running
    const work = (async () => {
      // 200 人以上要接着翻。**每页拿到就交出去**：一页 200 人已经能画了，攒齐几页
      // 再一次性 set 的话，第一屏成员、头像和 @ 候选都得等最后一页——而 @ 候选严格
      // 依赖群成员，这个等待会直接卡住输入。后面哪一页失败，前面成功的也还在。
      const agents = new Set(agentsOf(get().roster).map((a) => a.userID))
      const toMember = (m: GroupMemberItem): Member => ({
        id: m.userID, name: m.nickname || m.userID, avatar: m.faceURL || null,
        role: m.roleLevel >= 100 ? 'owner' : m.roleLevel >= 60 ? 'admin' : 'member',
        isAgent: agents.has(m.userID),
        inviter: m.inviterUserID || null,
      })
      let got = 0
      try {
        for (let offset = 0; offset < MEMBER_CAP; offset += MEMBER_PAGE) {
          const batch = await im.members(groupID, offset, MEMBER_PAGE)
          const page = batch.map(toMember)
          got += page.length

          // 刚登录、同步还没完时 SDK 会先给一张空表。不要把这个空表当成「这个群没人」
          // 存下来：存了之后 open() 的存在性判断就跳过重拉，这个群的成员再也不会出现。
          // 真正补上它的是 OnSyncServerFinish，那里会重新叫一次。
          if (offset === 0 && page.length === 0 && get().members[groupID]) return

          set((s) => {
            // 第一页替换，后面的页往上接——这一轮的结果不该和上一轮的残留混在一起
            const base = offset === 0 ? [] : s.members[groupID] ?? []
            const seen = new Set(base.map((m) => m.id))
            const merged = [...base, ...page.filter((m) => !seen.has(m.id))]
            return { members: { ...s.members, [groupID]: merged }, avatars: mergeAvatars(s.avatars, page.map((m) => [m.id, m.avatar])) }
          })
          // 每页各拉各的头像，不攒到最后一次性甩几千个 ID 过去
          void loadAvatars(set, page.map((m) => m.id))

          if (batch.length < MEMBER_PAGE) break
        }
        if (got >= MEMBER_CAP) {
          // 到顶了就说一声。默默截断的话，名单看着是完整的，少掉的人既不显示也 @ 不到。
          set({ notice: `这个群超过 ${MEMBER_CAP} 人，只列出了前 ${MEMBER_CAP} 位` })
        }
      } catch (e) {
        // 已经交出去的页留着，只说这次没拉全
        set({ notice: `成员没拉全：${describe(e)}` })
      }
    })()
    memberLoads.set(groupID, work)
    void work.finally(() => memberLoads.delete(groupID))
    return work
  },

  dismissNotice: () => set({ notice: null }),

  // ---- 频道管理：都是 SDK 一句话，加上把列表和成员刷新 ----
  async createChannel(name, memberIDs) {
    const group = await im.createGroup(name, memberIDs)
    const id: ConversationId = `sg_${group.groupID}`
    await refreshConversations(set, get)
    await get().open(id)
    return id
  },
  async renameChannel(groupID, name) {
    await im.renameGroup(groupID, name)
    await refreshConversations(set, get)
  },
  async joinChannel(groupID) {
    await im.joinGroup(groupID)
    await refreshConversations(set, get)
    const id: ConversationId = `sg_${groupID}`
    await get().open(id)
    return id
  },

  async inviteToChannel(groupID, userIDs) {
    await im.invite(groupID, userIDs)
    await get().loadMembers(groupID)
  },
  async removeMember(groupID, member) {
    if (member.isAgent) await api.removeAgent(groupID, member.id)
    else await im.kickGroupMember(groupID, [member.id])
    // 先从手上这份里拿掉，界面立刻有反应；再向 SDK 要一次权威的
    set((s) => ({ members: { ...s.members, [groupID]: (s.members[groupID] ?? []).filter((m) => m.id !== member.id) } }))
    void get().loadMembers(groupID)
  },
  async leaveChannel(groupID) {
    await im.quitGroup(groupID)
    dropConversation(set, get, `sg_${groupID}`)
  },
  async dismissChannel(groupID) {
    await im.dismissGroup(groupID)
    dropConversation(set, get, `sg_${groupID}`)
  },

  // ---- 我自己 ----
  async updateNickname(nickname) {
    // 名册（yptd-server）是客户端读名字的地方，先改它；OpenIM 那边跟着改，慢一点无妨
    await api.rename(nickname)
    im.setSelf({ nickname }).catch(() => { /* 名册已改，这边迟到不算失败 */ })
    set((s) => ({ myName: nickname, roster: s.roster.map((p) => (p.userID === s.me ? { ...p, nickname } : p)) }))
    translator.setNames(Object.fromEntries(get().roster.map((p) => [p.userID, p.nickname])))
    bump(set)
  },
  async updateBio(bio) {
    const next = bio.trim().slice(0, 80)
    await im.setSelf({ ex: bioEx(next) })
    set((s) => ({ myBio: next, bios: { ...s.bios, [s.me]: next } }))
  },
  async updateAvatar(path) {
    // 裁成方形、压到 640（和 iOS 一致）。以前原图直传，线上最大的一个头像 2.36 MB；
    // 对象名也不再用裸文件名——那样地址猜得到，同名重传还会让各端缓存永久停在旧头像上。
    const ready = await window.desktop.files.prepare(path, 'avatar')
    if (!ready) throw new Error('这张图打不开，换一张试试')
    let url: string
    try {
      ({ url } = await im.upload(ready.path, `avatar-${randomObjectName(ready.ext)}`, ready.mime))
    } finally {
      window.desktop.files.discard(ready.path)
    }
    await im.setSelf({ faceURL: url })
    set((s) => ({ myAvatar: url, avatars: { ...s.avatars, [s.me]: url } }))
  },
  async markAllRead() {
    await im.markAllRead()
    await refreshConversations(set, get)
  },
}))

// 头像地址变了就告诉 Avatar 组件（它按 id 自己查，见 components/identity.ts）。
useSession.subscribe((s, prev) => { if (s.avatars !== prev.avatars) setFaces(s.avatars) })

function recipientOf(get: Get, id: ConversationId): { groupID?: string; userID?: string } {
  const c = get().conversations.find((x) => x.id === id)
  return c?.groupID ? { groupID: c.groupID } : { userID: c?.peerID ?? peerFrom(id, get().me) }
}

/** 建一条文本消息：有 @ 走 at 消息（引用塞在里面），只有引用走 quote 消息，否则纯文本 */
async function composeText(get: Get, id: ConversationId, text: string, opts?: { quote?: MessageId; mentions?: string[] }): Promise<MessageItem> {
  let quoted: MessageItem | undefined
  if (opts?.quote) {
    const found = await im.find(id, [opts.quote])
    // findMessageList 回的是 findResultItems，不是 searchResultItems（那是 searchLocalMessages 的）
    quoted = found.findResultItems?.[0]?.messageList?.[0]
  }
  if (opts?.mentions?.length) {
    const names = Object.fromEntries(get().roster.map((p) => [p.userID, p.nickname]))
    return im.createAt(text, opts.mentions, names, quoted)
  }
  if (quoted) return im.createQuote(text, quoted)
  return im.createText(text)
}

/**
 * 还没发出去的那条。id 用 SDK 创建时分配的 clientMsgID：回显回来是同一个 id，时间线原位替换，
 * React 和虚拟列表都认同一个 key，行不会被卸载重挂——量高缓存留着，入场动画也不会再播一遍。
 *
 * 正文、@、引用都让翻译层从建好的消息里读，跟真发出去的那条走同一条路径；只有会话 id 要覆盖，
 * 创建出来的消息还没有收件人。
 */
function pendingMessage(get: Get, conversation: ConversationId, created: MessageItem, attachments: OutgoingAttachment[], showText: boolean): Message | null {
  const base = translator.message(created)
  if (!base) return null
  const s = get()
  return {
    ...base,
    conversation,
    senderName: s.myName || base.senderName,
    senderAvatar: s.avatars[s.me] ?? s.myAvatar ?? base.senderAvatar,
    // 只有附件没打字：正文是给不认识 ex 的端看的占位，这端不显示
    body: showText ? base.body : { kind: 'text', text: '' },
    // 还没传完，先用本机缩略图顶着
    attachments: attachments.map((a) => ({ kind: a.kind, url: a.preview ?? '', name: a.name, bytes: a.bytes, natural: a.natural })),
  }
}

/** 一个会话没了（退群/解散）：列表里去掉，正看着它就退到空 */
function dropConversation(set: Set, get: Get, id: ConversationId): void {
  timelines.delete(id)
  set({ conversations: get().conversations.filter((c) => c.id !== id) })
  useUI.getState().forgetConversation(id)
  void refreshConversations(set, get)
}

// ---- 连接 ------------------------------------------------------------------------

type Set = (p: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void
type Get = () => SessionState

async function connect(set: Set, get: Get, authenticate: () => Promise<{ userID: string; nickname: string; imToken: string; deviceToken: string }>, knownToken?: string): Promise<void> {
  set({ phase: { kind: 'connecting', what: '正在登录…' } })
  try {
    const auth = await authenticate()
    const token = auth.deviceToken || knownToken || ''
    setServerAuth(cfg.server, token)
    translator = new Translator(auth.userID)

    // 花名册先于连接：它说明谁是 agent、谁叫什么，翻译历史时就要知道
    const people = await roster(cfg, token).catch(() => [] as Person[])
    seatRoster(set, people)
    // 记上时间：紧接着连上会发 OnConnectSuccess，那里也要拉一次，
    // 不占住的话开机这一下白拉两遍。
    rosterAt = Date.now()
    set({ me: auth.userID, myName: auth.nickname })
    // 媒体缓存归到这个账号名下。必须在拉名册和头像之前——晚了这一轮下来的图就落进
    // 上一个账号的目录里了。
    await window.desktop.media.adopt(auth.userID, cfg.api)

    set({ phase: { kind: 'connecting', what: '正在连接…' } })
    if (!(await im.loggedIn())) {
      await im.init(cfg, await window.desktop.dataDir())
      await im.login(auth.userID, auth.imToken)
    }
    // 登录成功就是连着的；之后掉线/重连由 SDK 事件改这个位
    set({ connected: true })
    translator.atAllTag = await im.atAllTag().catch(() => '')
    subscribe(set, get)
    set({ phase: { kind: 'ready' } })
    // 记住这个账号：退出后登录页默认停在密码那条路上，账号已经填好
    useUI.getState().rememberAccount(auth.userID)
    void api.me().then((m) => set({ hasPassword: m.has_password })).catch(() => { /* 拿不到就当没设过 */ })
    await refreshConversations(set, get)
    void loadAvatars(set, people.map((p) => p.userID))
  } catch (e) {
    // 错误码留给登录页：怪邀请码的退回第一步，怪名字的留在第二步
    set({ phase: { kind: 'failed', why: describe(e), code: e instanceof AuthError ? e.code : undefined } })
  }
}

function subscribe(set: Set, get: Get): void {
  for (const u of unsubscribe) u()
  const onMessages = (data: unknown): void => {
    const raws = Array.isArray(data) ? (data as MessageItem[]) : [data as MessageItem]
    absorb(set, get, translator.messages(raws))
    applyReactionChanges(set, get)
    void refreshConversations(set, get)
  }
  unsubscribe = [
    im.on(SdkEvent.OnRecvNewMessage, onMessages),
    im.on(SdkEvent.OnRecvNewMessages, onMessages),
    im.on(SdkEvent.OnRecvOfflineNewMessage, onMessages),
    im.on(SdkEvent.OnRecvOnlineOnlyMessage, onMessages),
    im.on(SdkEvent.OnNewRecvMessageRevoked, (d) => {
      const taken = d as { clientMsgID?: string }
      if (!taken.clientMsgID) return
      for (const t of timelines.values()) if (t.remove(taken.clientMsgID)) bump(set)
    }),
    im.on(SdkEvent.OnConnectSuccess, () => {
      set({ connected: true })
      // 断网期间注册的人，重连这一下是最自然的补拉时机
      void get().refreshRoster()
    }),
    im.on(SdkEvent.OnConnectFailed, () => set({ connected: false })),
    im.on(SdkEvent.OnKickedOffline, () => set({ connected: false, notice: '这个账号在别处登录了' })),
    im.on(SdkEvent.OnUserTokenExpired, () => set({ connected: false, notice: '登录过期了，重开一下 app' })),
    im.on(SdkEvent.OnSyncServerStart, () => set({ syncing: true })),
    im.on(SdkEvent.OnSyncServerFinish, () => {
      set({ syncing: false })
      // 同步完成＝SDK 的本地库刚变过。之前因为「同一个游标要来要去都是空」而封住的
      // 时间线，在这里解开重来一次：那可能只是同步途中的一次临时空页，封着不动的话
      // 这段历史就再也翻不动了。
      for (const t of timelines.values()) { t.stalledAt = null; t.stalledSince = 0 }
      void refreshConversations(set, get)
      // 刚登录时成员表可能还没同步下来，拉到的是空的；同步完了再拉一次正看着的群
      const current = useUI.getState().conversationId
      const c = current ? get().conversations.find((x) => x.id === current) : undefined
      if (c?.groupID && !get().members[c.groupID]?.length) void get().loadMembers(c.groupID)
      // 同步前拉到的第一页可能是本地库里的空页；同步完了、还是空的就再要一次
      if (current && timeline(current).length === 0 && timeline(current).status === 'ready') {
        timeline(current).status = 'idle'
        void get().ensure(current)
      }
    }),
    im.on(SdkEvent.OnSyncServerFailed, () => set({ syncing: false })),
    im.on(SdkEvent.OnConversationChanged, () => void refreshConversations(set, get)),
    im.on(SdkEvent.OnNewConversation, () => void refreshConversations(set, get)),
    im.on(SdkEvent.OnJoinedGroupAdded, () => void refreshConversations(set, get)),
    im.on(SdkEvent.OnJoinedGroupDeleted, () => void refreshConversations(set, get)),
    im.on(SdkEvent.OnGroupInfoChanged, () => void refreshConversations(set, get)),
    im.on(SdkEvent.OnGroupMemberAdded, (d) => { const g = (d as { groupID?: string }).groupID; if (g) void get().loadMembers(g) }),
    im.on(SdkEvent.OnGroupMemberDeleted, (d) => { const g = (d as { groupID?: string }).groupID; if (g) void get().loadMembers(g) }),
  ]
}

// ---- 数据流 -----------------------------------------------------------------------

/** 花名册刷新的节流与去重 */
let rosterLoad: Promise<void> | null = null
let rosterAt = 0
const ROSTER_COOLDOWN = 30_000

/**
 * 安置一份新花名册。翻译器、agent 配色和 store 得一起换：
 * 只 set(roster) 的话，新 agent 在消息里既没有身份色也不会被认成 agent。
 */
function seatRoster(set: Set, people: Person[]): void {
  translator.setAgents(agentsOf(people).map((p) => ({ userID: p.userID, nickname: p.nickname, tag: p.tag ?? 'AGENT', color: p.color })))
  translator.setNames(Object.fromEntries(people.map((p) => [p.userID, p.nickname])))
  setAgentColors(people.map((p) => [p.userID, p.color] as [string, string | null]))
  set({ roster: people })
}

async function loadAvatars(set: Set, userIDs: string[]): Promise<void> {
  if (userIDs.length === 0) return
  try {
    const list = await im.users(userIDs)
    set((s) => {
      const bios = { ...s.bios }
      for (const u of list) {
        const b = bioOf(u.ex)
        if (b) bios[u.userID] = b; else delete bios[u.userID]
      }
      const mine = list.find((u) => u.userID === s.me)
      return {
        avatars: mergeAvatars(s.avatars, list.map((u) => [u.userID, u.faceURL || null])),
        myAvatar: mine?.faceURL || s.myAvatar,
        myBio: mine ? bioOf(mine.ex) : s.myBio,
        bios,
      }
    })
  } catch { /* 头像拉不到就用消息里烤进去的那张 */ }
}

/** 签名在 OpenIM 用户的 ex 里。ex 是个公共字段，别的端也可能往里写东西，
 *  所以只认自己那把钥匙，认不出就当没有，绝不覆盖别人的内容。 */
const bioEx = (bio: string): string => JSON.stringify({ yptd: 'profile', bio })
function bioOf(ex: string | undefined): string {
  if (!ex) return ''
  try {
    const p = JSON.parse(ex) as { yptd?: string; bio?: unknown }
    return p.yptd === 'profile' && typeof p.bio === 'string' ? p.bio : ''
  } catch { return '' }
}

function mergeAvatars(cur: Record<string, string>, pairs: [string, string | null][]): Record<string, string> {
  let next = cur
  for (const [id, url] of pairs) {
    if (!url || cur[id] === url) continue
    if (next === cur) next = { ...cur }
    next[id] = url
  }
  return next
}

async function refreshConversations(set: Set, get: Get): Promise<void> {
  try {
    const raws = await im.conversations()
    const agents = new Set(agentsOf(get().roster).map((a) => a.userID))
    const me = get().me
    const list: Conversation[] = raws.map((c: ConversationItem) => {
      const isGroup = !!c.groupID
      const kind = isGroup ? 'channel' : agents.has(c.userID) ? 'agent_session' : 'dm'
      const latest = c.latestMsg ? safeParse(c.latestMsg) : null
      const preview = latest ? previewOf(latest) : ''
      return {
        id: c.conversationID,
        kind,
        renderMode: kind === 'agent_session' ? 'harness' : 'im',
        title: c.showName || (isGroup ? c.groupID : c.userID),
        avatar: c.faceURL || null,
        unread: c.unreadCount,
        mentioned: c.groupAtType > 0,
        pinned: c.isPinned,
        preview,
        lastAt: c.latestMsgSendTime,
        groupID: isGroup ? c.groupID : null,
        peerID: isGroup ? null : c.userID,
      }
    })
    void me
    // SDK 偶尔会把同一个会话给两遍（改过群名的群见过），按 id 去重，留最新的那条
    const byId = new Map<string, Conversation>()
    for (const c of list) {
      const had = byId.get(c.id)
      if (!had || c.lastAt >= had.lastAt) byId.set(c.id, c)
    }
    const unique = [...byId.values()]
    unique.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt)
    set({ conversations: unique })
  } catch (e) {
    set({ notice: `拉会话失败：${describe(e)}` })
  }
}

/** 正在路上的第一页，按会话记：open() 和消息流挂载会同时要，只发一次请求 */
const firstPage = new Map<ConversationId, Promise<void>>()

async function loadPage(set: Set, get: Get, id: ConversationId, before: string): Promise<void> {
  const t = timeline(id)
  if (!before) {
    const running = firstPage.get(id)
    if (running) return running
  }
  const work = (async () => {
    if (!before) { t.status = 'loading'; t.error = null; bump(set) }
    try {
      let cursor = before
      let added = 0
      // 这一轮有没有往更早处挪过。挪过就说明还有没读完的历史，哪怕一条都没显示出来。
      let moved = false
      // 整页可能全是回应、通知或认不出的自定义消息，过滤完一条不剩——那不代表没有历史了。
      // 边界和游标怎么定见 paging.step()，轮数有上限，不能为了凑一条消息一直转下去。
      for (let round = 0; round < SKIP_ROUNDS; round++) {
        const page = await im.history(id, cursor, PAGE)
        const raws = page.messageList ?? []
        const msgs = translator.messages(raws)
        if (cursor) t.prepend(msgs); else for (const m of msgs) t.upsert(m)
        added += msgs.length
        const next = step({ count: raws.length, shown: msgs.length, isEnd: !!page.isEnd, edge: oldestRaw(raws)?.clientMsgID || null }, cursor)
        t.hasMore = next.hasMore
        if (next.cursor) t.olderCursor = next.cursor
        if (!next.again) break
        moved = true
        cursor = next.cursor!
      }
      // 一条都没多的时候才需要标住，但要分清是哪一种「没多」：
      //   游标动过 —— 这一轮把 SKIP_ROUNDS 页全用在被过滤的消息上了，下一页还没问过，
      //               封住它等于把这段历史永久锁死（连着五页系统通知就会踩到）。
      //   游标没动 —— 同一个游标再问一遍还是这个结果，标住它，等它变了自然解开。
      t.stalledAt = before && added === 0 && !moved ? t.olderCursor : null
      t.stalledSince = t.stalledAt ? Date.now() : 0
      if (!before) t.status = 'ready'
      applyReactionChanges(set, get)
      bump(set)
    } catch (e) {
      // 第一页没到：消息流上画出来并给「重试」，别只弹一句就留一屏骨架
      if (!before) { t.status = 'failed'; t.error = describe(e); bump(set) }
      else set({ notice: `加载历史失败：${describe(e)}` })
    }
  })()
  if (!before) { firstPage.set(id, work); void work.finally(() => firstPage.delete(id)) }
  return work
}

function absorb(set: Set, get: Get, msgs: Message[], into?: ConversationId): void {
  let changed = false
  const current = useUI.getState().conversationId
  let seenHere = false
  for (const m of msgs) {
    const id = into ?? m.conversation
    // fresh=false 是「原位换掉了同一个 id」——发出去的那条回显就是这样，同样要重画（发送中 → 已发）
    const fresh = timeline(id).upsert(m)
    changed = true
    if (id === current) seenHere = true
    if (fresh && !into) maybeNotify(get, m)
  }
  if (changed) bump(set)
  // 正看着的会话来了新消息，顺手标已读——但窗口不在前台时不标，那是没看到
  if (seenHere && current && typeof document !== 'undefined' && document.hasFocus()) scheduleRead(set, get, current)
}

/** 窗口不在前台、有人 @ 我或私聊我：弹一条系统通知。只对现在到的消息，历史和离线补发不算。 */
const bootAt = Date.now()
function maybeNotify(get: Get, m: Message): void {
  if (typeof document === 'undefined' || typeof Notification === 'undefined') return
  if (!useUI.getState().notifications || document.hasFocus()) return
  if (m.sender === get().me || m.transient || m.sentAt < bootAt - 5_000) return
  const c = get().conversations.find((x) => x.id === m.conversation)
  const direct = m.conversation.startsWith('si_')
  if (!m.mentionsMe && !direct) return
  const title = direct ? m.senderName : `${m.senderName} 在 #${c?.title ?? '频道'}`
  const n = new Notification(title, { body: summarize(m).slice(0, 140), silent: false })
  n.onclick = () => { window.focus(); void get().open(m.conversation) }
}

let readTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRead(set: Set, get: Get, id: ConversationId): void {
  if (readTimer) clearTimeout(readTimer)
  readTimer = setTimeout(() => {
    readTimer = null
    im.markRead(id).then(() => refreshConversations(set, get)).catch(() => { /* 标不上就等下次 */ })
  }, 400)
}

function applyReactionChanges(set: Set, get: Get): void {
  const changes = translator.drainReactionChanges((id) => [...timelines.values()].some((t) => t.get(id)))
  if (changes.length === 0) return
  for (const { id, reactions } of changes) {
    for (const t of timelines.values()) t.edit(id, (m) => ({ ...m, reactions: reactions as Reaction[] }))
  }
  bump(set)
  void get
}

const bump = (set: Set): void => set((s) => ({ tick: s.tick + 1 }))

/** si_<a>_<b> 里不是我的那个。user id 自己可能带下划线，所以按"我"在头还是在尾切，不按下划线拆。 */
export function peerFrom(conversationId: string, me: string): string {
  if (!conversationId.startsWith('si_')) return ''
  const rest = conversationId.slice(3)
  if (me && rest.startsWith(`${me}_`)) return rest.slice(me.length + 1)
  if (me && rest.endsWith(`_${me}`)) return rest.slice(0, -(me.length + 1))
  return rest.split('_').find((p) => p !== me) ?? ''
}

/** 会话种类。会话列表里没有的（比如从名册直接点开一个 agent）按 id 和名册推。 */
export function kindOf(id: ConversationId, s: Pick<SessionState, 'conversations' | 'roster' | 'me'>): ConversationKind {
  const c = s.conversations.find((x) => x.id === id)
  if (c) return c.kind
  if (id.startsWith('sg_')) return 'channel'
  const peer = peerFrom(id, s.me)
  return s.roster.find((p) => p.userID === peer)?.isAgent ? 'agent_session' : 'dm'
}

function previewOf(latest: MessageItem): string {
  const m = translator.message(latest)
  if (!m) return ''
  return summarize(m).replace(/\s*\n\s*/g, ' ').slice(0, 80)
}

function safeParse(s: string): MessageItem | null {
  try { return JSON.parse(s) as MessageItem } catch { return null }
}

export function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  // SDK 抛的常是 { errCode, errMsg } 这样的普通对象，别让它显示成 [object Object]
  if (e && typeof e === 'object') {
    const o = e as { errMsg?: string; message?: string; errCode?: number }
    const msg = o.errMsg || o.message
    // OpenIM 每包一层就粘一次错误码和正文，到这儿已经是重复三遍的一句话
    if (msg) return tidyError(msg, o.errCode)
    return o.errCode !== undefined ? `错误 ${o.errCode}` : JSON.stringify(e)
  }
  return String(e)
}

export { directId }
