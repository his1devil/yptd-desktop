import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer, type VirtualItem, type Virtualizer } from '@tanstack/react-virtual'
import type { Attachment, Message, MessageId, PixelSize, QuotePreview } from '../../../shared/model'
import { summarize } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconCopy, IconEmoji, IconFile, IconHandoff, IconMore, IconQuote, IconUndo } from '../components/Icons'
import { previewFor } from '../im/files'
import { visible } from '../im/timeline'
import { useAgentProfiles } from '../store/agents'
import type { Place } from '../store/selectors'
import { timeline, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import { Lightbox } from './Lightbox'
import { Rich } from './rich'
import { buildRows, rowHas, type Row } from './rows'
import { RunBody, RunCard } from './Run'
import styles from './Stream.module.css'

/**
 * 消息流。频道/私聊是 IM 形态（头像 + 名字 + 时间 + 悬浮条），和单个 agent 的会话是
 * harness 形态（我的话靠右成泡，agent 的回答是带头的一段）。形态跟随语境，数据是同一条流。
 *
 * 虚拟化：几千条只画视口里的几十行。行高先估、量过后按真实值；视口上方的行量出
 * 真高时滚动位置跟着补，往上翻历史不跳；贴底时新消息、图片加载都保持贴底。
 */

const QUICK = ['👍', '✅', '👀'] as const
export const EMOJI = ['👍', '✅', '👀', '🎯', '🙏', '🔥', '🚀', '⚡', '😂', '🤔', '👏', '❤️', '🎉', '😮', '😢', '💯', '🫡', '👌', '🤝', '🧐', '☕', '🐛', '✨', '📌']
const TOP_PAD = 14
/** 和 agent 还没聊过时给的几句开场，点一下进输入框 */
const STARTERS = ['你能帮我做什么？', '用三句话介绍你自己', '帮我看看这个：']

// 估高只用于第一次布局，量过之后按真实高度
function estimate(row: Row): number {
  if (row.kind === 'day') return 44
  if (row.kind === 'pending') return row.message.runID ? 170 : 46
  if (row.kind === 'gallery') return 52 + 180 * Math.ceil(row.messages.length / 4)
  const m = row.message
  let h = 52
  h += attachmentsHeight(m.attachments)
  if (m.runID) h += 96
  if (m.body.kind === 'text') h += Math.ceil(m.body.text.length / 70) * 22
  else if (m.body.kind === 'picture') h += (fit(m.body.natural)?.height ?? 220) + 6
  else h += 56
  if (m.quote) h += 34
  if (m.reactions.length) h += 34
  return h
}

/** 附件块的估高：图按画廊那套（≤2 张 200 高，更多 150 高，一行最多 4 张），文件卡 58 一张 */
function attachmentsHeight(a: Attachment[]): number {
  const imgs = a.filter((x) => x.kind === 'image').length
  const files = a.length - imgs
  let h = 0
  if (imgs) h += (imgs <= 2 ? 200 : 150) * Math.ceil(imgs / 4) + 6
  if (files) h += files * 58
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
  const profiles = useAgentProfiles()
  const agentDesc = harness ? profiles?.find((p) => p.userID === place.peer?.userID)?.description : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick 是时间线的版本号
  const rows = useMemo(() => buildRows(visible(timeline(id).messages)), [id, tick])
  const [popover, setPopover] = useState<Popover | null>(null)
  const [flash, setFlash] = useState<MessageId | null>(null)
  const [shot, setShot] = useState<Shot>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const requesting = useRef(false)

  // 第一页：点会话打开的路径已经在拉了，这里兜住另一条——重启后从上次的会话直接挂上来，
  // 没人点过它。ensure 是幂等的，拉过就不会再拉。
  useEffect(() => { void useSession.getState().ensure(id) }, [id])

  // 进场动效。第一批到屏幕上的行按从上到下的次序错开 22ms 依次浮起——"瀑布"；
  // 之后新来的消息各自浮起一次；往上翻出来的历史不动（它不是新东西）。
  // 每行的延迟只在第一次渲染时定下来，之后不改：改动 animation-delay 会让动画重放。
  const firstRowsAt = useRef<number | null>(null)
  const initial = useRef<{ keys: Set<string>; newestAt: number } | null>(null)
  const enterDelay = useRef(new Map<string, number>())
  if (rows.length > 0 && initial.current === null) {
    firstRowsAt.current = performance.now()
    let newestAt = 0
    for (const r of rows) {
      const at = r.kind === 'day' ? 0 : r.kind === 'gallery' ? r.messages[r.messages.length - 1]!.sentAt : r.message.sentAt
      if (at > newestAt) newestAt = at
    }
    initial.current = { keys: new Set(rows.map((r) => r.key)), newestAt }
  }
  const entering = firstRowsAt.current !== null && performance.now() - firstRowsAt.current < 600
  const motionOf = (row: Row, order: number): { cls: string; style: CSSProperties } => {
    const init = initial.current
    if (init?.keys.has(row.key)) {
      let delay = enterDelay.current.get(row.key)
      if (delay === undefined && entering) { delay = Math.min(order, 14) * 22; enterDelay.current.set(row.key, delay) }
      return delay === undefined ? { cls: '', style: {} } : { cls: styles.enter ?? '', style: { animationDelay: `${delay}ms` } }
    }
    // 不在第一批里：比第一批都新的才是"新消息"，旧的是翻出来的历史
    const at = row.kind === 'day' ? 0 : row.kind === 'gallery' ? row.messages[0]!.sentAt : row.message.sentAt
    const fresh = row.kind !== 'day' && init !== null && at >= init.newestAt
    return { cls: fresh ? styles.fresh ?? '' : '', style: {} }
  }

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
    if (m) void navigator.clipboard.writeText(summarize(m))
  }, [id])
  const openPopover = useCallback<Anchor>((mid, kind, rect) => setPopover({ id: mid, kind, anchor: rect }), [])
  const closePopover = useCallback(() => setPopover(null), [])
  const jump = useCallback((mid: MessageId) => {
    const i = rows.findIndex((r) => rowHas(r, mid))
    if (i < 0) return
    atBottom.current = false
    virtualizer.scrollToIndex(i, { align: 'center' })
    setFlash(mid)
    window.setTimeout(() => setFlash((f) => (f === mid ? null : f)), 1400)
  }, [rows, virtualizer])

  // 别处（⌘K、收件箱、运行列表）要跳到某条消息：在时间线里就滚过去，不在就往前翻几页找
  const jumpTo = useUI((s) => s.jumpTo)
  const setJumpTo = useUI((s) => s.setJumpTo)
  const jumpTries = useRef(0)
  useEffect(() => {
    if (!jumpTo || jumpTo.conversationId !== id) return
    const i = rows.findIndex((r) => rowHas(r, jumpTo.messageId))
    if (i >= 0) {
      jumpTries.current = 0
      setJumpTo(null)
      // 等这帧画完再滚，不然量高还是估的
      requestAnimationFrame(() => jump(jumpTo.messageId))
      return
    }
    if (timeline(id).hasMore && jumpTries.current < 8) { jumpTries.current++; maybeLoadOlder() }
    else { jumpTries.current = 0; setJumpTo(null) }
  }, [jumpTo, rows, id, jump, maybeLoadOlder, setJumpTo])

  const status = timeline(id).status
  const failed = rows.length === 0 && status === 'failed'
  const empty = rows.length === 0 && status === 'ready'
  const loading = rows.length === 0 && !failed && !empty

  return (
    <div className={styles.wrap}>
      <div ref={scrollRef} className={styles.scroll} onScroll={onScroll}>
        {loading ? (
          <Skeleton harness={harness} />
        ) : failed ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>消息没加载出来</div>
            <div className={styles.emptyDesc}>{timeline(id).error}</div>
            <button className={styles.retry} onClick={() => void useSession.getState().ensure(id)}>重试</button>
          </div>
        ) : empty ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>{harness ? `和 ${place.title} 的对话从这里开始` : '这里还没有消息'}</div>
            <div className={styles.emptyDesc}>{harness ? (agentDesc || '直接说要做什么，回答会出现在这里。') : '说点什么，或者 @ 一个 agent 派活。'}</div>
            {harness && (
              <div className={styles.starters}>
                {STARTERS.map((s) => <button key={s} className={styles.starter} onClick={() => composerBus.insert(s)}>{s}</button>)}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.inner} style={{ height: total }}>
            {virtualizer.getVirtualItems().map((v, i, items) => {
              const row = rows[v.index]!
              // 瀑布从视口里第一行开始数，上面预渲染的几行不占位次
              const motion = motionOf(row, Math.max(0, i - firstVisible(items, scrollRef.current)))
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className={styles.vrow}
                  style={{ transform: `translateY(${v.start - TOP_PAD}px)` }}
                >
                  {/* 动效放在内层：外层的 transform 是虚拟列表的定位，动画一碰它整列就叠到一起 */}
                  <div className={motion.cls} style={motion.style}>
                  {row.kind === 'day' ? (
                    <DaySep label={row.label} />
                  ) : row.kind === 'pending' && !row.message.runID ? (
                    <Pending message={row.message} harness={harness} />
                  ) : row.kind === 'gallery' ? (
                    harness ? (
                      <Turn message={row.messages[0]!} gallery={row.messages} mine={row.messages[0]!.sender === me} flash={row.messages.some((m) => m.id === flash)} onCopy={copy} onQuote={quote} onImage={setShot} />
                    ) : (
                      <MessageRow
                        message={row.messages[0]!}
                        gallery={row.messages}
                        mine={row.messages[0]!.sender === me}
                        pinned={popover?.id === row.messages[0]!.id}
                        flash={row.messages.some((m) => m.id === flash)}
                        onReact={react} onQuote={quote} onHandoff={handoff} onJump={jump} onImage={setShot} onPopover={openPopover}
                      />
                    )
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

/** 视口顶端之上还预渲染了几行；瀑布的次序从真正看得见的第一行算起 */
function firstVisible(items: readonly VirtualItem[], el: HTMLDivElement | null): number {
  const top = (el?.scrollTop ?? 0) + TOP_PAD
  const i = items.findIndex((v) => v.end > top)
  return i < 0 ? 0 : i
}

// ---- 行 ---------------------------------------------------------------------------

/** 第一页还没到：几行呼吸的骨架，占着位置，来了就换成真行浮起 */
function Skeleton({ harness }: { harness: boolean }) {
  const widths = [62, 38, 74, 46, 58]
  return (
    <div className={styles.skel}>
      {widths.map((w, i) => (
        <div key={i} className={harness && i % 2 === 1 ? styles.skelRowRight : styles.skelRow} style={{ animationDelay: `${i * 60}ms` }}>
          {!(harness && i % 2 === 1) && <span className={styles.skelAvatar} />}
          <span className={styles.skelLines}>
            <span className={styles.skelLine} style={{ width: '18%' }} />
            <span className={styles.skelLine} style={{ width: `${w}%` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

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
  /** 同一个人连着发的几张图：并成一行画廊 */
  gallery?: Message[]
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

const MessageRow = memo(function MessageRow({ message: m, gallery, pinned, flash, onReact, onQuote, onHandoff, onJump, onImage, onPopover }: RowProps) {
  const cls = [styles.row, pinned && styles.pinned, flash && styles.flash, m.mentionsMe && styles.mentioned].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      {!m.transient && <div className={styles.bar}>
        {QUICK.map((e) => (
          <button key={e} className={styles.barEmoji} title={e === '👍' ? '赞' : e === '✅' ? '搞定' : '在看'} onClick={() => onReact(m.id, e)}>{e}</button>
        ))}
        <span className={styles.barSep} />
        <button className={styles.barBtn} title="添加表情" onClick={(e) => onPopover(m.id, 'picker', e.currentTarget.getBoundingClientRect())}><IconEmoji /></button>
        <button className={styles.barBtn} title="引用回复" onClick={() => onQuote(m.id)}><IconQuote /></button>
        <button className={`${styles.barBtn} ${styles.barAgent}`} title="转交给 agent" onClick={() => onHandoff(m.id)}><IconHandoff /></button>
        <button className={styles.barBtn} title="更多" onClick={(e) => onPopover(m.id, 'menu', e.currentTarget.getBoundingClientRect())}><IconMore /></button>
      </div>}

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
        {gallery ? (
          <Gallery messages={gallery} onImage={onImage} />
        ) : m.runID ? (
          <RunCard message={m} live={m.transient} final={m.transient ? undefined : <Body message={m} onImage={onImage} />} />
        ) : (
          <Body message={m} onImage={onImage} />
        )}
        {m.attachments.length > 0 && <Attachments message={m} onImage={onImage} />}
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
      // 只有附件、没打字的消息：正文是空的，不占一行
      if (!b.text) return null
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

/**
 * 一条消息里的附件：图并排成画廊（按原始尺寸排版，不等图加载），文件是卡。
 * 发送中的那条：图是本机缩略图；回显换成服务端地址时，缩略图铺在底下，真图加载完淡入，不闪。
 */
function Attachments({ message: m, onImage }: { message: Message; onImage(shot: Shot): void }) {
  const imgs = m.attachments.filter((a) => a.kind === 'image')
  const files = m.attachments.filter((a) => a.kind === 'file')
  const sending = m.sendState === 'sending'
  const h = imgs.length <= 2 ? 200 : 150
  return (
    <div className={`${styles.att} ${sending ? styles.attSending : ''}`}>
      {imgs.length > 0 && (
        <div className={styles.gallery}>
          {imgs.map((a, i) => {
            const w = a.natural && a.natural.height > 0 ? Math.min(h * 2, Math.max(Math.round(h * 0.55), Math.round(h * a.natural.width / a.natural.height))) : h
            const under = previewFor(a.url)
            return (
              <button
                key={i} className={styles.galleryItem} title={a.name}
                style={{ width: w, height: h, backgroundImage: under ? `url(${under})` : undefined }}
                onClick={() => { if (!sending) onImage({ url: a.url, name: a.name }) }}
              >
                <img
                  src={a.url} alt={a.name} draggable={false} loading="lazy"
                  className={under ? styles.attFade : undefined}
                  onLoad={(e) => { if (under) e.currentTarget.classList.add(styles.attLoaded ?? '') }}
                />
              </button>
            )
          })}
        </div>
      )}
      {files.map((a, i) => {
        const inner = (
          <>
            <span className={styles.fileIcon}><IconFile /></span>
            <span className={styles.fileText}>
              <span className={styles.fileName}>{a.name}</span>
              <span className={`${styles.fileMeta} mono`}>{sending ? '上传中…' : bytes(a.bytes)}</span>
            </span>
          </>
        )
        return sending
          ? <span key={i} className={styles.file}>{inner}</span>
          : <a key={i} className={styles.file} href={a.url} target="_blank" rel="noreferrer" title="在浏览器里下载">{inner}</a>
      })}
    </div>
  )
}

/** 几张图并排：统一 180 高，按各自比例给宽，装不下就换行。点开全屏。 */
function Gallery({ messages, onImage }: { messages: Message[]; onImage(shot: Shot): void }) {
  // 越多越小：两张 200 高，三张以上 150 高，一般一批能排在一行里
  const h = messages.length <= 2 ? 200 : 150
  return (
    <div className={styles.gallery}>
      {messages.map((m) => {
        if (m.body.kind !== 'picture') return null
        const b = m.body
        const w = b.natural && b.natural.height > 0 ? Math.min(h * 2, Math.max(Math.round(h * 0.55), Math.round(h * b.natural.width / b.natural.height))) : h
        return (
          <button key={m.id} className={styles.galleryItem} style={{ width: w, height: h }} onClick={() => onImage({ url: b.url, name: b.name })} title={b.name}>
            <img src={b.url} alt={b.name} draggable={false} loading="lazy" />
          </button>
        )
      })}
    </div>
  )
}

// ---- harness 形态 ---------------------------------------------------------------------

interface TurnProps {
  message: Message
  gallery?: Message[]
  mine: boolean
  flash: boolean
  onCopy(id: MessageId): void
  onQuote(id: MessageId): void
  onImage(shot: Shot): void
}

const Turn = memo(function Turn({ message: m, gallery, mine, flash, onCopy, onQuote, onImage }: TurnProps) {
  if (mine) {
    // 只有图没有字：泡泡退成透明，图自己就是消息
    const bare = !!gallery || (m.body.kind === 'text' && !m.body.text && m.attachments.length > 0 && !m.quote)
    return (
      <div className={`${styles.turnUser} ${flash ? styles.flash : ''}`}>
        <div className={`${styles.bubble} ${bare ? styles.bubbleGallery : ''}`}>
          {m.quote && <div className={styles.bubbleQuote}>{m.quote.senderName}：{m.quote.excerpt}</div>}
          {gallery ? <Gallery messages={gallery} onImage={onImage} /> : <Body message={m} onImage={onImage} />}
          {m.attachments.length > 0 && <Attachments message={m} onImage={onImage} />}
          {m.sendState === 'sending' && <div className={styles.state}>发送中…</div>}
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
        {gallery ? <Gallery messages={gallery} onImage={onImage} /> : m.runID ? <RunBody message={m} live={m.transient} /> : <Body message={m} onImage={onImage} large />}
        {m.attachments.length > 0 && <Attachments message={m} onImage={onImage} />}
      </div>
      {!m.transient && <div className={styles.turnActions}>
        <button className={styles.turnBtn} title="复制" onClick={() => onCopy(m.id)}><IconCopy /></button>
        <button className={styles.turnBtn} title="引用" onClick={() => onQuote(m.id)}><IconQuote size={14} /></button>
      </div>}
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
