/**
 * 消息正文的块级切分：围栏代码块、表格，以及夹在中间的普通文字。
 *
 * 只认这两种块。列表和标题仍然保留字面字符——它们在聊天里会把 agent 分段回答的空行
 * 折掉，别的聊天软件也是这么显示的。表格不一样：一张 markdown 表原样显示是读不了的，
 * 比例字体下列根本对不齐，`|---|---|` 那行还纯是噪音，而 agent 一天要发好几张。
 */
export type Align = 'left' | 'center' | 'right'

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string }
  | { kind: 'table'; head: string[]; align: Align[]; rows: string[][] }

const FENCE = /```[\w+-]*\n([\s\S]*?)```/g

/** 把正文切成块。没有围栏也没有表格时返回单独一块文字。 */
export function blocks(text: string): Block[] {
  const out: Block[] = []
  let last = 0
  for (const m of text.matchAll(FENCE)) {
    const i = m.index ?? 0
    if (i > last) pushText(out, text.slice(last, i))
    out.push({ kind: 'code', code: (m[1] ?? '').replace(/\n$/, '') })
    last = i + m[0].length
  }
  if (last < text.length) pushText(out, text.slice(last))
  return out
}

/** 文字段里再找表格。找不到就整段当文字。 */
function pushText(out: Block[], chunk: string): void {
  const lines = chunk.split('\n')
  let buf: string[] = []
  const flush = (): void => {
    if (buf.length === 0) return
    const text = buf.join('\n')
    // 块与块之间那一个换行是分隔符，不是内容：留着会多出一行空白
    if (text.trim() !== '') out.push({ kind: 'text', text: trimEdges(text, out.length > 0) })
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const table = tableAt(lines, i)
    if (!table) { buf.push(lines[i]!); continue }
    flush()
    out.push(table.block)
    i = table.end
  }
  flush()
}

function trimEdges(text: string, hadBlockBefore: boolean): string {
  return hadBlockBefore ? text.replace(/^\n/, '').replace(/\n$/, '') : text.replace(/\n$/, '')
}

/**
 * 从第 i 行开始能不能读出一张表。
 *
 * 要求表头下面紧跟一行分隔行（`|---|:--:|`），且列数和表头一致——只靠「这行有竖线」
 * 判断的话，一句「他说 a|b 的意思是」就会被当成表格。
 */
function tableAt(lines: string[], i: number): { block: Block; end: number } | null {
  const head = lines[i]
  const sep = lines[i + 1]
  if (!head?.includes('|') || !sep?.includes('|')) return null
  const headCells = cells(head)
  const sepCells = cells(sep)
  if (headCells.length < 2 || sepCells.length !== headCells.length) return null
  if (!sepCells.every((c) => /^:?-{1,}:?$/.test(c))) return null

  const align = sepCells.map<Align>((c) =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left')

  const rows: string[][] = []
  let end = i + 1
  for (let j = i + 2; j < lines.length; j++) {
    const line = lines[j]!
    if (!line.includes('|') || line.trim() === '') break
    const row = cells(line)
    // 缺的补空、多的截掉：模型偶尔会漏一根竖线，不该因此整张表不认
    rows.push(Array.from({ length: headCells.length }, (_, k) => row[k] ?? ''))
    end = j
  }
  return { block: { kind: 'table', head: headCells, align, rows }, end }
}

/** 一行拆成单元格。首尾那根竖线是画框用的，不是空列。 */
function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}
