import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Message } from '../../../shared/model'
import { IconCopy } from '../components/Icons'
import { useRuns, type RunState, type ToolCall } from '../store/runs'
import { Rich } from './rich'
import styles from './Run.module.css'

/**
 * 一次 agent 运行的两种画法。
 *
 * harness 形态（和 agent 的私聊）：思考折叠框 + 工具芯片 + 正文，正文一边流一边长。
 * IM 形态（频道）：一张运行卡，头上是 RUN 号、问题、状态药丸，中间是可展开的执行过程，
 * 下面是结果。同一份运行状态，只是排版不同——形态跟随语境。
 *
 * 订阅粒度是"这一次运行"：几百个 token 的增量只重画这一个组件，列表其他行不动。
 */

export function useRun(runID: string, live: boolean): RunState | undefined {
  const run = useRuns((s) => s.runs[runID])
  const missing = run === undefined
  useEffect(() => {
    if (live) useRuns.getState().attach(runID)
    else if (missing) void useRuns.getState().load(runID)
  }, [runID, live, missing])
  return run
}

const isStreaming = (run: RunState | undefined, live: boolean): boolean => live && (!run || (run.status === 'running' && !run.detached))

const fmtDur = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000), s = Math.round((ms % 60_000) / 1000)
  return `${m}m${String(s).padStart(2, '0')}s`
}
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** 每秒走一下的时钟，只在运行中转 */
function useElapsed(since: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [on])
  return Math.max(0, (on ? now : Date.now()) - since)
}

// ---- harness 形态 -----------------------------------------------------------------

export const RunBody = memo(function RunBody({ message, live }: { message: Message; live: boolean }) {
  const runID = message.runID!
  const run = useRun(runID, live)
  const streaming = isStreaming(run, live)
  const text = live ? run?.text ?? '' : message.body.kind === 'text' ? message.body.text : ''
  const thinking = run?.thinking ?? ''
  const thinkingNow = streaming && text === ''

  return (
    <div className={styles.body}>
      {(thinking || thinkingNow) && <Thinking run={run} text={thinking} active={thinkingNow} />}
      {run && run.tools.length > 0 && <Tools tools={run.tools} />}
      {run?.detached && run.status === 'running' && <Detached runID={runID} />}
      {(text || streaming) && (
        <div className={styles.text}>
          <Rich text={text} />
          {streaming && text !== '' && <span className={styles.caret} />}
        </div>
      )}
      {run?.status === 'error' && !live && <div className={styles.err}>出错了：{run.error}</div>}
      {streaming && <Stop runID={runID} />}
      {run && !streaming && run.usage.steps > 0 && (
        <div className={`${styles.usage} mono`}>
          {run.usage.steps} 步 · {fmtTokens(run.usage.input + run.usage.output + run.usage.reasoning)} tokens
          {run.endedAt ? ` · ${fmtDur(run.endedAt - run.startedAt)}` : ''}
        </div>
      )}
    </div>
  )
})

function Thinking({ run, text, active }: { run: RunState | undefined; text: string; active: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // 展开着看思考时，跟着最新的走
  useEffect(() => { if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [open, text.length])
  let label = '思考过程'
  if (active) label = '正在思考…'
  else if (run?.firstTextAt) label = `思考 ${fmtDur(run.firstTextAt - run.startedAt)}`
  else if (text) label = `思考过程 · ${fmtTokens(text.length)} 字`
  return (
    <div className={styles.think}>
      <button className={styles.thinkHead} onClick={() => setOpen((o) => !o)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flex: 'none' }}>
          <path d="M8 1.8a4.4 4.4 0 0 0-2.6 7.9V11a1 1 0 0 0 1 1h3.2a1 1 0 0 0 1-1V9.7A4.4 4.4 0 0 0 8 1.8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M6.6 14h2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span className={`${styles.thinkLabel} ${active ? styles.pulse : ''}`}>{label}</span>
        <span className={styles.line} />
        <span className={`${styles.chev} mono`}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className={styles.thinkBody}>
          <div ref={ref} className={styles.thinkText}>{text || '…'}</div>
        </div>
      )}
    </div>
  )
}

function Tools({ tools }: { tools: ToolCall[] }) {
  const [openID, setOpenID] = useState<string | null>(null)
  const open = tools.find((t) => t.callID === openID)
  return (
    <>
      <div className={styles.tools}>
        {tools.map((t) => (
          <button key={t.callID} className={`${styles.tool} ${openID === t.callID ? styles.toolOpen : ''}`} onClick={() => setOpenID(openID === t.callID ? null : t.callID)} title={t.title || t.name}>
            <span className={`${styles.dot} ${styles[`dot_${t.status}`] ?? ''}`} />
            <span className={`${styles.toolName} mono`}>{t.name}</span>
            <span className={`${styles.toolDur} mono`}>{toolDuration(t)}</span>
          </button>
        ))}
      </div>
      {open && <ToolDetail tool={open} />}
    </>
  )
}

const toolDuration = (t: ToolCall): string => {
  if (t.status === 'running' || t.status === 'pending') return '运行中'
  if (t.status === 'error') return '失败'
  return t.startedAt && t.endedAt ? fmtDur(t.endedAt - t.startedAt) : '完成'
}

function ToolDetail({ tool }: { tool: ToolCall }) {
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <span className={`${styles.detailName} mono`}>{tool.name}</span>
        {tool.title && <span className={styles.detailTitle}>{tool.title}</span>}
      </div>
      {tool.input && <pre className={styles.pre}>{tool.input}</pre>}
      {tool.output && <pre className={`${styles.pre} ${styles.preOut}`}>{tool.output}</pre>}
      {tool.error && <pre className={`${styles.pre} ${styles.preErr}`}>{tool.error}</pre>}
    </div>
  )
}

function Stop({ runID }: { runID: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className={styles.stop} disabled={busy} onClick={() => { setBusy(true); void useRuns.getState().cancel(runID).finally(() => setBusy(false)) }}>
      <span className={styles.stopDot} />
      {busy ? '正在停止…' : '停止生成'}
    </button>
  )
}

function Detached({ runID }: { runID: string }) {
  return (
    <div className={styles.detached}>
      <span>实时流断了，回答仍在服务端继续</span>
      <button className={styles.relink} onClick={() => useRuns.getState().attach(runID)}>重新接上</button>
    </div>
  )
}

// ---- IM 形态：运行卡 -----------------------------------------------------------------

const STATUS_LABEL: Record<RunState['status'], string> = { running: '运行中', done: '已完成', error: '出错', cancelled: '已停止' }

export const RunCard = memo(function RunCard({ message, live, final }: { message: Message; live: boolean; final?: ReactNode }) {
  const runID = message.runID!
  const run = useRun(runID, live)
  const streaming = isStreaming(run, live)
  const status: RunState['status'] = run?.status ?? (live ? 'running' : 'done')
  const elapsed = useElapsed(run?.startedAt ?? message.sentAt, streaming)
  const [open, setOpen] = useState(false)
  const steps = (run?.tools.length ?? 0) + (run?.thinking ? 1 : 0)
  const text = live ? run?.text ?? '' : null

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <span className={`${styles.runId} mono`}>RUN #{runID.slice(4, 10).toUpperCase()}</span>
        <span className={styles.cardTitle}>{run?.prompt || '…'}</span>
        <span className={`${styles.cardMeta} mono`}>
          {message.senderName} · {run?.endedAt ? fmtDur(run.endedAt - run.startedAt) : fmtDur(elapsed)}
        </span>
        <span className={`${styles.pill} ${styles[`pill_${status}`] ?? ''}`}>{STATUS_LABEL[status]}</span>
      </div>

      <button className={styles.toggle} onClick={() => setOpen((o) => !o)}>
        <span className="mono">{open ? '收起过程' : '执行过程'}</span>
        <span className={styles.line} />
        <span className={`${styles.stepCount} mono`}>{steps ? `${steps} 步` : streaming ? '进行中…' : '无'}</span>
      </button>

      {open && run && (
        <div className={styles.steps}>
          {run.thinking && (
            <Step at={0} kind="THINK" label={run.firstTextAt ? `思考 ${fmtDur(run.firstTextAt - run.startedAt)}` : `思考 · ${fmtTokens(run.thinking.length)} 字`} status="completed" detail={run.thinking} />
          )}
          {run.tools.map((t) => (
            <Step key={t.callID} at={t.startedAt ? t.startedAt - run.startedAt : 0} kind="TOOL" label={t.name} meta={t.title || (t.input ? t.input.slice(0, 80) : '')} status={t.status} detail={[t.input, t.output, t.error].filter(Boolean).join('\n\n') || undefined} />
          ))}
        </div>
      )}

      <div className={styles.result}>
        {text !== null ? (
          <div className={styles.text}>
            {text ? <Rich text={text} /> : <span className={`${styles.waiting} ${styles.pulse}`}>{run?.thinking ? '正在思考…' : '正在处理…'}</span>}
            {streaming && text !== '' && <span className={styles.caret} />}
          </div>
        ) : (
          final
        )}
        {run?.detached && run.status === 'running' && <Detached runID={runID} />}
        {streaming && <Stop runID={runID} />}
      </div>
    </div>
  )
})

function Step({ at, kind, label, meta, status, detail }: { at: number; kind: string; label: string; meta?: string; status: ToolCall['status']; detail?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.step}>
      <div className={styles.stepRail}>
        <span className={`${styles.stepDot} ${styles[`dot_${status}`] ?? ''}`} />
        <span className={styles.stepLine} />
      </div>
      <div className={styles.stepBody}>
        <button className={styles.stepHead} onClick={() => detail && setOpen((o) => !o)}>
          <span className={`${styles.stepAt} mono`}>+{fmtDur(at)}</span>
          <span className={styles.stepKind}>{kind}</span>
          <span className={styles.stepLabel}>{label}</span>
          {detail && <span className={`${styles.chev} mono`}>{open ? '▴' : '▾'}</span>}
        </button>
        {meta && !open && <div className={`${styles.stepMeta} mono`}>{meta}</div>}
        {open && detail && <pre className={styles.pre}>{detail}</pre>}
      </div>
    </div>
  )
}

/** 复制运行的最终文字，给最终消息那行用 */
export function CopyRun({ text }: { text: string }) {
  return <button className={styles.copy} title="复制" onClick={() => void navigator.clipboard.writeText(text)}><IconCopy /></button>
}
