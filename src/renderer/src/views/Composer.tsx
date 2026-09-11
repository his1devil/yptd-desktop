import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { plainText } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconClose, IconImage, IconPaperclip } from '../components/Icons'
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
  const ref = useRef<HTMLTextAreaElement>(null)

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

  const send = useCallback(() => {
    const text = draft.replace(/\s+$/, '').replace(/^\n+/, '')
    if (!text.trim()) return
    const ids = candidates.filter((c) => text.includes(`@${c.name}`)).map((c) => c.id)
    void useSession.getState().send(id, text, { quote: quoteId ?? undefined, mentions: ids.length ? ids : undefined })
    setDraft('')
    drafts.delete(id)
    if (quoteId) setQuote(id, null)
    setMenu(null)
  }, [draft, candidates, id, quoteId, setQuote])

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
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    for (const f of files) {
      void f.arrayBuffer()
        .then((buf) => window.desktop.files.stash(f.name || `pasted-${Date.now()}.png`, buf))
        .then((path) => useSession.getState().sendPicture(id, path))
    }
  }

  const attach = async (kind: 'image' | 'any'): Promise<void> => {
    const paths = await window.desktop.files.pick(kind)
    for (const p of paths) {
      const name = p.split('/').pop() ?? p
      if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) void useSession.getState().sendPicture(id, p)
      else void useSession.getState().sendFile(id, p, name)
    }
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
          <button className={styles.send} disabled={!draft.trim()} onClick={send}>发送</button>
        </div>
      </div>
    </div>
  )
}
