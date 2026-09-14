import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual'
import type { Attachment, Message, MessageId, PixelSize, QuotePreview } from '../../../shared/model'
import { summarize } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconCopy, IconEmoji, IconFile, IconHandoff, IconMore, IconQuote, IconUndo } from '../components/Icons'
import { previewFor, rememberThumb, sized } from '../im/files'
import { visible } from '../im/timeline'
import { flyEmoji } from '../motion/fly'
import { reduceMotion } from '../motion/transition'
import { useAgentProfiles } from '../store/agents'
import { mentionLook } from '../store/mentions'
import type { Place } from '../store/selectors'
import { timeline, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import { Lightbox, type Pic } from './Lightbox'
import { MentionsProvider, Rich } from './rich'
import { GALLERY_MAX_W, galleryLayout, type Box } from './gallery'
import { buildRows, rowHas, type Row, textLines } from './rows'
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

/** 一条图片消息在排布里占的位：只有原始尺寸决定宽度 */
const pictureBox = (m: Message): { natural: PixelSize | null } => ({ natural: m.body.kind === 'picture' ? m.body.natural : null })

// 估高只用于第一次布局，量过之后按真实高度。图片部分和渲染共用 galleryLayout，
// 两边算出来的行数一致，量高之后就不会再把列表推一下。
function estimate(row: Row, available: number): number {
  if (row.kind === 'day') return 46
  if (row.kind === 'pending') return row.message.runID ? 174 : 50
  if (row.kind === 'gallery') return 56 + galleryLayout(row.messages.map(pictureBox), available).height - (row.continued ? 38 : 0)
  const m = row.message
  let h = 56
  h += attachmentsHeight(m.attachments, available)
  if (m.runID) h += 96
  if (m.body.kind === 'text') h += textLines(m.body.text) * 22
  else if (m.body.kind === 'picture') h += (fit(m.body.natural)?.height ?? 220) + 6
  else h += 56
  if (m.quote) h += 36
  if (m.reactions.length) h += 36
  // 续行没有头像和名字那一行
  if (row.continued) h -= 38
  return Math.max(h, 24)
}

/** 附件块的估高：图按画廊的真实排布算，文件卡 58 一张 */
function attachmentsHeight(a: readonly Attachment[], available: number): number {
  const imgs = a.filter((x) => x.kind === 'image')
  let h = 0
  if (imgs.length) h += galleryLayout(imgs, available).height + 6
  const files = a.length - imgs.length
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
/** 正在看的一组图和当前位置：同一条消息里的图算一组，左右键在组里切 */
interface Viewing { items: Pic[]; index: number }
/** 点开一张图：`from` 是被点的那个缩略图，灯箱是从它长大出来的 */
type OpenImage = (viewing: Viewing, from?: HTMLElement) => void

export function Stream({ place }: { place: Place }) {
  const id = place.id
  const harness = place.isAgent
  const tick = useSession((s) => s.tick)
  const me = useSession((s) => s.me)
  // 「正在往上翻」记在这个会话自己的时间线上；tick 变了这里就重读
  const setQuote = useUI((s) => s.setQuote)
  const profiles = useAgentProfiles()
  const agentDesc = harness ? profiles?.find((p) => p.userID === place.peer?.userID)?.description : undefined
  // 谁在这个会话里，决定正文里的 @ 怎么画。引用要稳，不然每渲染一次就把所有 Rich 的 memo 作废
  const roster = useSession((s) => s.roster)
  const myName = useSession((s) => s.myName)
  const look = useMemo(() => mentionLook(place, roster, myName), [place, roster, myName])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick 是时间线的版本号
  const rows = useMemo(() => buildRows(visible(timeline(id).messages)), [id, tick])
  const [popover, setPopover] = useState<Popover | null>(null)
  const [flash, setFlash] = useState<MessageId | null>(null)
  const [shot, setShot] = useState<Viewing | null>(null)
  /** 不在底部时到的新消息：几条、第一条是谁说了什么 */
  const [fresh, setFresh] = useState<{ n: number; who: string; text: string } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const requesting = useRef(false)
  const lastNewest = useRef<string | null>(null)

  // 画廊实际能用多宽：CSS 上限 760，但右栏开着、窗口变窄时更窄。估高按它算，才跟渲染出来的行数对得上。
  const available = useRef(GALLERY_MAX_W)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 减掉行的左右留白和头像那一列
    const measure = (): void => {
      available.current = Math.max(200, Math.min(GALLERY_MAX_W, el.clientWidth - 100))
      // 输入框打多行会把消息区压矮，内容高度没变但视口变了：贴着底就得重新贴一次，
      // 否则最后一条会被输入框推到看不见的地方
      if (atBottom.current) el.scrollTop = el.scrollHeight
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' })
  }, [])

  // 新消息到了：我自己发的直接跟到底；别人的、我不在底部时记下来给药丸
  useEffect(() => {
    const m = timeline(id).newest
    const prev = lastNewest.current
    lastNewest.current = m?.id ?? null
    if (!m || prev === null || m.id === prev || m.transient) return
    if (m.sender === me) { scrollToBottom(false); setFresh(null); return }
    if (!atBottom.current) setFresh((f) => ({ n: (f?.n ?? 0) + 1, who: f?.who ?? m.senderName, text: f?.text ?? summarize(m) }))
  }, [tick, id, me, scrollToBottom])

  // 灯箱：开合的放大动画由 react-photo-view 按缩略图（data-shot）驱动，这里只管开和关
  const openShot = useCallback<OpenImage>((v) => { if (v.items.length > 0) setShot(v) }, [])
  const closeShot = useCallback(() => setShot(null), [])

  // 第一页：点会话打开的路径已经在拉了，这里兜住另一条——重启后从上次的会话直接挂上来，
  // 没人点过它。ensure 是幂等的，拉过就不会再拉。
  useEffect(() => { void useSession.getState().ensure(id) }, [id])

  // 进场动效。第一批到屏幕上的行按从上到下的次序错开 22ms 依次浮起——"瀑布"；
  // 之后新来的消息各自浮起一次；往上翻出来的历史不动（它不是新东西）。
  // 每行的延迟只在第一次渲染时定下来，之后不改：改动 animation-delay 会让动画重放。
  const firstRowsAt = useRef<number | null>(null)
  const initial = useRef<{ keys: Set<string>; newestAt: number } | null>(null)
  const enterDelay = useRef(new Map<string, number>())
  // 播完就记下来。虚拟列表会把滚出视口的行卸载、滚回来再挂载，不记的话滚一趟屏要重播几十次入场动画。
  // 记在实例上：换会话时 Stream 整个重新挂载，进场的瀑布照旧。
  const played = useRef(new Set<string>())
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
    if (played.current.has(row.key)) return { cls: '', style: {} }
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
    estimateSize: (i) => estimate(rows[i]!, available.current),
    getItemKey: (i) => rows[i]!.key,
    overscan: 8,
    scrollMargin: TOP_PAD,
  })
  // 量高之后要不要补滚动位置，交给库自己判断，别覆盖。
  // 它区分两种情况：第一次量高按「行首在视口之上」补（估高换成真高，整块都在上面）；
  // 重新量高只补「整行都在视口之上」的，并且向上滚时不补。我们原来的覆盖只看行首，
  // 结果一条横跨视口顶部的长消息（agent 边写边长）在底部增长时也会被补，把正在读的内容往上推。
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
    if (atBottom.current) setFresh((f) => (f ? null : f))
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
    <MentionsProvider value={look}>
    <div className={styles.wrap} style={{ viewTransitionName: 'conv-stream' }}>
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
                  {/* 动效放在内层：外层的 transform 是虚拟列表的定位，动画一碰它整列就叠到一起。
                      播完才记账——中途重渲染不会把 class 撤掉，动画不会被打断。 */}
                  <div
                    className={motion.cls}
                    style={motion.style}
                    onAnimationEnd={(e) => { if (e.target === e.currentTarget) played.current.add(row.key) }}
                  >
                  {row.kind === 'day' ? (
                    <DaySep label={row.label} />
                  ) : row.kind === 'pending' && !row.message.runID ? (
                    <Pending message={row.message} harness={harness} />
                  ) : row.kind === 'gallery' ? (
                    harness ? (
                      <Turn message={row.messages[0]!} gallery={row.messages} mine={row.messages[0]!.sender === me} flash={row.messages.some((m) => m.id === flash)} onCopy={copy} onQuote={quote} onImage={openShot} />
                    ) : (
                      <MessageRow
                        message={row.messages[0]!}
                        gallery={row.messages}
                        continued={row.continued}
                        mine={row.messages[0]!.sender === me}
                        pinned={popover?.id === row.messages[0]!.id}
                        flash={row.messages.some((m) => m.id === flash)}
                        onReact={react} onQuote={quote} onHandoff={handoff} onJump={jump} onImage={openShot} onPopover={openPopover}
                      />
                    )
                  ) : harness ? (
                    <Turn message={row.message} mine={row.message.sender === me} flash={flash === row.message.id} onCopy={copy} onQuote={quote} onImage={openShot} />
                  ) : (
                    <MessageRow
                      message={row.message}
                      continued={row.kind === 'msg' && row.continued}
                      mine={row.message.sender === me}
                      pinned={popover?.id === row.message.id}
                      flash={flash === row.message.id}
                      onReact={react} onQuote={quote} onHandoff={handoff} onJump={jump} onImage={openShot} onPopover={openPopover}
                    />
                  )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {timeline(id).loadingOlder && <div className={styles.loadingPill}>加载更早的消息…</div>}
      {fresh && (
        <button className={styles.newPill} onClick={() => scrollToBottom(true)}>
          <span>↓ {fresh.n} 条新消息</span>
          <span className={styles.newPillWho}>{fresh.who}：{fresh.text}</span>
        </button>
      )}
      {popover && (
        <PopoverLayer
          popover={popover}
          mine={timeline(id).get(popover.id)?.sender === me}
          onClose={closePopover} onReact={react} onQuote={quote} onCopy={copy} onRevoke={revoke}
        />
      )}
      {shot && (
        <Lightbox
          items={shot.items}
          index={shot.index}
          onIndex={(i) => setShot((v) => (v ? { ...v, index: i } : v))}
          onClose={closeShot}
        />
      )}
    </div>
    </MentionsProvider>
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
  return <Avatar glyph={glyphOf(name)} pair={pairOf(id)} size={size} kind={agent ? 'agent' : 'human'} id={id} src={current ?? fallback} style={style} />
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
      <SenderAvatar id={m.sender} name={m.senderName} fallback={m.senderAvatar} size={harness ? 28 : 34} agent={m.isAgent} />
      <div className={styles.shimmer} />
    </div>
  )
}

interface RowProps {
  message: Message
  /** 同一个人连着发的几张图：并成一行画廊 */
  gallery?: Message[]
  /** 紧接着上一行、同一个人在说：省掉头像和名字，悬停才看时间 */
  continued?: boolean
  mine: boolean
  pinned: boolean
  flash: boolean
  onReact(id: MessageId, emoji: string): void
  onQuote(id: MessageId): void
  onHandoff(id: MessageId): void
  onJump(id: MessageId): void
  onImage: OpenImage
  onPopover: Anchor
}

const MessageRow = memo(function MessageRow({ message: m, gallery, continued = false, pinned, flash, onReact, onQuote, onHandoff, onJump, onImage, onPopover }: RowProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cls = [styles.row, continued && styles.cont, pinned && styles.pinned, flash && styles.flash, m.mentionsMe && styles.mentioned].filter(Boolean).join(' ')
  // 表情先从按钮飞到回应行再发出去：飞到一半回显就到了，网络那几百毫秒感觉不到
  const reactFrom = (emoji: string, from: HTMLElement): void => {
    const to = rootRef.current?.querySelector('[data-rx]') ?? rootRef.current?.querySelector('[data-body]')
    if (to) flyEmoji(emoji, from.getBoundingClientRect(), to.getBoundingClientRect())
    onReact(m.id, emoji)
  }
  return (
    <div className={cls} ref={rootRef} data-mid={m.id}>
      {!m.transient && <div className={styles.bar}>
        {QUICK.map((e) => (
          <button key={e} className={styles.barEmoji} title={e === '👍' ? '赞' : e === '✅' ? '搞定' : '在看'} onClick={(ev) => reactFrom(e, ev.currentTarget)}>{e}</button>
        ))}
        <span className={styles.barSep} />
        <button className={styles.barBtn} title="添加表情" onClick={(e) => onPopover(m.id, 'picker', e.currentTarget.getBoundingClientRect())}><IconEmoji /></button>
        <button className={styles.barBtn} title="引用回复" onClick={() => onQuote(m.id)}><IconQuote /></button>
        <button className={`${styles.barBtn} ${styles.barAgent}`} title="转交给 agent" onClick={() => onHandoff(m.id)}><IconHandoff /></button>
        <button className={styles.barBtn} title="更多" onClick={(e) => onPopover(m.id, 'menu', e.currentTarget.getBoundingClientRect())}><IconMore /></button>
      </div>}

      {continued ? (
        <span className={styles.gut}><span className={`${styles.gutTime} mono`}>{m.sendState === 'sending' ? '…' : hhmm(m.sentAt)}</span></span>
      ) : (
        <SenderAvatar id={m.sender} name={m.senderName} fallback={m.senderAvatar} size={34} agent={m.isAgent} style={{ marginTop: 1 }} />
      )}
      <div className={styles.content} data-body>
        {!continued && <div className={styles.meta}>
          <span className={styles.who}>{m.senderName}</span>
          {m.isAgent && <span className={`${styles.tag} mono`}>{m.agentTag || 'AGENT'}</span>}
          <span className={`${styles.time} mono`}>{hhmm(m.sentAt)}</span>
          {m.sendState === 'sending' && <span className={styles.state}>· 发送中</span>}
          {m.sendState === 'failed' && <span className={`${styles.state} ${styles.stateBad}`}>· 没发出去</span>}
        </div>}
        {continued && m.sendState === 'failed' && <div className={styles.stateBad}>没发出去</div>}
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
          <div className={styles.rx} data-rx>
            {m.reactions.map((r) => (
              <button key={r.emoji} className={`${styles.chip} ${r.mine ? styles.chipMine : ''}`} onClick={(ev) => (r.mine ? onReact(m.id, r.emoji) : reactFrom(r.emoji, ev.currentTarget))}>
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

function Body({ message: m, onImage, large }: { message: Message; onImage: OpenImage; large?: boolean }) {
  const b = m.body
  switch (b.kind) {
    case 'text':
      // 只有附件、没打字的消息：正文是空的，不占一行
      if (!b.text) return null
      return (
        <div className={`${styles.text} ${large ? styles.textLg : ''}`}>
          <Rich text={b.text} />
        </div>
      )
    case 'picture': {
      const box = fit(b.natural) ?? { width: 320, height: 240 }
      const one = [{ url: b.url, name: b.name, natural: b.natural, bytes: b.bytes }]
      return <Shot url={b.url} name={b.name} box={{ w: box.width, h: box.height }} busy={m.sendState === 'sending'} group={one} onImage={onImage} />
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
 * 一条消息里的附件：图并排成画廊，文件是卡。
 *
 * 三个阶段分开表达：上传中图上有一道扫光；消息确认后扫光撤掉；清晰图解码完才淡入。
 * 发的人上传期间看到的是本机缩略图，回显换成服务端地址时缩略图铺在底下，不闪。
 */
function Attachments({ message: m, onImage }: { message: Message; onImage: OpenImage }) {
  const imgs = m.attachments.filter((a) => a.kind === 'image')
  const files = m.attachments.filter((a) => a.kind === 'file')
  const sending = m.sendState === 'sending'
  const { boxes } = galleryLayout(imgs)
  return (
    <div className={styles.att}>
      {imgs.length > 0 && (
        <div className={styles.gallery}>
          {imgs.map((a, i) => (
            <Shot key={a.url} url={a.url} name={a.name} box={boxes[i]!} busy={sending} group={imgs} onImage={onImage} />
          ))}
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

/** 同一个人连着发的几张图并排成一行。宽高在图到之前就定好，点开看原图。 */
function Gallery({ messages, onImage }: { messages: Message[]; onImage: OpenImage }) {
  const pics = messages.flatMap((m) => (m.body.kind === 'picture'
    ? [{ id: m.id, url: m.body.url, name: m.body.name, natural: m.body.natural, bytes: m.body.bytes }]
    : []))
  const { boxes } = galleryLayout(pics)
  return (
    <div className={styles.gallery}>
      {pics.map((p, i) => (
        <Shot key={p.url} url={p.url} name={p.name} box={boxes[i]!} busy={false} group={pics} onImage={onImage} />
      ))}
    </div>
  )
}

/** 屏幕的像素密度。列表里按槽位乘它取图，2 倍屏不糊，也不会去下一张 4000 宽的原图。 */
const DPR = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1)
/** 重试时换一个地址，不然浏览器会直接复用上一次失败的结果 */
const retryOf = (url: string, n: number): string => (n === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}_r=${n}`)

/**
 * 消息里的一张图。
 *
 * 框的尺寸在图到之前就定下来——发送时量过原始尺寸，收到的消息里也带着——所以图加载完不会把列表推开。
 * 列表里请求的是按槽位裁过的尺寸，点开才取原图；裁过的地址取不到就退回原图，再取不到就地给重试。
 */
function Shot({ url, name, box, busy, group, onImage }: { url: string; name: string; box: Box; busy: boolean; group: readonly Pic[]; onImage: OpenImage }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const [src, setSrc] = useState(() => sized(url, Math.max(box.w, box.h) * DPR))
  const [nonce, setNonce] = useState(0)
  const under = previewFor(url)
  return (
    <button
      className={`${styles.shot} ${busy ? styles.shotBusy : ''}`}
      style={{ width: box.w, height: box.h, backgroundImage: under ? `url("${under}")` : undefined }}
      title={name}
      data-shot={url}
      onClick={(e) => {
        if (busy) return
        if (state === 'failed') { setState('loading'); setNonce((n) => n + 1); return }
        const i = group.findIndex((g) => g.url === url)
        onImage({ items: [...group], index: i < 0 ? 0 : i }, e.currentTarget)
      }}
    >
      <img
        src={retryOf(src, nonce)} alt={name} draggable={false} loading="lazy"
        className={state === 'ok' ? styles.shotIn : styles.shotOut}
        onLoad={() => { setState('ok'); rememberThumb(url, src) }}
        onError={() => { if (src !== url) { setSrc(url); setState('loading') } else setState('failed') }}
      />
      {state === 'failed' && <span className={styles.shotFail}>图片没加载出来<br />点一下重试</span>}
    </button>
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
  onImage: OpenImage
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
        <SenderAvatar id={m.sender} name={m.senderName} fallback={m.senderAvatar} size={28} agent={m.isAgent} />
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
                <button key={e} className={styles.emojiBtn} onClick={(ev) => {
                  const row = document.querySelector(`[data-mid="${CSS.escape(popover.id)}"]`)
                  const to = row?.querySelector('[data-rx]') ?? row?.querySelector('[data-body]')
                  if (to) flyEmoji(e, ev.currentTarget.getBoundingClientRect(), to.getBoundingClientRect())
                  onReact(popover.id, e); onClose()
                }}>{e}</button>
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
