import { useCallback, useEffect, useRef } from 'react'
import { IconCloseSmall, IconPanel } from '../components/Icons'
import { INSPECTOR_MAX, INSPECTOR_MIN, useUI } from '../store/ui'
import styles from './Inspector.module.css'

/**
 * 右侧侧栏：三层详情结构的第 2 层。372px 默认，300–700 可拖。
 *
 * 头部是页签栈，不写「检查器」之类的名字。基础页签（话题/运行）由会话上下文
 * 决定，详情页签由点击推入、按会话键存、带 ✕。没有任何页签时不能白屏——
 * 显示"左宽右窄"的分栏示意和三条提示。
 */
const BASE_TABS: Record<string, string> = { thread: '话题', runs: '运行' }
const DETAIL_TABS: Record<string, string> = { bt: '回测', qa: '分析' }

export function Inspector() {
  const open = useUI((s) => s.inspectorOpen)
  const width = useUI((s) => s.inspectorWidth)
  const setWidth = useUI((s) => s.setInspectorWidth)
  const setOpen = useUI((s) => s.setInspectorOpen)
  const conversationId = useUI((s) => s.conversationId)
  const tabsBy = useUI((s) => s.inspectorTabsBy)
  const tab = useUI((s) => s.inspectorTab)
  const setTab = useUI((s) => s.setInspectorTab)
  const closeTab = useUI((s) => s.closeInspectorTab)

  // agent 会话没有基础页签；频道有话题与运行
  const isAgent = conversationId?.startsWith('ag:') ?? false
  const base = isAgent || !conversationId ? [] : Object.keys(BASE_TABS)
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

  if (!open) return null

  return (
    <aside className={styles.side} style={{ width }}>
      <div className={styles.handle} onMouseDown={onDown} />
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
        {current ? (
          <div className={styles.placeholder}>{BASE_TABS[current] ?? DETAIL_TABS[current]} · M3 接内容</div>
        ) : (
          <EmptyState />
        )}
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
      <button className={styles.primary}>去 #engineering 看个例子</button>
    </div>
  )
}
