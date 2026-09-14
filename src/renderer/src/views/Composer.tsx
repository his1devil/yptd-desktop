import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { summarize, type OutgoingAttachment } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { IconClose, IconFile, IconImage, IconPaperclip } from '../components/Icons'
import { mimeOf } from '../im/files'
import { mentionables } from '../store/mentions'
import type { Place } from '../store/selectors'
import { timeline, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import { MessageEditor, type EditorApi } from './editor/MessageEditor'
import { isEmpty, type Segment } from './editor/state'
import styles from './Composer.module.css'

/**
 * 输入框。Enter 发送、Shift+Enter 换行、中文输入法组字时的 Enter 不算；
 * 打 @ 出人和 agent 的候选，选中后是一个原子色块；粘贴/拖入的图先进附件栏。
 *
 * 正文走 Lexical 的纯文本模式（见 editor/）：markdown 在框里是字面文本，发出去才渲染，
 * 和 Discord 一样——这样 agent 收到的就是人打的原文。
 *
 * 父组件按会话 key 挂载它，草稿存在模块级的 Map 里，切走再切回来还在。
 */
const drafts = new Map<string, Segment[]>()

/** 附件栏里的一项：图片带缩略图和原始尺寸，文件带名字和大小；都已经有本机路径，发送时交给 SDK */
type Attachment = OutgoingAttachment & { id: string }
let nextAttachment = 1
/** 一次发送尝试的编号。只用来把失败回填认到对的那一条上，不出这个模块。 */
let nextToken = 1
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

  const editor = useRef<EditorApi | null>(null)
  const [segments, setSegments] = useState<Segment[]>(() => drafts.get(id) ?? [])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [sending, setSending] = useState(false)
  // 每一次发送尝试的片段，按 token 记。带附件的发送不等结果就返回，所以同一个会话
  // 可以有好几条同时在路上；只记「最近一次」的话，先发的那条失败时回填进来的会是后发
  // 那条的正文和 @——人会看到自己没打过的字，还可能 @ 错人。
  const attempted = useRef(new Map<string, Segment[]>())

  // 草稿：每次变更记下来，切走再切回来还在
  useEffect(() => { drafts.set(id, segments) }, [id, segments])
  // 挂载时把上次的草稿放回去
  useEffect(() => {
    const saved = drafts.get(id)
    if (saved && saved.length) editor.current?.load(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在这个会话第一次挂载时还原
  }, [id])

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
    for (const path of paths) items.push(await probe(path, path.split('/').pop() ?? path, mimeOf(path.split('/').pop() ?? path)))
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
  useEffect(() => composerBus.subscribe((text) => (text ? editor.current?.insert(text) : editor.current?.focus())), [])
  // 没发出去的那条整个回来，改一改再发
  useEffect(() => composerBus.onRestore((cid, d) => {
    if (cid !== id) return
    // 优先用发送时留下的片段：压成纯文本的话 @ 色块会退化成字面文字，
    // 重发时 mentions 是空的，被 @ 的人收不到提醒也不会高亮。
    // 按 token 认领，认的是失败的那一条，不是最后发的那一条。
    const back = d.token ? attempted.current.get(d.token) : undefined
    if (d.token) attempted.current.delete(d.token)
    editor.current?.load(back ?? (d.text ? [{ t: 'text', v: d.text }] : []))
    setAttachments(d.attachments.map((a) => ({ ...a, id: `a${nextAttachment++}` })))
    if (d.quote) setQuote(id, d.quote)
  }), [id, setQuote])

  const candidates = useMemo(() => mentionables(place, roster, me), [place, roster, me])

  // 文字和附件是一条消息。带附件的那条先在消息流里出现（发送中），上传完换成真的；输入框立刻可以接着打
  const send = useCallback(() => {
    if (sending) return
    const composed = editor.current?.read() ?? { text: '', mentions: [] }
    const text = composed.text.replace(/\s+$/, '').replace(/^\n+/, '')
    if (!text.trim() && attachments.length === 0) return
    const batch = attachments.map(({ id: _id, ...a }) => a)
    const token = `d${nextToken++}`
    const draft = editor.current?.draft()
    if (draft) {
      attempted.current.set(token, draft)
      // 发成功的那些没人会来认领。在途的从来不会有几条，留个上限就够，
      // 满了丢最早的——最坏也只是退回纯文本回填，就是修之前的行为。
      if (attempted.current.size > 8) attempted.current.delete(attempted.current.keys().next().value!)
    }
    editor.current?.clear()
    setSegments([])
    drafts.delete(id)
    setAttachments([])
    if (quoteId) setQuote(id, null)
    const s = useSession.getState()
    const opts = { quote: quoteId ?? undefined, mentions: composed.mentions.length ? composed.mentions : undefined, draftToken: token }
    if (batch.length) { void s.sendRich(id, text, { ...opts, attachments: batch }); return }
    setSending(true)
    void s.send(id, text, opts).finally(() => setSending(false))
  }, [attachments, sending, id, quoteId, setQuote])

  const attach = async (kind: 'image' | 'any'): Promise<void> => {
    const paths = await window.desktop.files.pick(kind)
    if (paths.length) await addPaths(paths)
  }

  // 频道里有 agent 才提 agent：不在群里的 agent @ 不到，提了是空头支票
  const hasAgent = place.kind === 'channel' && place.members.some((m) => m.isAgent)
  const hint = place.isAgent
    ? `和 ${place.title} 对话 — 直接派活或追问`
    : place.kind === 'channel'
      ? hasAgent ? `发消息到 #${place.title} — 试试 @ agent 伙伴` : `发消息到 #${place.title}`
      : `发消息给 ${place.title}`
  const nothingToSend = isEmpty(segments) && attachments.length === 0

  return (
    <div className={styles.wrap}>
      <div className={styles.box}>
        {quoted && (
          <div className={styles.quoteBar}>
            <span className={styles.quoteRule} />
            <Avatar glyph={glyphOf(quoted.senderName)} pair={pairOf(quoted.sender)} size={20} id={quoted.sender} kind={quoted.isAgent ? 'agent' : 'human'} src={quoted.senderAvatar} />
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
          <MessageEditor
            api={editor}
            placeholder={hint}
            candidates={candidates}
            onChange={setSegments}
            onSend={send}
            onEscape={() => { if (quoteId) setQuote(id, null) }}
            onFiles={(files) => { void addFiles(files) }}
          />
        </div>

        <div className={styles.foot}>
          <button className={styles.footBtn} title="发图片" onClick={() => void attach('image')}><IconImage /></button>
          <button className={styles.footBtn} title="发文件" onClick={() => void attach('any')}><IconPaperclip /></button>
          <span className={styles.spacer} />
          <span className={`${styles.footHint} mono`}>Enter 发送 · Shift+Enter 换行</span>
          <button className={styles.send} disabled={nothingToSend || sending} onClick={send}>{sending ? '发送中…' : '发送'}</button>
        </div>
      </div>
    </div>
  )
}
