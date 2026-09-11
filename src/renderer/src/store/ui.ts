import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme } from '../../../shared/ipc'

/**
 * 区段（section）与会话（conversation）是两个独立的字段——设计稿踩过的坑：
 * 从私聊列表打开一个 agent 会话时，如果区段是从会话 id 反推的，
 * 整个侧栏会被换成 agent 列表。图标栏高亮和侧栏内容读 section，
 * 主区内容读 conversationId。
 */
export type Section = 'inbox' | 'chat' | 'agent' | 'vm' | 'lib' | 'market' | 'set'

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
  inspectorTab: string | null

  setTheme(theme: Theme): void
  toggleTheme(): void
  go(section: Section): void
  open(conversationId: string, opts?: { section?: Section }): void
  setInspectorOpen(open: boolean): void
  setInspectorWidth(width: number): void
  pushInspectorTab(conversationId: string, tab: string): void
  closeInspectorTab(conversationId: string, tab: string): void
  setInspectorTab(tab: string | null): void
}

export const INSPECTOR_MIN = 300
export const INSPECTOR_MAX = 700
export const INSPECTOR_DEFAULT = 372

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
      inspectorTab: null,

      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

      go: (section) => {
        const s = get()
        if (section === 'chat' && s.lastChannelId) {
          set({ section, conversationId: s.lastChannelId })
        } else {
          set({ section })
        }
      },

      open: (conversationId, opts) => {
        const isAgent = conversationId.startsWith('ag:')
        set((s) => ({
          conversationId,
          section: opts?.section ?? s.section,
          lastChannelId: isAgent ? s.lastChannelId : conversationId,
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
    }),
    {
      name: 'yptd.ui',
      partialize: (s) => ({
        theme: s.theme,
        inspectorOpen: s.inspectorOpen,
        inspectorWidth: s.inspectorWidth,
        lastChannelId: s.lastChannelId,
      }),
    },
  ),
)

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}
