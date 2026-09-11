import { beforeEach, describe, expect, it } from 'vitest'
import { apply, bindForTest, flushForTest, onBatch, useRuns } from './runs'

/**
 * 服务端事件 → 运行的当前值。事件形状照服务端 run 包的 JSON。
 */
const env = (type: string, data: unknown, seq = 1) => JSON.stringify({ seq, type, at: 0, data })
const snapshot = (over: Record<string, unknown> = {}) => JSON.stringify({
  id: 'run_1', agent_id: 'agentcharlie', conversation_id: 'sg_1', status: 'running',
  started_at: 100, thinking: '', text: '', tools: [], usage: { input: 0, output: 0, reasoning: 0, cost: 0, steps: 0 }, seq: 1, ...over,
})

beforeEach(() => { useRuns.setState({ runs: {} }) })

describe('运行流折叠', () => {
  it('快照建立当前值，之后的增量按帧合并进去', () => {
    apply('run_1', 'snapshot', snapshot({ thinking: '想', text: '你' }))
    apply('run_1', 'thinking', env('thinking', { delta: '一想' }))
    apply('run_1', 'text', env('text', { delta: '好' }))
    apply('run_1', 'text', env('text', { delta: '啊' }))
    // 还没到帧尾：store 里还是快照
    expect(useRuns.getState().runs.run_1!.text).toBe('你')
    flushForTest()
    const r = useRuns.getState().runs.run_1!
    expect(r.thinking).toBe('想一想')
    expect(r.text).toBe('你好啊')
    expect(r.status).toBe('running')
  })

  it('工具按 callID 更新，后来的状态不丢先前的入参', () => {
    apply('run_1', 'snapshot', snapshot())
    apply('run_1', 'tool', env('tool', { call_id: 'c1', name: 'bash', status: 'running', input: '{"command":"date"}', started_at: 5 }))
    flushForTest()
    apply('run_1', 'tool', env('tool', { call_id: 'c1', name: 'bash', status: 'completed', output: 'Thu', ended_at: 9 }))
    flushForTest()
    const tools = useRuns.getState().runs.run_1!.tools
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ status: 'completed', input: '{"command":"date"}', output: 'Thu', startedAt: 5, endedAt: 9 })
  })

  it('done 落下状态和最终消息 id；晚到的快照覆盖一切', () => {
    apply('run_1', 'snapshot', snapshot())
    apply('run_1', 'text', env('text', { delta: '半' }))
    apply('run_1', 'done', env('done', { status: 'done', final_msg_id: 'msg9', ended_at: 200 }))
    flushForTest()
    let r = useRuns.getState().runs.run_1!
    expect(r.status).toBe('done')
    expect(r.finalMsgID).toBe('msg9')
    expect(r.text).toBe('半')
    apply('run_1', 'snapshot', snapshot({ status: 'done', text: '半个答案', final_msg_id: 'msg9' }))
    r = useRuns.getState().runs.run_1!
    expect(r.text).toBe('半个答案')
  })

  it('服务端没说结束就断了，标成 detached；说了结束就不标', () => {
    bindForTest(7, 'run_1')
    onBatch({ id: 7, events: [{ event: 'snapshot', data: snapshot() }], closed: true })
    flushForTest()
    expect(useRuns.getState().runs.run_1!.detached).toBe(true)

    bindForTest(8, 'run_2')
    onBatch({ id: 8, events: [
      { event: 'snapshot', data: snapshot({ id: 'run_2' }) },
      { event: 'done', data: env('done', { status: 'done', final_msg_id: 'm', ended_at: 1 }) },
    ], closed: true })
    flushForTest()
    expect(useRuns.getState().runs.run_2!.detached).toBe(false)
    expect(useRuns.getState().runs.run_2!.status).toBe('done')
  })

  it('错误事件把状态改成 error 并带上原因', () => {
    apply('run_1', 'snapshot', snapshot())
    apply('run_1', 'error', env('error', { message: 'quota exceeded' }))
    flushForTest()
    expect(useRuns.getState().runs.run_1).toMatchObject({ status: 'error', error: 'quota exceeded' })
  })
})
