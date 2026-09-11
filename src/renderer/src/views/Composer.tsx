import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { plainText } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconClose, IconFile, IconImage, IconPaperclip } from '../components/Icons'
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

/** 附件栏里的一项：图片带缩略图，文件带名字和大小；都已经有本机路径，发送时交给 SDK */
interface Attachment { id: string; kind: 'image' | 'file'; name: string; path: string; bytes: number; preview: string | null }
let nextAttachment = 1
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic)$/i
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
  const addPaths = useCallback(async (paths: string[]) => {
    const items: Attachment[] = []
    for (const path of paths) {
      const name = path.split('/').pop() ?? path
      const image = IMAGE_EXT.test(name)
      const thumb = image ? await window.desktop.files.thumbnail(path) : null
      items.push({ id: `a${nextAttachment++}`, kind: image && thumb ? 'image' : 'file', name, path, bytes: thumb?.bytes ?? 0, preview: thumb?.dataURL ?? null })
    }
    setAttachments((cur) => [...cur, ...items])
  }, [])
  const addFiles = useCallback(async (files: File[]) => {
    const items: Attachment[] = []
    for (const f of files) {
      // 拖进来的有真实路径；粘贴板里的没有，先落成临时文件
      let path = window.desktop.files.pathFor(f)
      if (!path) path = await window.desktop.files.stash(f.name || `pasted-${Date.now()}.png`, await f.arrayBuffer())
      const image = f.type.startsWith('image/')
      items.push({ id: `a${nextAttachment++}`, kind: image ? 'image' : 'file', name: f.name || (path.split('/').pop() ?? '文件'), path, bytes: f.size, preview: image ? URL.createObjectURL(f) : null })
    }
    setAttachments((cur) => [...cur, ...items])
  }, [])
  const removeAttachment = (aid: string): void => setAttachments((cur) => {
    const gone = cur.find((a) => a.id === aid)
    if (gone?.preview?.startsWith('blob:')) URL.revokeObjectURL(gone.preview)
    return cur.filter((a) => a.id !== aid)
  })
  useEffect(() => composerBus.onAttach((files) => { void addFiles(files) }), [addFiles])

  useEffect(() => { drafts.set(id, draft) }, [id, draft])

  // 自适应高度，最多 8 行
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, LINE * MAX_LINES + 24)}px`
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

  // 文字和附件一起发：文字一条，图片和文件各一条，按栏里的顺序依次发，连着的图会并成一行
  const send = useCallback(() => {
    const text = draft.replace(/\s+$/, '').replace(/^\n+/, '')
    if (!text.trim() && attachments.length === 0) return
    if (sending) return
    const ids = candidates.filter((c) => text.includes(`@${c.name}`)).map((c) => c.id)
    const batch = attachments
    setDraft('')
    drafts.delete(id)
    setAttachments([])
    if (quoteId) setQuote(id, null)
    setMenu(null)
    setSending(true)
    void (async () => {
      const s = useSession.getState()
      if (text.trim()) await s.send(id, text, { quote: quoteId ?? undefined, mentions: ids.length ? ids : undefined })
      for (const a of batch) {
        if (a.kind === 'image') await s.sendPicture(id, a.path)
        else await s.sendFile(id, a.path, a.name)
        if (a.preview?.startsWith('blob:')) URL.revokeObjectURL(a.preview)
      }
    })().finally(() => setSending(false))
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
              <div className={styles.quoteExcerpt}>{plainText(quoted.body).replace(/\s*\n\s*/g, ' ')}</div>
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
