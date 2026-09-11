import { Avatar } from '../components/Avatar'
import { IconPlus } from '../components/Icons'
import { useUI, type Section } from '../store/ui'
import styles from './ContextSidebar.module.css'

/**
 * 上下文侧栏 252px。内容读 section：会话区是频道/私聊/话题，Agent 区是
 * 会话/运行中/已启用/已暂停，收件箱是筛选，设置是分组。
 *
 * M0 阶段这里是按设计稿的分组和条目做的静态骨架，M1 接导航状态，M2 接真数据。
 */
interface Item { id: string; name: string; glyph?: string; pair?: number; kind?: 'human' | 'agent'; hash?: boolean; sub?: string; badge?: number; live?: boolean }
interface Group { title: string; items: Item[] }

const GROUPS: Record<Section, { heading: string; groups: Group[] }> = {
  chat: {
    heading: '会话',
    groups: [
      { title: 'CHANNELS', items: [
        { id: 'ch:eng', name: 'engineering', hash: true, badge: 3 },
        { id: 'ch:mkt', name: 'markets', hash: true },
      ] },
      { title: 'DIRECT', items: [
        { id: 'dm:zy', name: '陈知远', glyph: '知', pair: 0 },
        { id: 'dm:ln', name: '林越', glyph: '越', pair: 2 },
        { id: 'ag:triage', name: 'Triage 分诊', glyph: '△', pair: 1, kind: 'agent', sub: '504 分诊跟进' },
      ] },
      { title: 'THREADS', items: [
        { id: 'th:1', name: '504 的根因', sub: '#engineering · 4 回复' },
      ] },
    ],
  },
  agent: {
    heading: 'Agent',
    groups: [
      { title: '会话 SESSIONS', items: [
        { id: 'ag:triage', name: 'Triage 分诊', glyph: '△', pair: 1, kind: 'agent', sub: '504 分诊跟进', live: true },
        { id: 'ag:quant', name: 'Quant 量化', glyph: 'Q', pair: 4, kind: 'agent', sub: 'NVDA 阈值分析' },
        { id: 'ag:filing', name: 'Filing 归档', glyph: 'F', pair: 3, kind: 'agent', sub: 'TSMC 月报' },
        { id: 'ag:scribe', name: 'Scribe 纪要', glyph: 'S', pair: 0, kind: 'agent', sub: '周会纪要' },
      ] },
      { title: '运行中 RUNNING', items: [
        { id: 'a:triage', name: 'Triage 分诊', glyph: '△', pair: 1, kind: 'agent', live: true },
      ] },
      { title: '已启用 ENABLED', items: [
        { id: 'a:quant', name: 'Quant 量化', glyph: 'Q', pair: 4, kind: 'agent' },
        { id: 'a:filing', name: 'Filing 归档', glyph: 'F', pair: 3, kind: 'agent' },
        { id: 'a:scribe', name: 'Scribe 纪要', glyph: 'S', pair: 0, kind: 'agent' },
      ] },
      { title: '已暂停 PAUSED', items: [
        { id: 'a:digest', name: 'Digest 日报', glyph: 'D', pair: 2, kind: 'agent' },
      ] },
    ],
  },
  inbox: {
    heading: '收件箱',
    groups: [
      { title: '筛选 FILTER', items: [
        { id: 'in:all', name: '全部', badge: 7 },
        { id: 'in:mention', name: '@提及我的', badge: 3 },
        { id: 'in:agent', name: 'Agent 结果', badge: 2 },
        { id: 'in:approve', name: '待我审批', badge: 2 },
        { id: 'in:archived', name: '已归档' },
      ] },
    ],
  },
  set: {
    heading: '设置',
    groups: [
      { title: '工作区 WORKSPACE', items: [
        { id: 'set:members', name: '成员与邀请' },
        { id: 'set:perm', name: '权限矩阵' },
        { id: 'set:audit', name: '审计日志' },
      ] },
      { title: '个人 PERSONAL', items: [
        { id: 'set:profile', name: '资料' },
        { id: 'set:notify', name: '通知' },
        { id: 'set:appearance', name: '外观' },
        { id: 'set:keys', name: '快捷键' },
      ] },
    ],
  },
  vm: { heading: '运行机器', groups: [] },
  lib: { heading: '知识库', groups: [] },
  market: { heading: 'Agent 市场', groups: [] },
}

export function ContextSidebar() {
  const section = useUI((s) => s.section)
  const conversationId = useUI((s) => s.conversationId)
  const open = useUI((s) => s.open)
  const { heading, groups } = GROUPS[section]

  return (
    <aside className={styles.side}>
      <div className={styles.head}>
        <span className={styles.heading}>{heading}</span>
        {section === 'chat' && (
          <button className={styles.headBtn} title="新建"><IconPlus /></button>
        )}
      </div>
      <div className={styles.scroll}>
        {groups.map((g) => (
          <section key={g.title} className={styles.group}>
            <div className={`${styles.groupTitle} mono`}>{g.title}</div>
            {g.items.map((it) => {
              const active = it.id === conversationId
              return (
                <button
                  key={it.id}
                  className={`${styles.item} ${active ? styles.active : ''}`}
                  onClick={() => open(it.id, { section })}
                >
                  {it.hash ? (
                    <span className={`${styles.hash} mono`}>#</span>
                  ) : it.glyph ? (
                    <Avatar glyph={it.glyph} pair={it.pair ?? 0} size={20} kind={it.kind} />
                  ) : (
                    <span className={styles.dot} />
                  )}
                  <span className={styles.text}>
                    <span className={styles.name}>{it.name}</span>
                    {it.sub && <span className={styles.sub}>{it.sub}</span>}
                  </span>
                  {it.live && <span className={styles.live} title="运行中" />}
                  {it.badge ? <span className={`${styles.count} mono`}>{it.badge}</span> : null}
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </aside>
  )
}
