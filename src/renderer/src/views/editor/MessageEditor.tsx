import { useCallback, useEffect, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import {
  $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, $createTextNode, COMMAND_PRIORITY_LOW, COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND, PASTE_COMMAND, type EditorState, type LexicalEditor,
} from 'lexical'
import type { Mentionable } from '../../store/selectors'
import { MentionNode } from './MentionNode'
import { MentionsPlugin } from './MentionsPlugin'
import { readComposed, readSegments, writeSegments, type Composed, type Segment } from './state'

/**
 * 消息输入框的编辑器本体。
 *
 * 走 Discord 那套：纯文本 + 原子装饰。打 `**粗**` 框里就显示带星号的字面文本，发出去才变粗；
 * 只有 @ 是色块。这样 agent 收到的就是人打的原文，中间不多一层富文本到 markdown 的翻译。
 *
 * 用 Lexical 而不是 contenteditable 手写，图的就是中文组字、撤销、粘贴清洗这几件事不用自己扛。
 */
export interface EditorApi {
  focus(): void
  /** 在光标处插入文字（侧栏的 agent 芯片、悬浮条的转交都走它） */
  insert(text: string): void
  clear(): void
  read(): Composed
  load(segments: Segment[]): void
}

interface Props {
  api: { current: EditorApi | null }
  placeholder: string
  candidates: Mentionable[]
  onChange(segments: Segment[]): void
  onSend(): void
  onEscape(): void
  onFiles(files: File[]): void
}

export function MessageEditor({ api, placeholder, candidates, onChange, onSend, onEscape, onFiles }: Props) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'yptd-composer',
        nodes: [MentionNode],
        // 编辑器内部出错不该把整个窗口带走：记一条，界面继续用
        onError: (e) => { console.error('[composer]', e) },
        theme: { paragraph: 'yptd-line' },
      }}
    >
      <PlainTextPlugin
        contentEditable={<ContentEditable className="yptd-input" aria-placeholder={placeholder} placeholder={<div className="yptd-placeholder">{placeholder}</div>} />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin onChange={(state: EditorState) => onChange(readSegments(state))} ignoreSelectionChange />
      {/* 候选菜单的优先级要高于下面的回车处理，菜单开着时回车是「选中候选」而不是「发送」 */}
      <MentionsPlugin candidates={candidates} />
      <Wiring api={api} onSend={onSend} onEscape={onEscape} onFiles={onFiles} />
    </LexicalComposer>
  )
}

function Wiring({ api, onSend, onEscape, onFiles }: Pick<Props, 'api' | 'onSend' | 'onEscape' | 'onFiles'>) {
  const [editor] = useLexicalComposerContext()
  const send = useRef(onSend); send.current = onSend
  const esc = useRef(onEscape); esc.current = onEscape
  const files = useRef(onFiles); files.current = onFiles

  const impl = useCallback((ed: LexicalEditor): EditorApi => ({
    focus: () => ed.focus(),
    insert: (text) => ed.update(() => {
      let sel = $getSelection()
      if (!$isRangeSelection(sel)) {
        // 没有选区（比如刚从别处点过来）：落到末尾。根节点可能还没有段落，先补一个
        const root = $getRoot()
        const last = root.getLastChild()
        if (last) last.selectEnd()
        else root.append($createParagraphNode()).selectEnd()
        sel = $getSelection()
      }
      if ($isRangeSelection(sel)) sel.insertNodes([$createTextNode(text)])
    }, { onUpdate: () => ed.focus() }),
    clear: () => writeSegments(ed, []),
    read: () => readComposed(ed.getEditorState()),
    load: (segments) => writeSegments(ed, segments),
  }), [])

  useEffect(() => {
    api.current = impl(editor)
    return () => { api.current = null }
  }, [editor, api, impl])

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    (e: KeyboardEvent | null) => {
      // 组字途中的回车是输入法在确认候选，不是发送；换行留给 Shift+Enter。
      // 事件上的 isComposing 有的路径下拿不到（keyCode 229 是老写法），再问一次编辑器自己的状态
      if (!e || e.shiftKey || e.isComposing || e.keyCode === 229 || editor.isComposing()) return false
      e.preventDefault()
      send.current()
      return true
    },
    COMMAND_PRIORITY_LOW,
  ), [editor])

  useEffect(() => editor.registerCommand(KEY_ESCAPE_COMMAND, () => { esc.current(); return false }, COMMAND_PRIORITY_LOW), [editor])

  useEffect(() => editor.registerCommand(
    PASTE_COMMAND,
    (e) => {
      // PASTE_COMMAND 的载荷可能是 ClipboardEvent，也可能是输入法/快捷键路径下的 KeyboardEvent
      const data = e instanceof ClipboardEvent ? e.clipboardData : null
      const list = [...(data?.files ?? [])]
      if (list.length === 0) return false
      e.preventDefault()
      files.current(list)
      return true
    },
    COMMAND_PRIORITY_NORMAL,
  ), [editor])

  return null
}
