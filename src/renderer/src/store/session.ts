import { create } from 'zustand'
import type { Attachment, Conversation, ConversationId, ConversationKind, Member, Message, MessageId, OutgoingAttachment, Person, Reaction } from '../../../shared/model'
import { summarize } from '../../../shared/model'
import { DEFAULT_SERVER, clearCredential, loadCredential, login, register, roster, saveCredential, setServerAuth, AuthError, type ServerConfig } from '../im/auth'
import { api } from '../im/api'
import { im, SdkEvent, type ConversationItem, type GroupMemberItem, type MessageItem } from '../im/client'
import { Translator, directId, placeholderFor, reactionData, richEx } from '../im/translate'
import { Timeline } from '../im/timeline'
import { mimeOf, objectName, rememberPreview } from '../im/files'
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
  me: string
  myName: string
  myAvatar: string | null
  connected: boolean
  syncing: boolean
  roster: Person[]
  /** 每个人当前的头像。OpenIM 把发送时的头像烤进每条消息，换了头像旧消息还是旧图，渲染时用这张表覆盖 */
  avatars: Record<string, string>
  conversations: Conversation[]
  members: Record<string, Member[]>
  /** 时间线变过就 +1；具体内容从 timelines() 取 */
  tick: number
  loadingOlder: boolean
  notice: string | null

  boot(): Promise<void>
  register(invite: string, nickname: string): Promise<void>
  signOut(): Promise<void>
  open(id: ConversationId): Promise<void>
  /** 把一个会话标成已读（快捷键用）；正看着的会话平时由消息流自己标 */
  markRead(id: ConversationId): Promise<void>
  /** 第一页还没到（或上次没到）就去拉；到过了什么都不做。消息流挂上来时调，重启后恢复的会话靠它加载。 */
  ensure(id: ConversationId): Promise<void>
  loadOlder(id: ConversationId): Promise<void>
  send(id: ConversationId, text: string, opts?: { quote?: MessageId; mentions?: string[] }): Promise<void>
  /** 文字和附件一条消息：先在时间线上摆一条「发送中」，传完文件、发出去后换成服务端回显 */
  sendRich(id: ConversationId, text: string, opts: { quote?: MessageId; mentions?: string[]; attachments: OutgoingAttachment[] }): Promise<void>
  react(id: ConversationId, target: MessageId, emoji: string): Promise<void>
  revoke(id: ConversationId, target: MessageId): Promise<void>
  loadMembers(groupID: string): Promise<void>
  dismissNotice(): void

  createChannel(name: string, memberIDs: string[]): Promise<ConversationId>
  renameChannel(groupID: string, name: string): Promise<void>
  inviteToChannel(groupID: string, userIDs: string[]): Promise<void>
  leaveChannel(groupID: string): Promise<void>
  dismissChannel(groupID: string): Promise<void>
  updateNickname(nickname: string): Promise<void>
  updateAvatar(path: string): Promise<void>
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

export const useSession = create<SessionState>()((set, get) => ({
  phase: { kind: 'booting' },
  hasCredential: false,
  me: '', myName: '', myAvatar: null,
  connected: false, syncing: false,
  roster: [], avatars: {}, conversations: [], members: {},
  tick: 0, loadingOlder: false, notice: null,

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

  async register(invite, nickname) {
    await connect(set, get, async () => {
      const s = await register(cfg, invite, nickname)
      await saveCredential({ userID: s.userID, nickname: s.nickname, deviceToken: s.deviceToken })
      set({ hasCredential: true })
      return s
    })
    // 新账号：主区先是欢迎页，打开任何会话就收起
    if (get().phase.kind === 'ready') useUI.getState().setWelcome(true)
  },

  async signOut() {
    for (const u of unsubscribe) u()
    unsubscribe = []
    try { await im.logout() } catch { /* 已经断了也无妨 */ }
    await clearCredential()
    timelines.clear()
    firstPage.clear()
    useUI.getState().resetAll()
    set({ phase: { kind: 'signedOut' }, hasCredential: false, conversations: [], members: {}, me: '', myName: '', connected: false })
  },

  async open(id) {
    const agent = kindOf(id, get()) === 'agent_session'
    // 换会话走 View Transition：旧流淡出、头部的头像和标题滑过去（同一个会话就不折腾）
    if (useUI.getState().conversationId !== id) void transition(() => useUI.getState().open(id, { agent }))
    else useUI.getState().open(id, { agent })
    await get().ensure(id)
    const c = get().conversations.find((x) => x.id === id)
    // 还没聊过的会话（从名册点开的 agent）在 SDK 里不存在，标已读会报错
    if (c) void im.markRead(id).then(() => refreshConversations(set, get)).catch(() => {})
    if (c?.groupID && !get().members[c.groupID]) void get().loadMembers(c.groupID)
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
    if (!t.hasMore || get().loadingOlder || !t.oldest) return
    set({ loadingOlder: true })
    try { await loadPage(set, get, id, t.oldest.id) } finally { set({ loadingOlder: false }) }
  },

  // 发送即上屏。先让 SDK 把消息建出来——纯本地操作，clientMsgID 当场就定了——按这个 id 摆一条
  // 「发送中」。回显回来还是同一个 id，时间线原位换内容，行不卸载不重挂，入场动画只播一次。
  async send(id, text, opts) {
    const fallback = { text, attachments: [], quote: opts?.quote ?? null }
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
    const fallback = { text, attachments: opts.attachments, quote: opts.quote ?? null }
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
      // 逐个传：地址回来了才能写进消息；对象名带唯一前缀，同名文件不会互相覆盖
      const uploaded: Attachment[] = []
      for (const a of opts.attachments) {
        const { url } = await im.upload(a.path, objectName(a.name), a.mime, 'attachment')
        rememberPreview(url, a.preview)
        uploaded.push({ kind: a.kind, url, name: a.name, bytes: a.bytes, natural: a.natural })
      }
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

  async loadMembers(groupID) {
    try {
      let list = await im.members(groupID)
      // 刚登录同步没完，SDK 会先给一个空表；等一下再要一次
      if (list.length === 0) {
        await new Promise((r) => setTimeout(r, 1500))
        list = await im.members(groupID)
      }
      const agents = new Set(agentsOf(get().roster).map((a) => a.userID))
      const members: Member[] = list.map((m: GroupMemberItem) => ({
        id: m.userID, name: m.nickname || m.userID, avatar: m.faceURL || null,
        role: m.roleLevel >= 100 ? 'owner' : m.roleLevel >= 60 ? 'admin' : 'member',
        isAgent: agents.has(m.userID),
      }))
      set((s) => ({ members: { ...s.members, [groupID]: members }, avatars: mergeAvatars(s.avatars, members.map((m) => [m.id, m.avatar])) }))
    } catch (e) {
      set({ notice: `拉成员失败：${describe(e)}` })
    }
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
  async inviteToChannel(groupID, userIDs) {
    await im.invite(groupID, userIDs)
    await get().loadMembers(groupID)
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
  async updateAvatar(path) {
    const name = path.split('/').pop() ?? 'avatar.png'
    const { url } = await im.upload(path, name)
    await im.setSelf({ faceURL: url })
    set((s) => ({ myAvatar: url, avatars: { ...s.avatars, [s.me]: url } }))
  },
  async markAllRead() {
    await im.markAllRead()
    await refreshConversations(set, get)
  },
}))

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
    translator.setAgents(agentsOf(people).map((p) => ({ userID: p.userID, nickname: p.nickname, tag: p.tag ?? 'AGENT', color: p.color })))
    translator.setNames(Object.fromEntries(people.map((p) => [p.userID, p.nickname])))
    set({ me: auth.userID, myName: auth.nickname, roster: people })

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
    im.on(SdkEvent.OnConnectSuccess, () => set({ connected: true })),
    im.on(SdkEvent.OnConnectFailed, () => set({ connected: false })),
    im.on(SdkEvent.OnKickedOffline, () => set({ connected: false, notice: '这个账号在别处登录了' })),
    im.on(SdkEvent.OnUserTokenExpired, () => set({ connected: false, notice: '登录过期了，重开一下 app' })),
    im.on(SdkEvent.OnSyncServerStart, () => set({ syncing: true })),
    im.on(SdkEvent.OnSyncServerFinish, () => {
      set({ syncing: false })
      void refreshConversations(set, get)
      // 刚登录时成员表可能还没同步下来，拉到的是空的；同步完了再拉一次正看着的群
      const current = useUI.getState().conversationId
      const c = current ? get().conversations.find((x) => x.id === current) : undefined
      if (c?.groupID) void get().loadMembers(c.groupID)
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

async function loadAvatars(set: Set, userIDs: string[]): Promise<void> {
  if (userIDs.length === 0) return
  try {
    const list = await im.users(userIDs)
    set((s) => ({
      avatars: mergeAvatars(s.avatars, list.map((u) => [u.userID, u.faceURL || null])),
      myAvatar: list.find((u) => u.userID === s.me)?.faceURL || s.myAvatar,
    }))
  } catch { /* 头像拉不到就用消息里烤进去的那张 */ }
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
      const page = await im.history(id, before, PAGE)
      const msgs = translator.messages(page.messageList ?? [])
      if (before) t.prepend(msgs); else for (const m of msgs) t.upsert(m)
      t.hasMore = !page.isEnd && msgs.length > 0
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
    return o.errMsg || o.message || (o.errCode !== undefined ? `错误 ${o.errCode}` : JSON.stringify(e))
  }
  return String(e)
}

export { directId }
