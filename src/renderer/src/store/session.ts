import { create } from 'zustand'
import type { Conversation, ConversationId, ConversationKind, Member, Message, MessageId, Person, Reaction } from '../../../shared/model'
import { plainText } from '../../../shared/model'
import { DEFAULT_SERVER, clearCredential, loadCredential, login, register, roster, saveCredential, AuthError, type ServerConfig } from '../im/auth'
import { im, SdkEvent, type ConversationItem, type GroupMemberItem, type MessageItem } from '../im/client'
import { Translator, directId, reactionData } from '../im/translate'
import { Timeline } from '../im/timeline'
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
  | { kind: 'failed'; why: string }

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
  loadOlder(id: ConversationId): Promise<void>
  send(id: ConversationId, text: string, opts?: { quote?: MessageId; mentions?: string[] }): Promise<void>
  sendPicture(id: ConversationId, path: string): Promise<void>
  sendFile(id: ConversationId, path: string, name: string): Promise<void>
  react(id: ConversationId, target: MessageId, emoji: string): Promise<void>
  revoke(id: ConversationId, target: MessageId): Promise<void>
  loadMembers(groupID: string): Promise<void>
  dismissNotice(): void
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
  },

  async signOut() {
    for (const u of unsubscribe) u()
    unsubscribe = []
    try { await im.logout() } catch { /* 已经断了也无妨 */ }
    await clearCredential()
    timelines.clear()
    set({ phase: { kind: 'signedOut' }, hasCredential: false, conversations: [], members: {}, me: '', myName: '', connected: false })
  },

  async open(id) {
    useUI.getState().open(id, { agent: kindOf(id, get()) === 'agent_session' })
    const t = timeline(id)
    if (t.length === 0) await loadPage(set, get, id, '')
    void im.markRead(id).then(() => refreshConversations(set, get))
    const c = get().conversations.find((x) => x.id === id)
    if (c?.groupID && !get().members[c.groupID]) void get().loadMembers(c.groupID)
  },

  async loadOlder(id) {
    const t = timeline(id)
    if (!t.hasMore || get().loadingOlder || !t.oldest) return
    set({ loadingOlder: true })
    try { await loadPage(set, get, id, t.oldest.id) } finally { set({ loadingOlder: false }) }
  },

  async send(id, text, opts) {
    const c = get().conversations.find((x) => x.id === id)
    const to = c?.groupID ? { groupID: c.groupID } : { userID: c?.peerID ?? peerFrom(id, get().me) }
    try {
      let quoted: MessageItem | undefined
      if (opts?.quote) {
        const found = await im.find(id, [opts.quote])
        // findMessageList 回的是 findResultItems，不是 searchResultItems（那是 searchLocalMessages 的）
        quoted = found.findResultItems?.[0]?.messageList?.[0]
      }
      let created: MessageItem
      if (opts?.mentions?.length) {
        const names = Object.fromEntries(get().roster.map((p) => [p.userID, p.nickname]))
        created = await im.createAt(text, opts.mentions, names, quoted)
      } else if (quoted) {
        created = await im.createQuote(text, quoted)
      } else {
        created = await im.createText(text)
      }
      const echo = await im.send(created, to)
      absorb(set, get, translator.messages([echo]), id)
    } catch (e) {
      set({ notice: `发送失败：${describe(e)}` })
    }
  },

  async sendPicture(id, path) {
    const c = get().conversations.find((x) => x.id === id)
    const to = c?.groupID ? { groupID: c.groupID } : { userID: c?.peerID ?? peerFrom(id, get().me) }
    try {
      const created = await im.createImage(path)
      if (!created) throw new Error('这个文件建不出图片消息')
      const echo = await im.send(created, to)
      absorb(set, get, translator.messages([echo]), id)
    } catch (e) {
      set({ notice: `图片没发出去：${describe(e)}` })
    }
  },

  async sendFile(id, path, name) {
    const c = get().conversations.find((x) => x.id === id)
    const to = c?.groupID ? { groupID: c.groupID } : { userID: c?.peerID ?? peerFrom(id, get().me) }
    try {
      const created = await im.createFile(path, name)
      const echo = await im.send(created, to)
      absorb(set, get, translator.messages([echo]), id)
    } catch (e) {
      set({ notice: `文件没发出去：${describe(e)}` })
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
      const list = await im.members(groupID)
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
}))

// ---- 连接 ------------------------------------------------------------------------

type Set = (p: Partial<SessionState> | ((s: SessionState) => Partial<SessionState>)) => void
type Get = () => SessionState

async function connect(set: Set, get: Get, authenticate: () => Promise<{ userID: string; nickname: string; imToken: string; deviceToken: string }>, knownToken?: string): Promise<void> {
  set({ phase: { kind: 'connecting', what: '正在登录…' } })
  try {
    const auth = await authenticate()
    const token = auth.deviceToken || knownToken || ''
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
    translator.atAllTag = await im.atAllTag().catch(() => '')
    subscribe(set, get)
    set({ phase: { kind: 'ready' } })
    await refreshConversations(set, get)
    void loadAvatars(set, people.map((p) => p.userID))
  } catch (e) {
    set({ phase: { kind: 'failed', why: describe(e) } })
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
    im.on(SdkEvent.OnSyncServerFinish, () => { set({ syncing: false }); void refreshConversations(set, get) }),
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

async function loadPage(set: Set, get: Get, id: ConversationId, before: string): Promise<void> {
  try {
    const page = await im.history(id, before, PAGE)
    const msgs = translator.messages(page.messageList ?? [])
    const t = timeline(id)
    if (before) t.prepend(msgs); else for (const m of msgs) t.upsert(m)
    t.hasMore = !page.isEnd && msgs.length > 0
    applyReactionChanges(set, get)
    bump(set)
  } catch (e) {
    set({ notice: `加载历史失败：${describe(e)}` })
  }
}

function absorb(set: Set, get: Get, msgs: Message[], into?: ConversationId): void {
  let changed = false
  const current = useUI.getState().conversationId
  let seenHere = false
  for (const m of msgs) {
    const id = into ?? m.conversation
    if (timeline(id).upsert(m)) changed = true
    if (id === current) seenHere = true
  }
  if (changed) bump(set)
  // 正看着的会话来了新消息，顺手标已读——但窗口不在前台时不标，那是没看到
  if (seenHere && current && typeof document !== 'undefined' && document.hasFocus()) scheduleRead(set, get, current)
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
  return plainText(m.body).replace(/\s*\n\s*/g, ' ').slice(0, 80)
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
