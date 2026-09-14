import { useCallback, useEffect, useRef } from 'react'
import type { Member } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconCloseSmall, IconPanel } from '../components/Icons'
import { usePlace, type Place } from '../store/selectors'
import { useSession } from '../store/session'
import { INSPECTOR_MAX, INSPECTOR_MIN, useUI } from '../store/ui'
import { AgentProfile, ChannelSettings, RunsList } from '../views/InspectorTabs'
import styles from './Inspector.module.css'

/**
 * 右侧侧栏：三层详情结构的第 2 层。372px 默认，300–700 可拖。
 *
 * 头部是页签栈，不写「检查器」之类的名字。基础页签（话题/运行）由会话上下文
 * 决定，详情页签由点击推入、按会话键存、带 ✕。没有任何页签时不能白屏——
 * 显示"左宽右窄"的分栏示意和三条提示。
 */
const BASE_TABS: Record<string, string> = { members: '成员', settings: '设置', runs: '运行', profile: '资料' }
const DETAIL_TABS: Record<string, string> = {}

export function Inspector() {
  const open = useUI((s) => s.inspectorOpen)
  const section = useUI((s) => s.section)
  const width = useUI((s) => s.inspectorWidth)
  const setWidth = useUI((s) => s.setInspectorWidth)
  const setOpen = useUI((s) => s.setInspectorOpen)
  const conversationId = useUI((s) => s.conversationId)
  const tabsBy = useUI((s) => s.inspectorTabsBy)
  const tab = useUI((s) => s.inspectorTab)
  const setTab = useUI((s) => s.setInspectorTab)
  const closeTab = useUI((s) => s.closeInspectorTab)

  // agent 会话没有基础页签；频道有成员（话题与运行等 M4 接上）
  // 频道：成员 + 运行；agent 会话：资料 + 运行；人和人的私聊没有基础页签
  const place = usePlace(conversationId)
  const base = !place ? [] : place.kind === 'channel' ? ['members', 'settings', 'runs'] : place.isAgent ? ['profile', 'runs'] : []
  const detail = conversationId ? tabsBy[conversationId] ?? [] : []
  const tabs = [...base, ...detail]
  const current = tab && tabs.includes(tab) ? tab : tabs[0] ?? null

  // 拖拽：左边缘 9px 热区，范围 300–700，mouseup 时恢复 cursor
  const dragging = useRef(false)
  const onDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    const startX = e.clientX
    const startW = width
    document.body.style.cursor = 'col-resize'
    const move = (ev: MouseEvent) => {
      if (!dragging.current) return
      setWidth(Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, startW + (startX - ev.clientX))))
    }
    const up = () => {
      dragging.current = false
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [width, setWidth])

  useEffect(() => () => { document.body.style.cursor = '' }, [])

  // 收件箱和设置没有"当前会话"，右侧栏在那里只会显示上一个频道的成员，误导
  const shown = open && section !== 'inbox' && section !== 'set'

  // 收起是宽度从 372 到 0 的过渡而不是直接消失；里面的内容保持原宽被裁掉，不重排
  return (
    <aside className={`${styles.side} ${shown ? '' : styles.shut}`} style={{ width: shown ? width : 0 }} aria-hidden={!shown}>
      <div className={styles.inner} style={{ width }}>
      {shown && <div className={styles.handle} onMouseDown={onDown} />}
      <div className={styles.head}>
        <div className={styles.tabs}>
          {tabs.map((id) => {
            const label = BASE_TABS[id] ?? DETAIL_TABS[id] ?? id
            const closable = id in DETAIL_TABS
            const active = id === current
            return (
              <div key={id} className={`${styles.tab} ${active ? styles.tabActive : ''}`}>
                <button className={styles.tabMain} onClick={() => setTab(id)}>{label}</button>
                <button
                  className={styles.tabClose}
                  style={closable ? undefined : { width: 0, pointerEvents: 'none' }}
                  onClick={() => conversationId && closeTab(conversationId, id)}
                  title="关闭"
                >
                  {closable && <IconCloseSmall />}
                </button>
              </div>
            )
          })}
        </div>
        <button className={styles.collapse} title="收起" onClick={() => setOpen(false)}>
          <IconPanel open />
        </button>
      </div>

      <div className={styles.body}>
        {current === 'members' && place ? (
          <Members place={place} />
        ) : current === 'settings' && place ? (
          <ChannelSettings place={place} />
        ) : current === 'runs' && place ? (
          <RunsList place={place} />
        ) : current === 'profile' && place ? (
          <AgentProfile place={place} />
        ) : current ? (
          <div className={styles.placeholder}>{BASE_TABS[current] ?? DETAIL_TABS[current]}</div>
        ) : (
          <EmptyState />
        )}
      </div>
      </div>
    </aside>
  )
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.diagram}>
        <span className={styles.diagramWide} />
        <span className={styles.diagramNarrow} />
      </div>
      <div className={styles.emptyTitle}>这里并排显示上下文</div>
      <div className={styles.emptyDesc}>
        话题回复、运行轨迹、回测报告会在这一栏里以页签堆叠，左边的对话始终可见、可回复。
      </div>
      <ol className={styles.tips}>
        {[
          ['在消息上点「在话题中回复」', '回复串在这里展开，不遮住频道'],
          ['展开一张运行卡的执行过程', '完整轨迹推成一个页签'],
          ['点回测卡的「查看详情」', '指标、曲线、参数并排看'],
        ].map(([t, d], i) => (
          <li key={t} className={styles.tip}>
            <span className={`${styles.tipNo} mono`}>{String(i + 1).padStart(2, '0')}</span>
            <span className={styles.tipText}>
              <span className={styles.tipTitle}>{t}</span>
              <span className={styles.tipDesc}>{d}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** 频道成员：agent 一组，人一组；群主和管理员带角色标 */
function Members({ place }: { place: Place }) {
  const me = useSession((s) => s.me)
  const openDialog = useUI((s) => s.openDialog)
  const bios = useSession((s) => s.bios)
  const owner = place.members.some((m) => m.id === me && m.role === 'owner')
  const agents = place.members.filter((m) => m.isAgent)
  const humans = place.members.filter((m) => !m.isAgent)
  const row = (m: Member) => {
    // 签名有就占第二行；agent 那一行不显示，它们的说明在自己的资料页里
    const bio = m.isAgent ? '' : bios[m.id] ?? ''
    return (
      <div key={m.id} className={`${styles.mRow} ${bio ? styles.mRowTall : ''}`}>
        <Avatar glyph={glyphOf(m.name)} pair={pairOf(m.id)} size={26} kind={m.isAgent ? 'agent' : 'human'} id={m.id} src={m.avatar} />
        <span className={styles.mText}>
          <span className={styles.mName}>{m.name}{m.id === me ? <span className={styles.mMe}>（你）</span> : null}</span>
          {bio && <span className={styles.mBio}>{bio}</span>}
        </span>
        {m.role !== 'member' && <span className={`${styles.mRole} mono`}>{m.role === 'owner' ? '群主' : '管理员'}</span>}
      </div>
    )
  }
  return (
    <div className={styles.members}>
      {place.groupID && (
        <div className={styles.mActions}>
          <button className={styles.mBtn} onClick={() => openDialog({ kind: 'invite', groupID: place.groupID! })}>邀请成员</button>
          <button className={styles.mBtn} onClick={() => openDialog({ kind: 'rename', groupID: place.groupID!, current: place.title })}>改名</button>
          <button className={`${styles.mBtn} ${styles.mBtnDanger}`} onClick={() => openDialog({ kind: 'leave', groupID: place.groupID!, owner, title: place.title })}>{owner ? '解散' : '退出'}</button>
        </div>
      )}
      {place.groupID && (
        <div className={`${styles.mId} mono`} title="群号">
          <span className={styles.mIdLabel}>群号</span>
          <span className={styles.mIdVal}>{place.groupID}</span>
        </div>
      )}
      {agents.length > 0 && (
        <section className={styles.mGroup}>
          <div className={`${styles.mTitle} mono`}>AGENTS · {agents.length}</div>
          {agents.map(row)}
        </section>
      )}
      <section className={styles.mGroup}>
        <div className={`${styles.mTitle} mono`}>成员 MEMBERS · {humans.length}</div>
        {humans.length ? humans.map(row) : <div className={styles.mEmpty}>正在拉成员…</div>}
      </section>
    </div>
  )
}
