import { TextNode, type EditorConfig, type LexicalNode, type NodeKey, type SerializedTextNode, type Spread } from 'lexical'

/**
 * 输入框里的一个 @ 色块。
 *
 * 用 TextNode 的 token 模式而不是 DecoratorNode：token 模式下这一段是原子的——一次退格删掉整块、
 * 光标进不去中间、方向键跳过去，正是 Discord 那种手感；而且不用给每个色块挂一棵 React 子树，
 * 一条消息里 @ 十个人也不会多十个组件。
 *
 * 节点上记着真实账号 ID。发送时按它产出 atUserList，不再靠显示名去反查——两个人名字相近
 * 会认错，改了名历史也对不上。
 */
export type SerializedMentionNode = Spread<{ userID: string; isAgent: boolean }, SerializedTextNode>

export class MentionNode extends TextNode {
  __userID: string
  __isAgent: boolean

  static getType(): string { return 'mention' }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__userID, node.__isAgent, node.__text, node.__key)
  }

  constructor(userID: string, isAgent: boolean, text: string, key?: NodeKey) {
    super(text, key)
    this.__userID = userID
    this.__isAgent = isAgent
  }

  get userID(): string { return this.__userID }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config)
    // 和消息里渲染出来的 @ 用同一套颜色：人是蓝的，agent 是粉的
    dom.className = this.__isAgent ? 'yptd-mention yptd-mention-agent' : 'yptd-mention'
    dom.spellcheck = false
    return dom
  }

  updateDOM(prev: this, dom: HTMLElement, config: EditorConfig): boolean {
    const updated = super.updateDOM(prev, dom, config)
    if (prev.__isAgent !== this.__isAgent) {
      dom.className = this.__isAgent ? 'yptd-mention yptd-mention-agent' : 'yptd-mention'
    }
    return updated
  }

  static importJSON(json: SerializedMentionNode): MentionNode {
    return $createMentionNode(json.userID, json.isAgent, json.text)
  }

  exportJSON(): SerializedMentionNode {
    return { ...super.exportJSON(), type: 'mention', version: 1, userID: this.__userID, isAgent: this.__isAgent }
  }

  /** 复制出去是纯文本，粘到别处就是「@名字」 */
  isTextEntity(): true { return true }
}

export function $createMentionNode(userID: string, isAgent: boolean, display: string): MentionNode {
  const node = new MentionNode(userID, isAgent, display)
  // token：整块删除、光标进不去
  node.setMode('token')
  return node
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode
}
