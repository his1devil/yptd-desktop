import { beforeEach, describe, expect, it } from 'vitest'
import { INSPECTOR_MAX, INSPECTOR_MIN, useUI } from './ui'

/**
 * M1 的验收条件，直接写成测试。这两条是设计稿踩过的真 bug：
 * 区段从会话 id 反推、右侧栏页签全局存。
 */
beforeEach(() => {
  useUI.setState({
    section: 'chat',
    conversationId: 'ch:eng',
    lastChannelId: 'ch:eng',
    inspectorTabsBy: {},
    inspectorTab: null,
    inspectorOpen: true,
  })
})

describe('区段与会话解耦', () => {
  it('从私聊列表打开 agent 会话，侧栏仍是频道列表', () => {
    useUI.getState().open('ag:triage', { section: 'chat', agent: true })
    const s = useUI.getState()
    expect(s.conversationId).toBe('ag:triage')
    expect(s.section).toBe('chat')
  })

  it('从 Agent 区 SESSIONS 打开同一个会话，侧栏是 agent 列表', () => {
    useUI.getState().open('ag:triage', { section: 'agent', agent: true })
    expect(useUI.getState().section).toBe('agent')
  })

  it('点「会话」回到之前的频道，不是硬编码回默认频道', () => {
    useUI.getState().open('ch:mkt')
    useUI.getState().open('ag:triage', { section: 'agent', agent: true })
    useUI.getState().go('chat')
    const s = useUI.getState()
    expect(s.section).toBe('chat')
    expect(s.conversationId).toBe('ch:mkt')
  })

  it('从收件箱或设置里打开会话，回到会话区；在 Agent 区打开则留在 Agent 区', () => {
    useUI.getState().go('inbox')
    useUI.getState().open('ch:mkt')
    expect(useUI.getState().section).toBe('chat')
    useUI.getState().go('set')
    useUI.getState().open('ag:triage', { agent: true })
    expect(useUI.getState().section).toBe('chat')
    useUI.getState().go('agent')
    useUI.getState().open('ag:quant', { agent: true })
    expect(useUI.getState().section).toBe('agent')
  })

  it('agent 会话不会成为"最后一个非 agent 会话"', () => {
    useUI.getState().open('ag:quant', { agent: true })
    expect(useUI.getState().lastChannelId).toBe('ch:eng')
  })
})

describe('右侧栏页签按会话键存', () => {
  it('在 A 推入「回测」，切到 B 看不到它', () => {
    const s = useUI.getState()
    s.pushInspectorTab('ch:eng', 'bt')
    expect(useUI.getState().inspectorTabsBy['ch:eng']).toEqual(['bt'])
    expect(useUI.getState().inspectorTabsBy['ch:mkt']).toBeUndefined()
  })

  it('切回 A，页签还在', () => {
    useUI.getState().pushInspectorTab('ch:eng', 'bt')
    useUI.getState().open('ch:mkt')
    useUI.getState().open('ch:eng')
    expect(useUI.getState().inspectorTabsBy['ch:eng']).toEqual(['bt'])
  })

  it('同一个页签推两次只有一个', () => {
    useUI.getState().pushInspectorTab('ch:eng', 'bt')
    useUI.getState().pushInspectorTab('ch:eng', 'bt')
    expect(useUI.getState().inspectorTabsBy['ch:eng']).toEqual(['bt'])
  })

  it('关掉当前页签，回落到剩下的第一个', () => {
    useUI.getState().pushInspectorTab('ch:eng', 'bt')
    useUI.getState().pushInspectorTab('ch:eng', 'qa')
    expect(useUI.getState().inspectorTab).toBe('qa')
    useUI.getState().closeInspectorTab('ch:eng', 'qa')
    expect(useUI.getState().inspectorTab).toBe('bt')
  })

  it('推入页签会把收起的右侧栏打开', () => {
    useUI.setState({ inspectorOpen: false })
    useUI.getState().pushInspectorTab('ch:eng', 'qa')
    expect(useUI.getState().inspectorOpen).toBe(true)
  })
})

describe('右侧栏宽度', () => {
  it('限制在 300–700', () => {
    useUI.getState().setInspectorWidth(50)
    expect(useUI.getState().inspectorWidth).toBe(INSPECTOR_MIN)
    useUI.getState().setInspectorWidth(5000)
    expect(useUI.getState().inspectorWidth).toBe(INSPECTOR_MAX)
    useUI.getState().setInspectorWidth(420.6)
    expect(useUI.getState().inspectorWidth).toBe(421)
  })
})

describe('主题', () => {
  it('来回切', () => {
    useUI.getState().setTheme('light')
    useUI.getState().toggleTheme()
    expect(useUI.getState().theme).toBe('dark')
    useUI.getState().toggleTheme()
    expect(useUI.getState().theme).toBe('light')
  })
})

describe('新手欢迎页', () => {
  it('打开任何会话就收起', () => {
    useUI.setState({ welcome: true })
    useUI.getState().open('sg_1')
    expect(useUI.getState().welcome).toBe(false)
  })

  it('设置里「再看一遍」：回到会话区、主区清空、放欢迎页', () => {
    useUI.setState({ welcome: false, section: 'set', conversationId: 'sg_1' })
    useUI.getState().showWelcome()
    const s = useUI.getState()
    expect(s.welcome).toBe(true)
    expect(s.section).toBe('chat')
    expect(s.conversationId).toBeNull()
  })

  it('退出登录清掉上个账号留下的位置、引用和页签', () => {
    useUI.setState({ conversationId: 'sg_1', lastChannelId: 'sg_1', quoteBy: { sg_1: 'm1' }, inspectorTabsBy: { sg_1: ['runs'] }, welcome: true })
    useUI.getState().resetAll()
    const s = useUI.getState()
    expect(s.conversationId).toBeNull()
    expect(s.lastChannelId).toBeNull()
    expect(s.quoteBy).toEqual({})
    expect(s.inspectorTabsBy).toEqual({})
    expect(s.welcome).toBe(false)
  })
})
