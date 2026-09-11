import { Fragment, memo, type ReactNode } from 'react'
import styles from './rich.module.css'

/**
 * 消息正文：围栏代码块 + 行内 markdown + @提及色块，换行原样保留。
 *
 * 块级只认 ``` 围栏——agent 的回答里代码块常见，得像代码。其余块级语法（列表、标题）
 * 保留发送者打的字面字符：它们会把聊天消息的空行折掉，agent 分段的回答就成一坨了，
 * 别的聊天软件也是这么显示的。
 *
 * @人是蓝的（--user/--utint），@agent 是橙的（--agent/--atint）。哪个名字是 agent
 * 在入库时已经分好，这里只认 props 里的两张名单。
 */
const TOKEN = /(\*\*[^*\n]+?\*\*)|(`[^`\n]+?`)|(~~[^~\n]+?~~)|(\[[^\]\n]+?\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>)\]]+)|(@[A-Za-z][A-Za-z0-9_]*|@[一-龥]{2,4})/g
const FENCE = /```[\w+-]*\n([\s\S]*?)```/g

export const Rich = memo(function Rich({ text, mentions, agentMentions }: { text: string; mentions: string[]; agentMentions: string[] }) {
  const people = new Set(mentions)
  const agents = new Set(agentMentions)
  if (!text.includes('```')) return <Fragment>{inline(text, people, agents)}</Fragment>
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const f of text.matchAll(FENCE)) {
    const i = f.index ?? 0
    if (i > last) out.push(<Fragment key={key++}>{inline(text.slice(last, i).replace(/\n$/, ''), people, agents)}</Fragment>)
    out.push(<pre key={key++} className={styles.pre}><code>{(f[1] ?? '').replace(/\n$/, '')}</code></pre>)
    last = i + f[0].length
  }
  if (last < text.length) out.push(<Fragment key={key++}>{inline(text.slice(last).replace(/^\n/, ''), people, agents)}</Fragment>)
  return <Fragment>{out}</Fragment>
})

function inline(text: string, people: Set<string>, agents: Set<string>): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0
    if (i > last) out.push(text.slice(last, i))
    const [whole, bold, code, strike, link, linkUrl, bare, mention] = m
    if (bold) out.push(<strong key={key++}>{bold.slice(2, -2)}</strong>)
    else if (code) out.push(<code key={key++} className={styles.code}>{code.slice(1, -1)}</code>)
    else if (strike) out.push(<s key={key++}>{strike.slice(2, -2)}</s>)
    else if (link && linkUrl) out.push(<a key={key++} href={linkUrl} target="_blank" rel="noreferrer">{link.slice(1, link.indexOf(']'))}</a>)
    else if (bare) out.push(<a key={key++} href={bare} target="_blank" rel="noreferrer">{bare}</a>)
    else if (mention) {
      const cls = agents.has(mention) ? styles.mentionAgent : people.has(mention) ? styles.mentionUser : null
      out.push(cls ? <span key={key++} className={cls}>{mention}</span> : mention)
    } else out.push(whole)
    last = i + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
