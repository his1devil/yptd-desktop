import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { summarize, type OutgoingAttachment } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconClose, IconFile, IconImage, IconPaperclip } from '../components/Icons'
import { IMAGE_EXT, mimeOf } from '../im/files'
import { mentionables, type Mentionable, type Place } from '../store/selectors'
import { agentsOf, timeline, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import styles from './Composer.module.css'

/**
 * 输入框。Enter 发送、Shift+Enter 换行、中文输入法组字时的 Enter 不算；
 * 打 @ 出人和 agent 的候选；粘贴/拖入图片直接发；引用条来自悬浮条的「引用回复」。
 *
 * 父组件按会话 key 挂载它，草稿存在模块级的 Map 里，切走再切回来还在。
 */
const drafts = new Map<string, string>()
const MAX_LINES = 8
const LINE = 22

interface Menu { start: number; query: string; index: number }

/** 附件栏里的一项：图片带缩略图和原始尺寸，文件带名字和大小；都已经有本机路径，发送时交给 SDK */
type Attachment = OutgoingAttachment & { id: string }
let nextAttachment = 1
const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export function Composer({ place }: { place: Place }) {
  const id = place.id
  const roster = useSession((s) => s.roster)
  const me = useSession((s) => s.me)
  const tick = useSession((s) => s.tick)
  const quoteId = useUI((s) => s.quoteBy[id] ?? null)
  const setQuote = useUI((s) => s.setQuote)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick 是时间线的版本号
  const quoted = useMemo(() => (quoteId ? timeline(id).get(quoteId) ?? null : null), [id, quoteId, tick])

  const [draft, setDraft] = useState(() => drafts.get(id) ?? '')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // ---- 附件：先进栏，看一眼、配上字再发 ----
  // 主进程量一次：图给缩略图和原始尺寸，文件给大小。缩略图既是栏里的预览，也是发出去那一刻消息里先显示的图
  const probe = async (path: string, name: string, mime: string): Promise<Attachment> => {
    const info = await window.desktop.files.thumbnail(path)
    const image = !!info?.dataURL
    return {
      id: `a${nextAttachment++}`, kind: image ? 'image' : 'file', name, path, mime,
      bytes: info?.bytes ?? 0, natural: image && info ? { width: info.width, height: info.height } : null, preview: image && info ? info.dataURL : null,
    }
  }
  const addPaths = useCallback(async (paths: string[]) => {
    const items: Attachment[] = []
    for (const path of paths) {
      const name = path.split('/').pop() ?? path
      items.push(await probe(path, name, mimeOf(name)))
    }
    setAttachments((cur) => [...cur, ...items])
  }, [])
  const addFiles = useCallback(async (files: File[]) => {
    const items: Attachment[] = []
    for (const f of files) {
      // 拖进来的有真实路径；粘贴板里的没有，先落成临时文件
      let path = window.desktop.files.pathFor(f)
      if (!path) path = await window.desktop.files.stash(f.name || `pasted-${Date.now()}.png`, await f.arrayBuffer())
      const name = f.name || (path.split('/').pop() ?? '文件')
      const item = await probe(path, name, f.type || mimeOf(name))
      items.push(f.size && !item.bytes ? { ...item, bytes: f.size } : item)
    }
    setAttachments((cur) => [...cur, ...items])
  }, [])
  const removeAttachment = (aid: string): void => setAttachments((cur) => cur.filter((a) => a.id !== aid))
  useEffect(() => composerBus.onAttach((files) => { void addFiles(files) }), [addFiles])
  // 没发出去的那条整个回来，改一改再发
  useEffect(() => composerBus.onRestore((cid, d) => {
    if (cid !== id) return
    setDraft(d.text)
    setAttachments(d.attachments.map((a) => ({ ...a, id: `a${nextAttachment++}` })))
    if (d.quote) setQuote(id, d.quote)
  }), [id, setQuote])

  useEffect(() => { drafts.set(id, draft) }, [id, draft])

  // 自适应高度，最多 8 行；行数变了高度是过渡过去的（发出去那一下从三行收回一行不跳）
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const prev = el.style.height
    // 量之前必须把过渡关掉。带着过渡把高度设成 0 不会立刻生效，量到的是动画中途那个还很高的
    // 盒子，算出来的目标只会比现在大——多行消息发出去之后输入框就再也收不回来了。
    el.style.transition = 'none'
    el.style.height = '0px'
    const target = `${Math.min(el.scrollHeight, LINE * MAX_LINES + 24)}px`
    // 回到旧高度并让浏览器记住它，恢复过渡后设新高度才有起点可走
    el.style.height = prev || target
    void el.offsetHeight
    el.style.transition = ''
    el.style.height = target
  }, [draft])

  const candidates = useMemo(() => mentionables(place, roster, me), [place, roster, me])
  const filtered = useMemo(() => {
    if (!menu) return []
    const q = menu.query.toLowerCase()
    return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8)
  }, [menu, candidates])

  // 光标前是不是一个未闭合的 @词
  const detectMenu = useCallback((el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length)
    const m = /(^|[\s(（,，:：])@([^\s@]{0,20})$/.exec(before)
    if (!m) { setMenu(null); return }
    const query = m[2] ?? ''
    setMenu((cur) => ({ start: before.length - query.length - 1, query, index: cur && cur.query === query ? cur.index : 0 }))
  }, [])

  const insertAt = useCallback((text: string, replaceFrom?: number) => {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart ?? el.value.length
    const from = replaceFrom ?? caret
    const before = el.value.slice(0, from)
    const after = el.value.slice(el.selectionEnd ?? caret)
    const sep = replaceFrom === undefined && before && !/\s$/.test(before) ? ' ' : ''
    const head = before + sep + text
    setDraft(head + after)
    setMenu(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(head.length, head.length)
      if (text === '@') detectMenu(el)
    })
  }, [detectMenu])

  useEffect(() => composerBus.subscribe((text) => (text ? insertAt(text) : ref.current?.focus())), [insertAt])

  const pick = useCallback((c: Mentionable) => { if (menu) insertAt(`@${c.name} `, menu.start) }, [menu, insertAt])

  // 文字和附件是一条消息。带附件的那条先在消息流里出现（发送中），上传完换成真的；输入框立刻可以接着打
  const send = useCallback(() => {
    const text = draft.replace(/\s+$/, '').replace(/^\n+/, '')
    if (!text.trim() && attachments.length === 0) return
    if (sending) return
    const ids = candidates.filter((c) => text.includes(`@${c.name}`)).map((c) => c.id)
    const batch = attachments.map(({ id: _id, ...a }) => a)
    setDraft('')
    drafts.delete(id)
    setAttachments([])
    if (quoteId) setQuote(id, null)
    setMenu(null)
    const s = useSession.getState()
    const opts = { quote: quoteId ?? undefined, mentions: ids.length ? ids : undefined }
    if (batch.length) { void s.sendRich(id, text, { ...opts, attachments: batch }); return }
    setSending(true)
    void s.send(id, text, opts).finally(() => setSending(false))
  }, [draft, attachments, sending, candidates, id, quoteId, setQuote])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menu && filtered.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % filtered.length }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + filtered.length) % filtered.length }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(filtered[menu.index] ?? filtered[0]!); return }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return }
    }
    if (e.key === 'Escape' && quoteId) { setQuote(id, null); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...e.clipboardData.files]
    if (!files.length) return
    e.preventDefault()
    void addFiles(files)
  }

  const attach = async (kind: 'image' | 'any'): Promise<void> => {
    const paths = await window.desktop.files.pick(kind)
    if (paths.length) await addPaths(paths)
  }

  const agents = place.kind === 'channel' ? agentsOf(roster) : []
  const hint = place.isAgent
    ? `和 ${place.title} 对话 — 直接派活或追问`
    : place.kind === 'channel'
      ? `发消息到 #${place.title} — @agent 可直接派活`
      : `发消息给 ${place.title}`

  return (
    <div className={styles.wrap}>
      <div className={styles.box}>
        {agents.length > 0 && (
          <div className={styles.chips}>
            {agents.map((a) => (
              <button key={a.userID} className={styles.chip} onClick={() => insertAt(`@${a.nickname} `)} title={`@${a.nickname}`}>
                <span className={styles.chipGlyph}>{glyphOf(a.nickname)}</span>{a.nickname}
              </button>
            ))}
            <span className={styles.chipsHint}>@ 点名 agent 就是派活</span>
          </div>
        )}

        {quoted && (
          <div className={styles.quoteBar}>
            <span className={styles.quoteRule} />
            <Avatar glyph={glyphOf(quoted.senderName)} pair={pairOf(quoted.sender)} size={20} kind={quoted.isAgent ? 'agent' : 'human'} src={quoted.senderAvatar} />
            <div className={styles.quoteText}>
              <div className={styles.quoteWho}>引用 {quoted.senderName}</div>
              <div className={styles.quoteExcerpt}>{summarize(quoted).replace(/\s*\n\s*/g, ' ')}</div>
            </div>
            <button className={styles.quoteClose} title="取消引用" onClick={() => setQuote(id, null)}><IconClose /></button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className={styles.tray}>
            {attachments.map((a) => (
              <div key={a.id} className={a.kind === 'image' ? styles.thumb : styles.fileChip} title={a.name}>
                {a.kind === 'image' && a.preview ? (
                  <img src={a.preview} alt={a.name} draggable={false} />
                ) : (
                  <>
                    <span className={styles.fileIcon}><IconFile size={16} /></span>
                    <span className={styles.fileText}>
                      <span className={styles.fileName}>{a.name}</span>
                      {a.bytes > 0 && <span className={`${styles.fileMeta} mono`}>{fmtBytes(a.bytes)}</span>}
                    </span>
                  </>
                )}
                <button className={styles.remove} title="去掉" onClick={() => removeAttachment(a.id)}><IconClose size={9} /></button>
              </div>
            ))}
            <span className={styles.trayHint}>
              {attachments.filter((a) => a.kind === 'image').length ? `${attachments.filter((a) => a.kind === 'image').length} 张图` : ''}
              {attachments.some((a) => a.kind === 'file') ? `${attachments.filter((a) => a.kind === 'image').length ? ' · ' : ''}${attachments.filter((a) => a.kind === 'file').length} 个文件` : ''}
              {' · 和文字一起发'}
            </span>
          </div>
        )}

        <div className={styles.field}>
          {menu && filtered.length > 0 && (
            <div className={styles.menu}>
              {filtered.map((c, i) => (
                <button
                  key={c.id}
                  className={`${styles.menuItem} ${i === menu.index ? styles.menuActive : ''}`}
                  onMouseEnter={() => setMenu({ ...menu, index: i })}
                  onMouseDown={(e) => { e.preventDefault(); pick(c) }}
                >
                  <Avatar glyph={glyphOf(c.name)} pair={pairOf(c.id)} size={22} kind={c.isAgent ? 'agent' : 'human'} src={c.avatar} />
                  <span className={styles.menuName}>{c.name}</span>
                  {c.isAgent && <span className={`${styles.menuTag} mono`}>{c.tag || 'AGENT'}</span>}
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={ref}
            className={styles.input}
            value={draft}
            rows={1}
            placeholder={hint}
            onChange={(e) => { setDraft(e.target.value); detectMenu(e.target) }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detectMenu(e.currentTarget) }}
            onClick={(e) => detectMenu(e.currentTarget)}
            onPaste={onPaste}
            onBlur={() => window.setTimeout(() => setMenu(null), 120)}
            spellCheck={false}
          />
        </div>

        <div className={styles.foot}>
          <button className={styles.footBtn} title="发图片" onClick={() => void attach('image')}><IconImage /></button>
          <button className={styles.footBtn} title="发文件" onClick={() => void attach('any')}><IconPaperclip /></button>
          <span className={styles.spacer} />
          <span className={`${styles.footHint} mono`}>Enter 发送 · Shift+Enter 换行</span>
          <button className={styles.send} disabled={(!draft.trim() && attachments.length === 0) || sending} onClick={send}>{sending ? '发送中…' : '发送'}</button>
        </div>
      </div>
    </div>
  )
}
