import { describe, expect, it } from 'vitest'
import type { MessageItem } from '@openim/wasm-client-sdk'
import { summarize, type Attachment } from '../../../shared/model'
import { Translator, conversationOf, dayIndex, dayLabel, directId, isTransient, parseRich, placeholderFor, reactionData, richEx } from './translate'
import { streamSrc, viaMain } from './files'

/**
 * 从上一版 Swift 客户端移植过来的用例。每一条都对应真实部署上踩过的一个坑，
 * 换语言不换知识。
 */

// 覆盖项不按 MessageItem 校验：测试要能塞 999 这种不存在的类型、缺字段的引用体
const raw = (over: Record<string, unknown>): MessageItem =>
  ({
    clientMsgID: 'm1', serverMsgID: '', createTime: 0, sendTime: 1_800_000_000_000, sessionType: 3,
    sendID: 'bob', recvID: '', msgFrom: 100, contentType: 101, senderPlatformID: 1,
    senderNickname: 'Bob', senderFaceUrl: '', groupID: 'g1', content: '', seq: 1, isRead: false,
    status: 2, isReact: false, isExternalExtensions: false, offlinePush: {}, attachedInfo: '',
    ex: '', localEx: '', textElem: { content: '你好' },
    ...over,
  }) as unknown as MessageItem

const t = () => new Translator('tuitest')

describe('文本与会话', () => {
  it('文本消息', () => {
    const m = t().message(raw({}))!
    expect(m.body).toEqual({ kind: 'text', text: '你好' })
    expect(m.conversation).toBe('sg_g1')
    expect(m.senderName).toBe('Bob')
  })

  it('私聊的会话 id 两端算出来一样', () => {
    expect(directId('alice', 'bob')).toBe(directId('bob', 'alice'))
    expect(conversationOf({ groupID: '', sendID: 'bob', recvID: 'tuitest' }, 'tuitest')).toBe('si_bob_tuitest')
    expect(conversationOf({ groupID: '', sendID: 'tuitest', recvID: 'bob' }, 'tuitest')).toBe('si_bob_tuitest')
  })

  it('系统通知不进消息流', () => {
    expect(t().message(raw({ contentType: 1501 }))).toBeNull()
  })

  it('不认识的类型留一行占位，不是从会话里消失', () => {
    expect(t().message(raw({ contentType: 999 }))!.body).toEqual({ kind: 'unsupported', label: '[这条消息需要更新客户端]' })
  })

  it('花名册里的名字覆盖消息里烤死的昵称', () => {
    const tr = t(); tr.setNames({ bob: '鲍勃' })
    expect(tr.message(raw({}))!.senderName).toBe('鲍勃')
  })
})

describe('@ 提及', () => {
  it('@ 提到我，标记在信封上而不是元素里', () => {
    const m = t().message(raw({ contentType: 106, atTextElem: { text: '@tui测试 看一下', atUserList: ['tuitest'] } }))!
    expect(m.mentionsMe).toBe(true)
  })

  it('@全体成员也算提到我', () => {
    const tr = t(); tr.atAllTag = 'AtAllTag'
    const m = tr.message(raw({ contentType: 106, atTextElem: { text: '@所有人', atUserList: ['AtAllTag'] } }))!
    expect(m.mentionsMe).toBe(true)
  })

  // @名字 怎么上色不在这里定了：那取决于谁在这个会话里，是渲染时算的（见 selectors 的
  // mentionLook）。这里只保留「这条消息有没有提到我」——它来自 atUserList，和文本无关。
  it('还没读到花名册时，发信人不算 agent', () => {
    expect(t().message(raw({ textElem: { content: '@HALX 在吗' } }))!.isAgent).toBe(false)
  })
})

describe('引用', () => {
  const quoted = { clientMsgID: 'q1', sendID: 'alice', senderNickname: 'Alice', textElem: { content: '第一行\n第二行' } }
  it('114 和「106 带引用」两种形状都认', () => {
    const asQuote = t().message(raw({ contentType: 114, quoteElem: { text: '同意', quoteMessage: quoted } }))!
    const asAt = t().message(raw({ contentType: 106, atTextElem: { text: '@Alice 同意', atUserList: ['alice'], quoteMessage: quoted } }))!
    expect(asQuote.quote?.senderName).toBe('Alice')
    expect(asAt.quote?.messageId).toBe('q1')
  })
  it('引用预览压成一行', () => {
    expect(t().message(raw({ contentType: 114, quoteElem: { text: 'x', quoteMessage: quoted } }))!.quote?.excerpt).toBe('第一行 第二行')
  })
})

describe('图片', () => {
  it('刚发出去那条的回显里 sourcePicture.size 是 0，要在三张里找非零的', () => {
    const m = t().message(raw({
      contentType: 102,
      pictureElem: {
        sourcePath: '/tmp/cat.jpg',
        sourcePicture: { uuid: 'a', url: 'https://x/src.jpg', size: 0, width: 1600, height: 900, type: 'jpg' },
        bigPicture: { uuid: 'b', url: 'https://x/big.jpg', size: 1234, width: 1600, height: 900, type: 'jpg' },
        snapshotPicture: { uuid: 'c', url: 'https://x/snap.jpg', size: 100, width: 320, height: 180, type: 'jpg' },
      },
    }))!
    // bytes 跟着选中的那张走：查看器靠它判断「原图本来就不大，别去要更大的 PNG 缩图」
    expect(m.body).toEqual({ kind: 'picture', url: 'https://x/big.jpg', name: 'cat.jpg', natural: { width: 1600, height: 900 }, bytes: 1234 })
  })
})

describe('占位与撤回', () => {
  it('agent 的占位消息被标成 transient', () => {
    expect(isTransient('{"yptd":"pending"}')).toBe(true)
    expect(isTransient('')).toBe(false)
    expect(isTransient('不是 json')).toBe(false)
    expect(t().message(raw({ ex: '{"yptd":"pending"}' }))!.transient).toBe(true)
  })
})

describe('表情回应', () => {
  const reaction = (id: string, from: string, target: string, emoji: string) =>
    raw({ clientMsgID: id, sendID: from, contentType: 110, customElem: { data: reactionData(target, emoji), description: 'reaction', extension: '' }, textElem: undefined })

  it('回应不是一行消息，是挂在别的消息上的', () => {
    const out = t().messages([raw({}), reaction('r1', 'lina', 'm1', '👍')])
    expect(out).toHaveLength(1)
    expect(out[0]!.reactions).toEqual([{ emoji: '👍', count: 1, mine: false }])
  })

  it('同一个人再点一次就取消', () => {
    const tr = t()
    tr.messages([raw({}), reaction('r1', 'lina', 'm1', '👍')])
    tr.messages([reaction('r2', 'lina', 'm1', '👍')])
    expect(tr.reactionsOn('m1')).toEqual([])
  })

  it('历史重放同一条回应不会把计数抹掉', () => {
    const tr = t()
    const page = [raw({}), reaction('r1', 'lina', 'm1', '👍')]
    tr.messages(page); tr.messages(page); tr.messages(page)
    expect(tr.reactionsOn('m1')).toEqual([{ emoji: '👍', count: 1, mine: false }])
  })

  it('自己点的会标出来，几个人点同一个就累加', () => {
    const tr = t()
    tr.messages([raw({}), reaction('r1', 'lina', 'm1', '👍'), reaction('r2', 'tuitest', 'm1', '👍')])
    expect(tr.reactionsOn('m1')).toEqual([{ emoji: '👍', count: 2, mine: true }])
  })

  it('回应比目标消息先到也不会丢', () => {
    const tr = t()
    expect(tr.messages([reaction('r1', 'lina', 'm1', '🎉')])).toEqual([])
    expect(tr.drainReactionChanges(() => false)).toEqual([])
    const [m] = tr.messages([raw({})])
    expect(m!.reactions).toEqual([{ emoji: '🎉', count: 1, mine: false }])
  })

  it('变化只报一次，取走就清空', () => {
    const tr = t()
    tr.messages([raw({}), reaction('r1', 'lina', 'm1', '👍')])
    expect(tr.drainReactionChanges(() => true)).toEqual([{ id: 'm1', reactions: [{ emoji: '👍', count: 1, mine: false }] }])
    expect(tr.drainReactionChanges(() => true)).toEqual([])
  })

  it('认不出来的自定义消息照旧不显示', () => {
    expect(t().message(raw({ contentType: 110, customElem: { data: '{"yptd":"别的"}', description: '', extension: '' } }))).toBeNull()
  })
})

describe('日期', () => {
  it('跨天的两条消息拿到不同的天序号，按本地时区切', () => {
    const now = new Date()
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    expect(dayIndex(midnight + 60_000)).toBe(dayIndex(midnight - 60_000) + 1)
  })
  it('最近两天有名字，再往前用日期', () => {
    const today = dayIndex(Date.now())
    expect(dayLabel(today, today).startsWith('今天')).toBe(true)
    expect(dayLabel(today - 1, today).startsWith('昨天')).toBe(true)
    expect(dayLabel(today - 9, today)).toMatch(/月\d+日$/)
  })
})


describe('引用', () => {
  const t = new Translator('me')
  const base = { sendID: 'a', recvID: 'me', clientMsgID: 'c1', sendTime: 1000, seq: 1, status: 2 }

  it('atText 带空 quoteMessage 时不当成引用（createAt 无引用会塞空壳）', () => {
    const m = t.message({ ...base, contentType: 106, atTextElem: { text: '你好 @b', atUserList: [], quoteMessage: {} } } as never)
    expect(m?.quote).toBeNull()
  })

  it('quoteElem 指向真消息时给出发送者与摘要', () => {
    const m = t.message({
      ...base, contentType: 114,
      quoteElem: { text: '收到', quoteMessage: { clientMsgID: 'q1', sendID: 'a', senderNickname: '阿花', textElem: { content: '原话在此' } } },
    } as never)
    expect(m?.quote).toEqual({ messageId: 'q1', senderID: 'a', senderName: '阿花', excerpt: '原话在此' })
  })
})

// ---- 文字 + 附件一条消息 ---------------------------------------------------------
const img = (name = 'a.png'): Attachment => ({ kind: 'image', url: `https://x/${name}`, name, bytes: 10, natural: { width: 400, height: 300 } })
const pdf: Attachment = { kind: 'file', url: 'https://x/b.pdf', name: 'b.pdf', bytes: 20, natural: null }

describe('文字 + 附件一条消息', () => {
  it('ex 里的附件读出来：图带原始尺寸，文件带大小；正文照旧', () => {
    const m = t().message(raw({ textElem: { content: '看这个' }, ex: richEx([img(), pdf], true) }))!
    expect(m.body).toEqual({ kind: 'text', text: '看这个' })
    expect(m.attachments).toEqual([img(), pdf])
    expect(summarize(m)).toBe('看这个 [图片] [文件] b.pdf')
  })

  it('没打字：正文是给别的端看的占位，这端藏掉；摘要还是 [图片]', () => {
    const atts = [img(), img('c.png')]
    const m = t().message(raw({ textElem: { content: placeholderFor(atts) }, ex: richEx(atts, false) }))!
    expect(m.body).toEqual({ kind: 'text', text: '' })
    expect(m.attachments).toHaveLength(2)
    expect(summarize(m)).toBe('[图片]×2')
  })

  it('@消息也能带附件', () => {
    const m = t().message(raw({ contentType: 106, atTextElem: { text: '@HALX 看图', atUserList: ['agentbot'] }, ex: richEx([img()], true) }))!
    expect(m.body).toEqual({ kind: 'text', text: '@HALX 看图' })
    expect(m.attachments).toEqual([img()])
  })

  it('别的 ex（run/pending/回应）不算附件，坏 JSON 也不算', () => {
    expect(parseRich('{"yptd":"run","run":"r1"}')).toBeNull()
    expect(parseRich('{"yptd":"rich"}')).toBeNull()
    expect(parseRich('{')).toBeNull()
    expect(t().message(raw({ ex: '{"yptd":"run","run":"r1"}' }))!.attachments).toEqual([])
    // 地址缺了的项跳过，别渲染一个空框
    expect(parseRich('{"yptd":"rich","a":[{"k":"i","u":"","n":"x"},{"k":"f","u":"https://x/y","n":"y"}],"t":1}')!.attachments).toEqual([
      { kind: 'file', url: 'https://x/y', name: 'y', bytes: 0, natural: null },
    ])
  })

  it('占位文案', () => {
    expect(placeholderFor([img()])).toBe('[图片]')
    expect(placeholderFor([img(), img('c.png'), pdf])).toBe('[图片]×2 [文件] b.pdf')
    expect(placeholderFor([])).toBe('[附件]')
  })
})

describe('视频附件（2026-09-19 补的 k:v）', () => {
  it('iOS 发来的视频认成视频：封面、时长、尺寸、mime 都读出来', () => {
    const ex = '{"yptd":"rich","t":0,"a":[{"k":"v","u":"https://im/object/u/a.mp4","n":"1EF6.mp4","s":2100000,"w":588,"h":1280,"p":"https://im/object/u/p.jpg","d":12.4,"m":"video/mp4"}]}'
    const a = parseRich(ex)!.attachments[0]!
    expect(a.kind).toBe('video')
    expect(a.poster).toBe('https://im/object/u/p.jpg')
    expect(a.duration).toBe(12.4)
    expect(a.natural).toEqual({ width: 588, height: 1280 })
    expect(a.mime).toBe('video/mp4')
  })
  it('发出去的也是 k:v，带 p / d / m；往返一致', () => {
    const v = { kind: 'video' as const, url: 'https://im/object/u/a.mp4', name: 'a.mp4', bytes: 9, natural: { width: 1280, height: 720 }, poster: 'https://im/object/u/p.jpg', duration: 3.14159, mime: 'video/mp4' }
    const raw = JSON.parse(richEx([v], false)).a[0]
    expect(raw).toMatchObject({ k: 'v', p: 'https://im/object/u/p.jpg', d: 3.1, m: 'video/mp4', w: 1280, h: 720 })
    expect(parseRich(richEx([v], false))!.attachments[0]!.kind).toBe('video')
  })
  it('不认识的键忽略：iOS 以后加 th / o / b 不该让这边出错', () => {
    const ex = '{"yptd":"rich","t":1,"a":[{"k":"i","u":"https://im/object/u/a.jpg","n":"a.jpg","s":1,"w":2,"h":2,"th":{"u":"x"},"b":"abc","o":{"u":"y"}}]}'
    expect(parseRich(ex)!.attachments[0]!.kind).toBe('image')
  })
  it('没打字时的占位：[视频]', () => {
    expect(placeholderFor([{ kind: 'video', name: 'a.mp4' }])).toBe('[视频]')
    expect(placeholderFor([{ kind: 'image', name: 'a.png' }, { kind: 'video', name: 'a.mp4' }, { kind: 'video', name: 'b.mp4' }])).toBe('[图片] [视频]×2')
  })
})

describe('缩略档、原图、模糊占位（C3 的 th / o / b）', () => {
  const base = 'https://im.example.com/object/u1/'
  it('往返：th / o / b 写得出也读得回', () => {
    const a = {
      kind: 'image' as const, url: base + 'main.jpg', name: '设计稿.png', bytes: 213004,
      natural: { width: 2048, height: 1365 }, mime: 'image/jpeg',
      thumb: base + 'th.jpg', thumbSize: { width: 720, height: 480 },
      blur: '1QcSHQRnh493V4dIh4eXh1h4kJUI',
      original: base + 'orig.png', originalBytes: 5127557,
    }
    const raw = JSON.parse(richEx([a], true)).a[0]
    expect(raw.th).toEqual({ u: base + 'th.jpg', w: 720, h: 480 })
    expect(raw.o).toEqual({ u: base + 'orig.png', s: 5127557 })
    expect(raw.b).toBe('1QcSHQRnh493V4dIh4eXh1h4kJUI')
    const back = parseRich(richEx([a], true))!.attachments[0]!
    expect(back.thumb).toBe(a.thumb)
    expect(back.thumbSize).toEqual(a.thumbSize)
    expect(back.original).toBe(a.original)
    expect(back.originalBytes).toBe(a.originalBytes)
    expect(back.blur).toBe(a.blur)
  })
  it('老消息没有这些字段：读出来是 undefined，不是崩', () => {
    const old = `{"yptd":"rich","t":1,"a":[{"k":"i","u":"${base}a.jpg","n":"a.jpg","s":9,"w":100,"h":100}]}`
    const a = parseRich(old)!.attachments[0]!
    expect(a.thumb).toBeUndefined()
    expect(a.blur).toBeUndefined()
    expect(a.url).toBe(base + 'a.jpg')
  })
  it('超长的 b 当没有：协议上限 40 个字符，实测最长的 hash 是 36，余量只剩 4', () => {
    const bad = `{"yptd":"rich","t":1,"a":[{"k":"i","u":"${base}a.jpg","n":"a","s":1,"b":"${'x'.repeat(41)}"}]}`
    expect(parseRich(bad)!.attachments[0]!.blur).toBeUndefined()
  })
  it('th 里没有地址就当没有缩略档，不会产出一个空地址', () => {
    const bad = `{"yptd":"rich","t":1,"a":[{"k":"i","u":"${base}a.jpg","n":"a","s":1,"th":{"w":720,"h":480}}]}`
    expect(parseRich(bad)!.attachments[0]!.thumb).toBeUndefined()
  })
})

describe('媒体地址走主进程', () => {
  it('https 的换成自定义协议，本机地址原样', () => {
    expect(viaMain('https://im.example.com/object/u/a.jpg', 'avatars', 'a64'))
      .toBe('yptd-media://o/avatars/a64/' + encodeURIComponent('https://im.example.com/object/u/a.jpg'))
    expect(viaMain('data:image/png;base64,xx')).toBe('data:image/png;base64,xx')
    expect(viaMain('yptd-local://f/tmp')).toBe('yptd-local://f/tmp')
  })
  it('有缩略档就用它，没有才按槽位问服务端要', () => {
    const u = 'https://im.example.com/object/u/a.jpg'
    const th = 'https://im.example.com/object/u/th.jpg'
    expect(streamSrc(u, 400, th)).toContain(encodeURIComponent(th))
    expect(streamSrc(u, 400, th)).toContain('/images/th/')
    // 没有 th：退回按需缩图那条路，它要永远留着（老消息、老客户端、OpenIM 原生图片消息）
    expect(decodeURIComponent(streamSrc(u, 400, null))).toContain('type=image&width=480')
  })
})
