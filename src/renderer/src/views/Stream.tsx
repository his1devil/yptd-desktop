import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer, type VirtualItem, type Virtualizer } from '@tanstack/react-virtual'
import type { Message, MessageId, PixelSize, QuotePreview } from '../../../shared/model'
import { plainText } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconCopy, IconEmoji, IconFile, IconHandoff, IconMore, IconQuote, IconUndo } from '../components/Icons'
import { dayLabel } from '../im/translate'
import { visible } from '../im/timeline'
import type { Place } from '../store/selectors'
import { timeline, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import { Lightbox } from './Lightbox'
import { Rich } from './rich'
import styles from './Stream.module.css'

/**
 * 消息流。频道/私聊是 IM 形态（头像 + 名字 + 时间 + 悬浮条），和单个 agent 的会话是
 * harness 形态（我的话靠右成泡，agent 的回答是带头的一段）。形态跟随语境，数据是同一条流。
 *
 * 虚拟化：几千条只画视口里的几十行。行高先估、量过后按真实值；视口上方的行量出
 * 真高时滚动位置跟着补，往上翻历史不跳；贴底时新消息、图片加载都保持贴底。
 */

type Row =
  | { key: string; kind: 'day'; label: string }
  | { key: string; kind: 'msg'; message: Message }
  | { key: string; kind: 'pending'; message: Message }

const QUICK = ['👍', '✅', '👀'] as const
export const EMOJI = ['👍', '✅', '👀', '🎯', '🙏', '🔥', '🚀', '⚡', '😂', '🤔', '👏', '❤️', '🎉', '😮', '😢', '💯', '🫡', '👌', '🤝', '🧐', '☕', '🐛', '✨', '📌']
const TOP_PAD = 14

function buildRows(messages: readonly Message[]): Row[] {
  const rows: Row[] = []
  let day = -1
  for (const m of messages) {
    if (m.dayIndex !== day) {
      day = m.dayIndex
      rows.push({ key: `d${day}`, kind: 'day', label: dayLabel(day) })
    }
    rows.push({ key: m.id, kind: m.transient ? 'pending' : 'msg', message: m })
  }
  return rows
}

// 估高只用于第一次布局，量过之后按真实高度
function estimate(row: Row): number {
  if (row.kind === 'day') return 44
  if (row.kind === 'pending') return 46
  const m = row.message
  let h = 52
  if (m.body.kind === 'text') h += Math.ceil(m.body.text.length / 70) * 22
  else if (m.body.kind === 'picture') h += (fit(m.body.natural)?.height ?? 220) + 6
  else h += 56
  if (m.quote) h += 34
  if (m.reactions.length) h += 34
  return h
}

/** 图片框：360×280 以内按比例缩，不放大 */
function fit(natural: PixelSize | null): PixelSize | null {
  if (!natural || natural.width <= 0 || natural.height <= 0) return null
  const s = Math.min(360 / natural.width, 280 / natural.height, 1)
  return { width: Math.max(48, Math.round(natural.width * s)), height: Math.max(48, Math.round(natural.height * s)) }
}

const hhmm = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const bytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

interface Popover { id: MessageId; kind: 'picker' | 'menu'; anchor: DOMRect }
type Anchor = (id: MessageId, kind: Popover['kind'], anchor: DOMRect) => void
type Shot = { url: string; name: string } | null

export function Stream({ place }: { place: Place }) {
  const id = place.id
  const harness = place.isAgent
  const tick = useSession((s) => s.tick)
  const me = useSession((s) => s.me)
  const loadingOlder = useSession((s) => s.loadingOlder)
  const setQuote = useUI((s) => s.setQuote)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick 是时间线的版本号
  const rows = useMemo(() => buildRows(visible(timeline(id).messages)), [id, tick])
  const [popover, setPopover] = useState<Popover | null>(null)
  const [flash, setFlash] = useState<MessageId | null>(null)
  const [shot, setShot] = useState<Shot>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const requesting = useRef(false)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimate(rows[i]!),
    getItemKey: (i) => rows[i]!.key,
    overscan: 8,
    scrollMargin: TOP_PAD,
  })
  // 视口上方的行量出真实高度后，滚动位置跟着补——往上翻历史时才不会跳。
  // 这是实例上的属性，不是选项。
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item: VirtualItem, _delta: number, inst: Virtualizer<HTMLDivElement, Element>) =>
    item.start < (inst.scrollOffset ?? 0)
  const total = virtualizer.getTotalSize()

  // 贴底：在底部时新消息、量高、图片加载都保持贴底
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [total, rows.length])

  // 往前拼了一页：拿之前的第一条消息当锚，把它挪动的距离加到 scrollTop 上，视口里的内容不动
  const anchor = useRef<{ key: string; start: number } | null>(null)
  useLayoutEffect(() => {
    const first = rows.findIndex((r) => r.kind !== 'day')
    const cache = virtualizer.measurementsCache
    const prev = anchor.current
    anchor.current = first >= 0 && cache[first] ? { key: rows[first]!.key, start: cache[first]!.start } : null
    if (!prev || first <= 0) return
    const k = rows.findIndex((r) => r.key === prev.key)
    if (k <= first || !cache[k]) return
    const moved = cache[k]!.start - prev.start
    const el = scrollRef.current
    if (el && moved > 0) el.scrollTop += moved
  }, [rows, virtualizer])

  const maybeLoadOlder = useCallback(() => {
    const t = timeline(id)
    if (requesting.current || !t.hasMore || t.length === 0) return
    requesting.current = true
    void useSession.getState().loadOlder(id).finally(() => { requesting.current = false })
  }, [id])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (el.scrollTop < 300) maybeLoadOlder()
  }, [maybeLoadOlder])

  // 内容不够一屏就没有滚动事件，主动再拉一页
  useEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollHeight <= el.clientHeight + 1) maybeLoadOlder()
  }, [rows.length, total, maybeLoadOlder])

  // ---- 行上的动作。都用 getState，回调稳定，行组件的 memo 才有用 ----
  const react = useCallback((mid: MessageId, emoji: string) => { void useSession.getState().react(id, mid, emoji) }, [id])
  const quote = useCallback((mid: MessageId) => { setQuote(id, mid); composerBus.insert('') }, [id, setQuote])
  const handoff = useCallback((mid: MessageId) => { setQuote(id, mid); composerBus.insert('@') }, [id, setQuote])
  const revoke = useCallback((mid: MessageId) => { void useSession.getState().revoke(id, mid) }, [id])
  const copy = useCallback((mid: MessageId) => {
    const m = timeline(id).get(mid)
    if (m) void navigator.clipboard.writeText(plainText(m.body))
  }, [id])
  const openPopover = useCallback<Anchor>((mid, kind, rect) => setPopover({ id: mid, kind, anchor: rect }), [])
  const closePopover = useCallback(() => setPopover(null), [])
  const jump = useCallback((mid: MessageId) => {
    const i = rows.findIndex((r) => r.kind === 'msg' && r.message.id === mid)
    if (i < 0) return
    atBottom.current = false
    virtualizer.scrollToIndex(i, { align: 'center' })
    setFlash(mid)
    window.setTimeout(() => setFlash((f) => (f === mid ? null : f)), 1400)
  }, [rows, virtualizer])

  const empty = rows.length === 0 && !timeline(id).hasMore

  return (
    <div className={styles.wrap}>
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
        {empty ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>{harness ? `和 ${place.title} 的对话从这里开始` : '这里还没有消息'}</div>
            <div className={styles.emptyDesc}>{harness ? '直接说要做什么，回答会出现在这里。' : '说点什么，或者 @ 一个 agent 派活。'}</div>
          </div>
        ) : (
          <div className={styles.inner} style={{ height: total }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index]!
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className={styles.vrow}
                  style={{ transform: `translateY(${v.start - TOP_PAD}px)` }}
                >
                  {row.kind === 'day' ? (
                    <DaySep label={row.label} />
                  ) : row.kind === 'pending' ? (
                    <Pending message={row.message} harness={harness} />
                  ) : harness ? (
                    <Turn message={row.message} mine={row.message.sender === me} flash={flash === row.message.id} onCopy={copy} onQuote={quote} onImage={setShot} />
                  ) : (
                    <MessageRow
                      message={row.message}
                      mine={row.message.sender === me}
                      pinned={popover?.id === row.message.id}
                      flash={flash === row.message.id}
                      onReact={react} onQuote={quote} onHandoff={handoff} onJump={jump} onImage={setShot} onPopover={openPopover}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {loadingOlder && <div className={styles.loadingPill}>加载更早的消息…</div>}
      {popover && (
        <PopoverLayer
          popover={popover}
          mine={timeline(id).get(popover.id)?.sender === me}
          onClose={closePopover} onReact={react} onQuote={quote} onCopy={copy} onRevoke={revoke}
        />
      )}
      {shot && <Lightbox url={shot.url} name={shot.name} onClose={() => setShot(null)} />}
    </div>
  )
}

// ---- 行 ---------------------------------------------------------------------------

/** 发送者头像：优先用他现在的头像，没有再用消息里烤进去的那张 */
function SenderAvatar({ id, name, fallback, size, agent, style }: { id: string; name: string; fallback: string | null; size: number; agent: boolean; style?: React.CSSProperties }) {
  const current = useSession((s) => s.avatars[id])
  return <Avatar glyph={glyphOf(name)} pair={pairOf(id)} size={size} kind={agent ? 'agent' : 'human'} src={current ?? fallback} style={style} />
}

function DaySep({ label }: { label: string }) {
  return (
    <div className={styles.day}>
      <span className={styles.dayLine} />
      <span className={`${styles.dayPill} mono`}>{label}</span>
      <span className={styles.dayLine} />
    </div>
  )
}

/** agent 的「正在处理…」占位：不显示文字，显示一条呼吸的骨架 */
function Pending({ message: m, harness }: { message: Message; harness: boolean }) {
  return (
    <div className={harness ? styles.pendingTurn : styles.pending}>
      <SenderAvatar id={m.sender} name={m.senderName} fallback={m.senderAvatar} size={harness ? 24 : 30} agent={m.isAgent} />
      <div className={styles.shimmer} />
    </div>
  )
}

interface RowProps {
  message: Message
  mine: boolean
  pinned: boolean
  flash: boolean
  onReact(id: MessageId, emoji: string): void
  onQuote(id: MessageId): void
  onHandoff(id: MessageId): void
  onJump(id: MessageId): void
  onImage(shot: Shot): void
  onPopover: Anchor
}

const MessageRow = memo(function MessageRow({ message: m, pinned, flash, onReact, onQuote, onHandoff, onJump, onImage, onPopover }: RowProps) {
  const cls = [styles.row, pinned && styles.pinned, flash && styles.flash, m.mentionsMe && styles.mentioned].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <div className={styles.bar}>
        {QUICK.map((e) => (
          <button key={e} className={styles.barEmoji} title={e === '👍' ? '赞' : e === '✅' ? '搞定' : '在看'} onClick={() => onReact(m.id, e)}>{e}</button>
        ))}
        <span className={styles.barSep} />
        <button className={styles.barBtn} title="添加表情" onClick={(e) => onPopover(m.id, 'picker', e.currentTarget.getBoundingClientRect())}><IconEmoji /></button>
        <button className={styles.barBtn} title="引用回复" onClick={() => onQuote(m.id)}><IconQuote /></button>
        <button className={`${styles.barBtn} ${styles.barAgent}`} title="转交给 agent" onClick={() => onHandoff(m.id)}><IconHandoff /></button>
        <button className={styles.barBtn} title="更多" onClick={(e) => onPopover(m.id, 'menu', e.currentTarget.getBoundingClientRect())}><IconMore /></button>
      </div>

      <SenderAvatar id={m.sender} name={m.senderName} fallback={m.senderAvatar} size={30} agent={m.isAgent} style={{ marginTop: 1 }} />
      <div className={styles.content}>
        <div className={styles.meta}>
          <span className={styles.who}>{m.senderName}</span>
          {m.isAgent && <span className={`${styles.tag} mono`}>{m.agentTag || 'AGENT'}</span>}
          <span className={`${styles.time} mono`}>{hhmm(m.sentAt)}</span>
          {m.sendState === 'sending' && <span className={styles.state}>· 发送中</span>}
          {m.sendState === 'failed' && <span className={`${styles.state} ${styles.stateBad}`}>· 没发出去</span>}
        </div>
        {m.quote && <QuoteBlock quote={m.quote} onJump={onJump} />}
        <Body message={m} onImage={onImage} />
        {m.reactions.length > 0 && (
          <div className={styles.rx}>
            {m.reactions.map((r) => (
              <button key={r.emoji} className={`${styles.chip} ${r.mine ? styles.chipMine : ''}`} onClick={() => onReact(m.id, r.emoji)}>
                <span className={styles.chipEmoji}>{r.emoji}</span>
                <span className="mono">{r.count}</span>
              </button>
            ))}
            <button className={styles.chipAdd} title="添加表情" onClick={(e) => onPopover(m.id, 'picker', e.currentTarget.getBoundingClientRect())}><IconEmoji size={16} /></button>
          </div>
        )}
      </div>
    </div>
  )
})

function QuoteBlock({ quote, onJump }: { quote: QuotePreview; onJump(id: MessageId): void }) {
  return (
    <button className={styles.quote} disabled={!quote.messageId} onClick={() => quote.messageId && onJump(quote.messageId)}>
      <Avatar glyph={glyphOf(quote.senderName)} pair={pairOf(quote.senderID || quote.senderName)} size={17} />
      <span className={styles.quoteWho}>{quote.senderName}</span>
      <span className={styles.quoteText}>{quote.excerpt || '[图片]'}</span>
    </button>
  )
}

function Body({ message: m, onImage, large }: { message: Message; onImage(shot: Shot): void; large?: boolean }) {
  const b = m.body
  switch (b.kind) {
    case 'text':
      return (
        <div className={`${styles.text} ${large ? styles.textLg : ''}`}>
          <Rich text={b.text} mentions={m.mentions} agentMentions={m.agentMentions} />
        </div>
      )
    case 'picture': {
      const box = fit(b.natural)
      return (
        <button className={`${styles.pic} ${box ? styles.picFixed : ''}`} style={box ?? undefined} onClick={() => onImage({ url: b.url, name: b.name })} title={b.name}>
          <img src={b.url} alt={b.name} draggable={false} loading="lazy" />
        </button>
      )
    }
    case 'file':
      return (
        <a className={styles.file} href={b.url} target="_blank" rel="noreferrer" title="在浏览器里下载">
          <span className={styles.fileIcon}><IconFile /></span>
          <span className={styles.fileText}>
            <span className={styles.fileName}>{b.name}</span>
            <span className={`${styles.fileMeta} mono`}>{bytes(b.bytes)}</span>
          </span>
        </a>
      )
    case 'unsupported':
      return <div className={styles.unsupported}>{b.label}</div>
  }
}

// ---- harness 形态 ---------------------------------------------------------------------

interface TurnProps {
  message: Message
  mine: boolean
  flash: boolean
  onCopy(id: MessageId): void
  onQuote(id: MessageId): void
  onImage(shot: Shot): void
}

const Turn = memo(function Turn({ message: m, mine, flash, onCopy, onQuote, onImage }: TurnProps) {
  if (mine) {
    return (
      <div className={`${styles.turnUser} ${flash ? styles.flash : ''}`}>
        <div className={styles.bubble}>
          {m.quote && <div className={styles.bubbleQuote}>{m.quote.senderName}：{m.quote.excerpt}</div>}
          <Body message={m} onImage={onImage} />
          {m.sendState === 'failed' && <div className={styles.stateBad}>没发出去</div>}
        </div>
      </div>
    )
  }
  return (
    <div className={`${styles.turn} ${flash ? styles.flash : ''}`}>
      <div className={styles.turnHead}>
        <SenderAvatar id={m.sender} name={m.senderName} fallback={m.senderAvatar} size={24} agent={m.isAgent} />
        <span className={styles.who}>{m.senderName}</span>
        {m.isAgent && <span className={`${styles.tag} mono`}>{m.agentTag || 'AGENT'}</span>}
        <span className={`${styles.time} mono`}>{hhmm(m.sentAt)}</span>
      </div>
      <div className={styles.turnBody}>
        <Body message={m} onImage={onImage} large />
      </div>
      <div className={styles.turnActions}>
        <button className={styles.turnBtn} title="复制" onClick={() => onCopy(m.id)}><IconCopy /></button>
        <button className={styles.turnBtn} title="引用" onClick={() => onQuote(m.id)}><IconQuote size={14} /></button>
      </div>
    </div>
  )
})

// ---- 弹层：表情选择 / 更多 --------------------------------------------------------------

interface PopoverProps {
  popover: Popover
  mine: boolean
  onClose(): void
  onReact(id: MessageId, emoji: string): void
  onQuote(id: MessageId): void
  onCopy(id: MessageId): void
  onRevoke(id: MessageId): void
}

function PopoverLayer({ popover, mine, onClose, onReact, onQuote, onCopy, onRevoke }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; visibility: 'hidden' | 'visible' }>({ left: 0, top: 0, visibility: 'hidden' })

  // 右边贴着按钮的右边，下面放不下就放上面
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const a = popover.anchor
    const left = Math.max(8, Math.min(a.right - r.width, window.innerWidth - r.width - 8))
    let top = a.bottom + 6
    if (top + r.height > window.innerHeight - 8) top = a.top - r.height - 6
    setPos({ left, top, visibility: 'visible' })
  }, [popover])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const picker = popover.kind === 'picker'
  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div ref={ref} className={`${styles.popover} ${picker ? '' : styles.menuPop}`} style={pos} onMouseDown={(e) => e.stopPropagation()}>
        {picker ? (
          <>
            <div className={styles.popHead}>
              <span className={`${styles.popLabel} mono`}>常用 FREQUENT</span>
              <span className={styles.popLine} />
              <span className="mono">ESC 关闭</span>
            </div>
            <div className={styles.emojiGrid}>
              {EMOJI.map((e) => (
                <button key={e} className={styles.emojiBtn} onClick={() => { onReact(popover.id, e); onClose() }}>{e}</button>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.menu}>
            <button className={styles.menuItem} onClick={() => { onCopy(popover.id); onClose() }}><IconCopy /> 复制文本</button>
            <button className={styles.menuItem} onClick={() => { onQuote(popover.id); onClose() }}><IconQuote size={14} /> 引用回复</button>
            {mine && <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => { onRevoke(popover.id); onClose() }}><IconUndo /> 撤回</button>}
          </div>
        )}
      </div>
    </div>
  )
}
