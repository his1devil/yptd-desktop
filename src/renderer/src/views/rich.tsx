import { createContext, Fragment, memo, useContext, type ReactNode } from 'react'
import { resolveMention } from '../store/mentions'
import { blocks, type Block } from './markdown'
import styles from './rich.module.css'

/**
 * 消息正文：围栏代码块 + 表格 + 行内 markdown + @提及色块，换行原样保留。
 *
 * 块级只认 ``` 围栏和表格。围栏是因为 agent 的回答里代码块常见，得像代码；表格是
 * 因为一张 markdown 表原样显示根本读不了——比例字体下列对不齐，`|---|---|` 那行纯是
 * 噪音——而 agent 一天要发好几张。其余块级语法（列表、标题）仍然保留字面字符：它们
 * 会把聊天消息的空行折掉，agent 分段的回答就成一坨了，别的聊天软件也是这么显示的。
 *
 * @名字有三种下场，由它在不在这个会话里决定：
 *   群里的 agent   橙色（--agent/--atint）
 *   群里的人       蓝色（--user/--utint）
 *   是这服务器的用户、但不在这个会话里   灰色——@ 了也没人收得到，不该看着像通了
 *   其他           普通文字。打错的名字、代码里的 @、邮箱前缀，都不该被画成色块
 *
 * 名单在渲染时由当前会话的成员算出来（见 selectors 的 mentionLook），不是入库时定的：
 * 谁在群里会变，而历史消息不会为此重新翻译一遍。
 *
 * 代码芯片里如果整段就是一个带正负号的百分比（`+3.20%`、`-7.85%`），换成涨跌色。
 * 行情推送靠这个一眼看出方向，人手打的 `-12%` 蹭到这条规则也读得通。要求带符号，
 * 是为了把「涨跌幅」和普普通通的百分比（`99%` 的准确率）分开。
 */
// 最后那一段只是「@ 后面一串像名字的字」，具体到哪儿为止交给 resolveMention 按名单定
const TOKEN = /(\*\*[^*\n]+?\*\*)|(`[^`\n]+?`)|(~~[^~\n]+?~~)|(\[[^\]\n]+?\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>)\]]+)|(@[A-Za-z0-9_\u4e00-\u9fa5]{1,32})/g
/** 带正负号的百分比，且整段只有它——涨跌幅，上语义色 */
const MOVE = /^[+-]\d+(\.\d+)?%$/

/** @名字（不带 @）分别落在哪一档。空集合就是「都不认识」，全渲染成普通文字。 */
export interface Mentions {
  agents: ReadonlySet<string>
  members: ReadonlySet<string>
  outsiders: ReadonlySet<string>
}

export const NO_MENTIONS: Mentions = { agents: new Set(), members: new Set(), outsiders: new Set() }

/**
 * 谁在这个会话里，由消息流在顶上给一次。走 context 而不是 props：正文组件藏在
 * 行、画廊、运行卡底下好几层，为了一个「谁在群里」把它穿过去，每一层都要多一个
 * 它自己用不上的参数。没有 provider 的地方（比如脱离会话的预览）就是谁都不认识。
 */
const MentionContext = createContext<Mentions>(NO_MENTIONS)
export const MentionsProvider = MentionContext.Provider

export const Rich = memo(function Rich({ text }: { text: string }) {
  const mentions = useContext(MentionContext)
  const parts = blocks(text)
  // 绝大多数消息就是一段字，别为它建一层 Fragment 数组
  if (parts.length === 1 && parts[0]!.kind === 'text') return <Fragment>{inline(parts[0]!.text, mentions)}</Fragment>
  return <Fragment>{parts.map((b, i) => <Chunk key={i} block={b} look={mentions} />)}</Fragment>
})

function Chunk({ block, look }: { block: Block; look: Mentions }): ReactNode {
  switch (block.kind) {
    case 'code':
      return <pre className={styles.pre}><code>{block.code}</code></pre>
    case 'table':
      // 表比正文宽是常态，让它自己横向滚，而不是把整条消息撑宽
      return (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>{block.head.map((c, i) => <th key={i} style={{ textAlign: block.align[i] }}>{inline(c, look)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((c, i) => <td key={i} style={{ textAlign: block.align[i] }}>{inline(c, look)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return <Fragment>{inline(block.text, look)}</Fragment>
  }
}

function inline(text: string, look: Mentions): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const [whole, bold, code, strike, link, linkUrl, bare, mention] = m
    if (bold) out.push(<strong key={key++}>{bold.slice(2, -2)}</strong>)
    else if (code) {
      const body = code.slice(1, -1)
      const cls = MOVE.test(body) ? (body[0] === '+' ? styles.up : styles.down) : styles.code
      out.push(<code key={key++} className={cls}>{body}</code>)
    }
    else if (strike) out.push(<s key={key++}>{strike.slice(2, -2)}</s>)
    else if (link && linkUrl) out.push(<a key={key++} href={linkUrl} target="_blank" rel="noreferrer">{link.slice(1, link.indexOf(']'))}</a>)
    else if (bare) out.push(<a key={key++} href={bare} target="_blank" rel="noreferrer">{bare}</a>)
    else if (mention) {
      const run = mention.slice(1)
      const name = resolveMention(run, look)
      if (!name) out.push(mention)
      else {
        const cls = look.agents.has(name) ? styles.mentionAgent : look.members.has(name) ? styles.mentionUser : styles.mentionOff
        out.push(<span key={key++} className={cls}>{'@' + name}</span>)
        // 名字后面直接跟着的字（「@JOMO也来」里的「也来」）原样接上
        if (name.length < run.length) out.push(run.slice(name.length))
      }
    } else out.push(whole)
    last = i + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
