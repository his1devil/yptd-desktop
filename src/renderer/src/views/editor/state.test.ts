import { describe, expect, it } from 'vitest'
import { createEditor, $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { MentionNode } from './MentionNode'
import { readSegments, readComposed, writeSegments, type Segment } from './state'

function editor(): ReturnType<typeof createEditor> {
  const ed = createEditor({ nodes: [MentionNode], onError: (e) => { throw e } })
  // 没有 DOM 根节点，标成 headless，Lexical 才会跳过 reconcile 直接提交
  ;(ed as unknown as { _headless: boolean })._headless = true
  return ed
}

/** editor.update 默认是攒到微任务里的，测试要当场读，所以强制同步冲掉 */
function flush(ed: ReturnType<typeof createEditor>): void {
  ed.update(() => { /* 空更新，只为把队列同步提交 */ }, { discrete: true })
}

/** 把草稿写进去，再读回来 */
function roundTrip(segments: Segment[]): { back: Segment[]; text: string } {
  const ed = editor()
  writeSegments(ed, segments)
  flush(ed)
  return { back: readSegments(ed.getEditorState()), text: readComposed(ed.getEditorState()).text }
}

describe('草稿往返', () => {
  it('单行', () => {
    expect(roundTrip([{ t: 'text', v: 'hello' }])).toEqual({ back: [{ t: 'text', v: 'hello' }], text: 'hello' })
  })
  it('两行', () => {
    const r = roundTrip([{ t: 'text', v: 'a\nb' }])
    expect(r.text).toBe('a\nb')
    expect(r.back).toEqual([{ t: 'text', v: 'a\nb' }])
  })
  it('空行', () => {
    const r = roundTrip([{ t: 'text', v: 'a\n\nb' }])
    expect(r.text).toBe('a\n\nb')
  })
  it('结尾换行', () => {
    expect(roundTrip([{ t: 'text', v: 'a\n' }]).text).toBe('a\n')
  })
  it('开头换行', () => {
    expect(roundTrip([{ t: 'text', v: '\na' }]).text).toBe('\na')
  })
  it('@ 和多行混在一起', () => {
    const segs: Segment[] = [
      { t: 'text', v: '看下这个 ' },
      { t: 'at', id: 'u1', name: '@张三', agent: false },
      { t: 'text', v: '\n第二行\n第三行' },
    ]
    const r = roundTrip(segs)
    expect(r.text).toBe('看下这个 @张三\n第二行\n第三行')
    expect(readComposedMentions(segs)).toEqual(['u1'])
  })
  it('markdown 在框里是字面量', () => {
    expect(roundTrip([{ t: 'text', v: '**粗** `码`' }]).text).toBe('**粗** `码`')
  })
})

function readComposedMentions(segs: Segment[]): string[] {
  const ed = editor()
  writeSegments(ed, segs)
  flush(ed)
  return readComposed(ed.getEditorState()).mentions
}

describe('空编辑器', () => {
  it('读出来是空的', () => {
    const ed = editor()
    writeSegments(ed, [])
    flush(ed)
    expect(readComposed(ed.getEditorState()).text).toBe('')
    ed.getEditorState().read(() => { expect($getRoot().getChildrenSize()).toBe(1) })
  })
})

describe('Shift+Enter 打出来的换行', () => {
  // 纯文本模式下 Shift+Enter 不建新段落，是在同一段里插一个 LineBreakNode（DOM 里就是 <br>）。
  // readComposed / readSegments 只认 MentionNode 和 TextNode，LineBreakNode 从两个分支中间掉下去了。
  const withBreak = (): ReturnType<typeof createEditor> => {
    const ed = editor()
    ed.update(() => {
      const p = $createParagraphNode()
      p.append($createTextNode('第一行'), $createLineBreakNode(), $createTextNode('第二行'))
      $getRoot().clear().append(p)
    }, { discrete: true })
    return ed
  }

  it('发出去的正文要带换行', () => {
    expect(readComposed(withBreak().getEditorState()).text).toBe('第一行\n第二行')
  })

  it('存草稿要带换行', () => {
    expect(readSegments(withBreak().getEditorState())).toEqual([{ t: 'text', v: '第一行\n第二行' }])
  })

  it('草稿存回去再读一遍，换行还在', () => {
    const segs = readSegments(withBreak().getEditorState())
    const ed = editor()
    writeSegments(ed, segs)
    flush(ed)
    expect(readComposed(ed.getEditorState()).text).toBe('第一行\n第二行')
  })
})
