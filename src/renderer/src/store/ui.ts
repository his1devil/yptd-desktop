import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Theme } from '../../../shared/ipc'
import { transition } from '../motion/transition'

/**
 * 区段（section）与会话（conversation）是两个独立的字段——设计稿踩过的坑：
 * 从私聊列表打开一个 agent 会话时，如果区段是从会话 id 反推的，
 * 整个侧栏会被换成 agent 列表。图标栏高亮和侧栏内容读 section，
 * 主区内容读 conversationId。
 */
export type Section = 'inbox' | 'chat' | 'vm' | 'lib' | 'market' | 'set'
export type SettingsPage = 'profile' | 'privacy' | 'members' | 'notify' | 'appearance' | 'keys' | 'about'
export type InboxFilter = 'all' | 'mention' | 'agent'
/** 正开着的模态卡 */
export type DialogState =
  | { kind: 'newChannel' }
  | { kind: 'invite'; groupID: string }
  | { kind: 'rename'; groupID: string; current: string }
  | { kind: 'leave'; groupID: string; owner: boolean; title: string }

interface UIState {
  theme: Theme
  section: Section
  conversationId: string | null
  /** 最后一个非 agent 会话，点图标栏「会话」时恢复它，不是硬编码回默认频道 */
  lastChannelId: string | null
  inspectorOpen: boolean
  /** 300–700，持久化 */
  inspectorWidth: number
  /** 右侧栏页签，按会话键存。全局存会让 A 频道的「回测」出现在 B 会话里 */
  inspectorTabsBy: Record<string, string[]>
  /** 侧栏里收起来的分组（收件箱 / 频道 / 私聊 / AGENTS），按 id 记，跨重启保留 */
  collapsed: Record<string, boolean>
  /** 整条侧栏展开着没有。收起时红绿灯下面就是主区，主区头部要自己让出那 72px */
  sidebarOpen: boolean
  inspectorTab: string | null
  /** 输入框正在引用的消息，按会话键存——切走再切回来引用还在 */
  quoteBy: Record<string, string | null>
  dialog: DialogState | null
  paletteOpen: boolean
  settingsPage: SettingsPage
  inboxFilter: InboxFilter
  /** 桌面通知开关，持久化 */
  notifications: boolean
  /** 搜索结果要跳到的那条消息；消息流看到它在时间线里就滚过去并清掉 */
  jumpTo: { conversationId: string; messageId: string } | null
  /** 新账号第一次进来：主区先放欢迎页。打开任何会话或点「先逛逛」就收起；持久化，没收起前重启还在 */
  welcome: boolean
  /** 上次登录成功的账号名。退出后登录页默认走密码那条路并填好它；不是秘密，明文存 */
  lastUserID: string | null

  /** `origin` 是点击位置：给了就从那里圆形揭示出新主题，没给就直接切 */
  setTheme(theme: Theme, origin?: { x: number; y: number }): void
  toggleTheme(origin?: { x: number; y: number }): void
  go(section: Section): void
  toggleGroup(id: string): void
  setSidebarOpen(open: boolean): void
  /** `agent` 说明这是和单个 agent 的会话：它不会成为「最后一个非 agent 会话」。会话 id 本身看不出这一点，由调用方从会话种类判断。 */
  open(conversationId: string, opts?: { section?: Section; agent?: boolean }): void
  setInspectorOpen(open: boolean): void
  setInspectorWidth(width: number): void
  pushInspectorTab(conversationId: string, tab: string): void
  closeInspectorTab(conversationId: string, tab: string): void
  setInspectorTab(tab: string | null): void
  setQuote(conversationId: string, messageId: string | null): void
  openDialog(dialog: DialogState): void
  closeDialog(): void
  setPalette(open: boolean): void
  setSettingsPage(page: SettingsPage): void
  setInboxFilter(filter: InboxFilter): void
  setNotifications(on: boolean): void
  setJumpTo(target: { conversationId: string; messageId: string } | null): void
  /** 离开/解散了一个频道：正看着它就退到空 */
  forgetConversation(conversationId: string): void
  setWelcome(on: boolean): void
  rememberAccount(userID: string): void
  /** 设置里「再看一遍」：回到会话区、主区清空、放欢迎页 */
  showWelcome(): void
  /** 退出登录：上个账号留下的位置、引用、页签都不该带给下一个 */
  resetAll(): void
}

export const INSPECTOR_MIN = 240
export const INSPECTOR_MAX = 700
/** 主聊天区优先：1119 宽的窗口里留给它 591px */
export const INSPECTOR_DEFAULT = 260

const clampWidth = (w: number): number => Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(w)))

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      section: 'chat',
      conversationId: null,
      lastChannelId: null,
      inspectorOpen: true,
      inspectorWidth: INSPECTOR_DEFAULT,
      inspectorTabsBy: {},
      collapsed: {},
      sidebarOpen: true,
      inspectorTab: null,
      quoteBy: {},
      dialog: null,
      paletteOpen: false,
      settingsPage: 'profile',
      inboxFilter: 'all',
      notifications: true,
      jumpTo: null,
      welcome: false,
      lastUserID: null,

      setTheme: (theme, origin) => {
        applyTheme(theme, origin)
        set({ theme })
      },
      toggleTheme: (origin) => get().setTheme(get().theme === 'dark' ? 'light' : 'dark', origin),

      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      toggleGroup: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),

      go: (section) => {
        const s = get()
        if (section === 'chat' && s.lastChannelId) {
          set({ section, conversationId: s.lastChannelId })
        } else {
          set({ section })
        }
      },

      open: (conversationId, opts) => {
        const isAgent = opts?.agent ?? false
        set((s) => ({
          conversationId,
          // 会话列表现在常驻侧栏，从收件箱或设置里点一条就得把主区切回会话，
          // 否则主区还是设置页，点了像没反应
          section: opts?.section ?? 'chat',
          lastChannelId: isAgent ? s.lastChannelId : conversationId,
          welcome: false,
        }))
      },

      setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
      setInspectorWidth: (width) => set({ inspectorWidth: clampWidth(width) }),

      pushInspectorTab: (conversationId, tab) =>
        set((s) => {
          const tabs = s.inspectorTabsBy[conversationId] ?? []
          return {
            inspectorTabsBy: {
              ...s.inspectorTabsBy,
              [conversationId]: tabs.includes(tab) ? tabs : [...tabs, tab],
            },
            inspectorTab: tab,
            inspectorOpen: true,
          }
        }),
      closeInspectorTab: (conversationId, tab) =>
        set((s) => {
          const tabs = (s.inspectorTabsBy[conversationId] ?? []).filter((t) => t !== tab)
          return {
            inspectorTabsBy: { ...s.inspectorTabsBy, [conversationId]: tabs },
            inspectorTab: s.inspectorTab === tab ? (tabs[0] ?? null) : s.inspectorTab,
          }
        }),
      setInspectorTab: (inspectorTab) => set({ inspectorTab }),
      setQuote: (conversationId, messageId) =>
        set((s) => ({ quoteBy: { ...s.quoteBy, [conversationId]: messageId } })),
      openDialog: (dialog) => set({ dialog }),
      closeDialog: () => set({ dialog: null }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setSettingsPage: (settingsPage) => set({ settingsPage, section: 'set' }),
      setInboxFilter: (inboxFilter) => set({ inboxFilter }),
      setNotifications: (notifications) => set({ notifications }),
      setJumpTo: (jumpTo) => set({ jumpTo }),
      forgetConversation: (conversationId) =>
        set((s) => ({
          conversationId: s.conversationId === conversationId ? null : s.conversationId,
          lastChannelId: s.lastChannelId === conversationId ? null : s.lastChannelId,
        })),
      setWelcome: (welcome) => set({ welcome }),
      rememberAccount: (lastUserID) => set({ lastUserID }),
      showWelcome: () => set({ welcome: true, section: 'chat', conversationId: null }),
      // 退出登录时清掉上个账号留下的位置和状态，但保留 lastUserID——那正是下次登录要填的
      resetAll: () => set({
        section: 'chat', conversationId: null, lastChannelId: null, inspectorTabsBy: {}, inspectorTab: null,
        quoteBy: {}, dialog: null, paletteOpen: false, jumpTo: null, welcome: false,
      }),
    }),
    {
      name: 'yptd.ui',
      // 右栏默认宽度改过两次（372 → 300 → 260）。宽度是持久化的，不迁移老用户永远停在旧值；
      // 只动那些还停在旧默认值、或者正卡在旧下限上的——停在旧下限说明人想要更窄但拖不动了，
      // 那不是一个「选择」。真正自己拖到中间某个数的不碰。
      version: 4,
      migrate: (state) => {
        const s = state as Partial<UIState>
        const stale = [372, 300, 280]
        if (s.inspectorWidth !== undefined && stale.includes(s.inspectorWidth)) {
          return { ...s, inspectorWidth: INSPECTOR_DEFAULT }
        }
        return s
      },
      // 测试在 node 里跑，没有 localStorage；给一个什么都不存的后备，
      // 免得每次 set 都刷一行 "storage is currently unavailable"
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      ),
      partialize: (s) => ({
        theme: s.theme,
        inspectorOpen: s.inspectorOpen,
        inspectorWidth: s.inspectorWidth,
        lastChannelId: s.lastChannelId,
        conversationId: s.conversationId,
        section: s.section,
        collapsed: s.collapsed,
        sidebarOpen: s.sidebarOpen,
        notifications: s.notifications,
        welcome: s.welcome,
        lastUserID: s.lastUserID,
      }),
    },
  ),
)

export function applyTheme(theme: Theme, origin?: { x: number; y: number }): void {
  // 测试在 node 里跑，没有 document
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const apply = (): void => root.setAttribute('data-theme', theme)
  if (!origin || root.getAttribute('data-theme') === theme) { apply(); return }
  // 从点击处圆形揭示（tokens.css 的 theme 类型过渡）；揭示期间各处的底色过渡先关掉
  root.style.setProperty('--tx', `${origin.x}px`)
  root.style.setProperty('--ty', `${origin.y}px`)
  root.setAttribute('data-theming', '')
  void transition(apply, 'theme').finally(() => root.removeAttribute('data-theming'))
}
