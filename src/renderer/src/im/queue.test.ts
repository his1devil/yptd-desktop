import { beforeEach, describe, expect, it } from 'vitest'
import { inLane, laneFor, resetQueue } from './queue'

/** 把待处理的微任务跑完。数 `await Promise.resolve()` 的个数太脆——挂几层 await 就错位 */
const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve() }

const defer = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('下载排队', () => {
  beforeEach(resetQueue)

  it('大对象一次只走一个：管子是总量限速，并发只会让所有图一起慢', async () => {
    const gates = [defer(), defer(), defer()]
    const started: number[] = []
    const all = gates.map((g, i) => inLane('large', async () => { started.push(i); await g.promise }))
    await flush()
    expect(started).toEqual([0])
    gates[0]!.resolve()
    await flush()
    expect(started.length).toBe(2)
    gates[1]!.resolve(); gates[2]!.resolve()
    await Promise.all(all)
  })

  it('小对象三条并行：它们是延迟受限的，每个都有半秒固定开销', async () => {
    const gates = [defer(), defer(), defer(), defer()]
    const started: number[] = []
    const all = gates.map((g, i) => inLane('small', async () => { started.push(i); await g.promise }))
    await flush()
    expect(started).toEqual([0, 1, 2])
    gates.forEach((g) => g.resolve())
    await Promise.all(all)
  })

  it('后进先出：正在看的那张排在已经划过去的一屏前面', async () => {
    const first = defer()
    const started: string[] = []
    const held = inLane('large', async () => { started.push('held'); await first.promise })
    await flush()
    const older = inLane('large', async () => { started.push('older') })
    const newer = inLane('large', async () => { started.push('newer') })
    first.resolve()
    await Promise.all([held, older, newer])
    expect(started).toEqual(['held', 'newer', 'older'])
  })

  it('抛了也要让出位置，不然一次失败就把这条道堵死', async () => {
    await expect(inLane('large', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    let ran = false
    await inLane('large', async () => { ran = true })
    expect(ran).toBe(true)
  })

  it('分道：头像和缩略档走快道，主图和文件走慢道；小主图也放快道', () => {
    expect(laneFor(null, 'avatar')).toBe('small')
    expect(laneFor(null, 'thumb')).toBe('small')
    expect(laneFor(5_000_000, 'main')).toBe('large')
    expect(laneFor(40_000, 'main')).toBe('small')
    expect(laneFor(null, 'main')).toBe('large')
    expect(laneFor(1000, 'file')).toBe('large')
  })
})
