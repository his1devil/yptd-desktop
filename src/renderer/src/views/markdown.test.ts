import { describe, expect, it } from 'vitest'
import { blocks } from './markdown'

const table = (t: string): ReturnType<typeof blocks>[number] | undefined => blocks(t).find((b) => b.kind === 'table')

describe('表格', () => {
  const basic = `| 标的 | 涨跌 |\n| --- | ---: |\n| NVDA.US | -7.85% |\n| 700.HK | +3.20% |`

  it('读出表头、对齐和每一行', () => {
    const b = table(basic)
    expect(b).toMatchObject({
      kind: 'table',
      head: ['标的', '涨跌'],
      align: ['left', 'right'],
      rows: [['NVDA.US', '-7.85%'], ['700.HK', '+3.20%']],
    })
  })

  it('三种对齐都认', () => {
    const b = table(`| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |`)
    expect(b).toMatchObject({ align: ['left', 'center', 'right'] })
  })

  it('首尾不写竖线也认', () => {
    expect(table(`a | b\n--- | ---\n1 | 2`)).toMatchObject({ head: ['a', 'b'], rows: [['1', '2']] })
  })

  it('漏了一根竖线的行补空，不整张表作废', () => {
    // 模型偶尔会漏；一张缺一格的表也比一堆竖线好读
    expect(table(`| a | b |\n| --- | --- |\n| 只有一格 |`)).toMatchObject({ rows: [['只有一格', '']] })
  })

  it('没有分隔行就不是表格', () => {
    // 一句「他说 a|b 的意思是」不该被当成表格
    expect(table(`他说 a|b 的意思是\n下一句也有 c|d`)).toBeUndefined()
  })

  it('分隔行列数对不上也不是表格', () => {
    expect(table(`| a | b |\n| --- |\n| 1 | 2 |`)).toBeUndefined()
  })

  it('只有一列不算表格', () => {
    expect(table(`| a |\n| --- |\n| 1 |`)).toBeUndefined()
  })
})

describe('切块', () => {
  it('没有围栏也没有表格就是一整块文字', () => {
    expect(blocks('就一句话')).toEqual([{ kind: 'text', text: '就一句话' }])
  })

  it('围栏还是围栏', () => {
    const b = blocks('前面\n```js\nconst a = 1\n```\n后面')
    expect(b.map((x) => x.kind)).toEqual(['text', 'code', 'text'])
    expect(b[1]).toEqual({ kind: 'code', code: 'const a = 1' })
  })

  it('表格前后的文字各自成块', () => {
    const b = blocks(`看这个：\n| a | b |\n| --- | --- |\n| 1 | 2 |\n就这些`)
    expect(b.map((x) => x.kind)).toEqual(['text', 'table', 'text'])
    expect(b[0]).toEqual({ kind: 'text', text: '看这个：' })
    expect(b[2]).toEqual({ kind: 'text', text: '就这些' })
  })

  it('块之间不留多余的空行', () => {
    // 正文是 pre-wrap，留着分隔用的那个换行会在表格上下各多出一行空白
    const b = blocks(`上面\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n下面`)
    expect(b[0]).toEqual({ kind: 'text', text: '上面' })
    expect(b[2]).toEqual({ kind: 'text', text: '下面' })
  })

  it('两张表之间夹着字也分得开', () => {
    const t = `| a | b |\n| --- | --- |\n| 1 | 2 |`
    expect(blocks(`${t}\n中间\n${t}`).map((x) => x.kind)).toEqual(['table', 'text', 'table'])
  })

  it('代码块里的竖线不当表格', () => {
    const b = blocks('```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```')
    expect(b.map((x) => x.kind)).toEqual(['code'])
  })
})

describe('单元格里的竖线', () => {
  const table = (t: string): ReturnType<typeof blocks>[number] | undefined =>
    blocks(t).find((b) => b.kind === 'table')

  it('转义的竖线是内容，不是分隔符', () => {
    // 原来 split('|') 会把 a\|b 拆成两列，「选择之一」被多余列的截断吃掉——
    // 内容凭空消失。agent 发正则和命令的表格天天踩这个。
    expect(table('| 表达式 | 描述 |\n|---|---|\n| a\\|b | 选择之一 |')).toMatchObject({
      rows: [['a|b', '选择之一']],
    })
  })

  it('转义的反斜线不吃掉后面的竖线', () => {
    expect(table('| a | b |\n|---|---|\n| 结尾是\\\\ | 第二列 |')).toMatchObject({
      rows: [['结尾是\\', '第二列']],
    })
  })

  it('空单元格还是空的', () => {
    expect(table('| a | b |\n|---|---|\n|  | 只有右边 |')).toMatchObject({
      rows: [['', '只有右边']],
    })
  })

  it('行内代码里的转义竖线也按内容算', () => {
    expect(table('| 写法 | 意思 |\n|---|---|\n| `a\\|b` | 或 |')).toMatchObject({
      rows: [['`a|b`', '或']],
    })
  })
})
