import { $createParagraphNode, $createTextNode, $getRoot, $isParagraphNode, $isTextNode, type EditorState, type LexicalEditor } from 'lexical'
import { $createMentionNode, $isMentionNode } from './MentionNode'

/**
 * 编辑器内容 ↔ 我们自己的形态。
 *
 * 草稿存成一串片段而不是 Lexical 的 JSON：形状是我们定的，将来换底座也不用迁移旧草稿。
 */
export type Segment = { t: 'text'; v: string } | { t: 'at'; id: string; name: string; agent: boolean }

/** 发出去要的两样：给别的端看的文本，和精确的账号 ID */
export interface Composed { text: string; mentions: string[] }

export function readComposed(state: EditorState): Composed {
  return state.read(() => {
    const mentions: string[] = []
    let text = ''
    const blocks = $getRoot().getChildren()
    blocks.forEach((block, i) => {
      if (i > 0) text += '\n'
      if (!$isParagraphNode(block)) { text += block.getTextContent(); return }
      for (const node of block.getChildren()) {
        if ($isMentionNode(node)) {
          if (!mentions.includes(node.userID)) mentions.push(node.userID)
          text += node.getTextContent()
        } else if ($isTextNode(node)) {
          text += node.getTextContent()
        }
      }
    })
    return { text, mentions }
  })
}

export function readSegments(state: EditorState): Segment[] {
  return state.read(() => {
    const out: Segment[] = []
    const blocks = $getRoot().getChildren()
    blocks.forEach((block, i) => {
      if (i > 0) out.push({ t: 'text', v: '\n' })
      if (!$isParagraphNode(block)) { out.push({ t: 'text', v: block.getTextContent() }); return }
      for (const node of block.getChildren()) {
        if ($isMentionNode(node)) out.push({ t: 'at', id: node.userID, name: node.getTextContent(), agent: node.__isAgent })
        else if ($isTextNode(node)) out.push({ t: 'text', v: node.getTextContent() })
      }
    })
    // 合并相邻的纯文本，草稿小一点
    return out.reduce<Segment[]>((acc, s) => {
      const last = acc[acc.length - 1]
      if (s.t === 'text' && last?.t === 'text') last.v += s.v
      else acc.push({ ...s })
      return acc
    }, [])
  })
}

/**
 * 把草稿还原进编辑器。空草稿就清空。
 *
 * 先挂上新段落、把选区移过去，再删旧节点：中途不能让根节点空着，否则 Lexical 去给选区找落点时
 * 会抛「Expected node root to have a parent」，整次更新被回滚，看起来就是「清空没生效」。
 */
export function writeSegments(editor: LexicalEditor, segments: Segment[]): void {
  editor.update(() => {
    const root = $getRoot()
    const old = root.getChildren()
    let para = $createParagraphNode()
    root.append(para)
    para.select()
    const first = para
    for (const s of segments) {
      if (s.t === 'at') { para.append($createMentionNode(s.id, s.agent, s.name)); continue }
      const lines = s.v.split('\n')
      lines.forEach((line, i) => {
        if (i > 0) { para = $createParagraphNode(); root.append(para) }
        if (line) para.append($createTextNode(line))
      })
    }
    for (const node of old) node.remove()
    if (segments.length === 0) first.select()
    else para.selectEnd()
  })
}

export const isEmpty = (segments: Segment[]): boolean =>
  segments.every((s) => (s.t === 'text' ? s.v.trim() === '' : false))
