import { useEffect, useMemo, useState } from 'react'
import { api, type AgentConfig as Config, type AgentField } from '../im/api'
import type { Member } from '../../../shared/model'
import { describe, useSession } from '../store/session'
import styles from './InspectorTabs.module.css'

/**
 * 频道右栏的「机器人」页：这个频道里的 agent，各自在这个频道怎么表现。
 *
 * 表单是服务端下发的（字段、类型、范围，以及每个字段一句解释），这里只按 type 渲染。
 * 以后加新 agent、新配置项都不用改这个文件——代价是写不出针对性的文案，所以那句
 * 解释由服务端给：「3% 大概一天几条，1% 会很吵」这种话的知识在服务端，不在这里。
 *
 * 谁都能改。改完服务端会往这个频道发一条「X 把盯盘改成了……」——谁都能改的东西，
 * 最怕的不是有人捣乱，是改了没人知道。
 */
export function ChannelBots({ groupID, members }: { groupID: string; members: Member[] }) {
  const bots = useMemo(() => members.filter((m) => m.isAgent), [members])
  const [openID, setOpenID] = useState<string | null>(null)
  if (bots.length === 0) {
    return <div className={styles.empty}>这个频道里还没有 agent。把它拉进来就能在这儿配置它。</div>
  }
  return (
    <div className={styles.pad}>
      {bots.map((b) => (
        <BotRow key={b.id} bot={b} groupID={groupID}
          open={openID === b.id} onToggle={() => setOpenID(openID === b.id ? null : b.id)} />
      ))}
    </div>
  )
}

function BotRow({ bot, groupID, open, onToggle }: { bot: Member; groupID: string; open: boolean; onToggle(): void }) {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [none, setNone] = useState(false) // 这个 agent 没有可配置的项
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open || cfg || none) return
    let alive = true
    void api.agentConfig(bot.id, groupID)
      .then((c) => { if (alive) setCfg(c) })
      .catch((e) => {
        if (!alive) return
        // 没有可配置项是正常情况（HALX 这类只答不推的 agent），不是错误
        if (String(e).includes('not_configurable') || String(e).includes('没有可配置')) setNone(true)
        else setErr(describe(e))
      })
    return () => { alive = false }
  }, [open, bot.id, groupID, cfg, none])

  return (
    <section className={styles.bot}>
      <button className={styles.botHead} onClick={onToggle} aria-expanded={open}>
        <span className={styles.botName}>{bot.name}</span>
        <span className={styles.botChevron}>{open ? '收起' : '配置'}</span>
      </button>
      {open && (
        err ? <div className={styles.err}>{err}</div>
          : none ? <p className={styles.note}>这个 agent 没有可配置的项——它只在被 @ 到时回答，不主动推送。</p>
            : cfg ? <ConfigForm agentID={bot.id} groupID={groupID} cfg={cfg} onSaved={setCfg} />
              : <p className={styles.note}>读取中…</p>
      )}
    </section>
  )
}

function ConfigForm({ agentID, groupID, cfg, onSaved }: {
  agentID: string; groupID: string; cfg: Config; onSaved(c: Config): void
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(cfg.value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg.value)

  const save = async (): Promise<void> => {
    setBusy(true); setErr(''); setSaved(false)
    try {
      await api.saveAgentConfig(agentID, groupID, draft)
      const fresh = await api.agentConfig(agentID, groupID)
      onSaved(fresh)
      setDraft(fresh.value)
      setSaved(true)
    } catch (e) { setErr(describe(e)) } finally { setBusy(false) }
  }

  return (
    <div className={styles.form}>
      {cfg.form.note && <p className={styles.note}>{cfg.form.note}</p>}
      {!cfg.configured && <p className={styles.note}>这个频道还没单独配过，下面是默认值。</p>}
      {cfg.form.fields.map((f) => (
        <Field key={f.key} field={f} value={draft[f.key]} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
      ))}
      {err && <div className={styles.err}>{err}</div>}
      <div className={styles.formFoot}>
        <button className={styles.save} disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存'}
        </button>
        {saved && !dirty && <span className={styles.note}>已保存，下一轮生效</span>}
        {cfg.updated_by && <span className={styles.note}>上次由 {cfg.updated_by} 修改</span>}
      </div>
    </div>
  )
}

function Field({ field, value, onChange }: { field: AgentField; value: unknown; onChange(v: unknown): void }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{field.label}</span>
      <Input field={field} value={value} onChange={onChange} />
      {field.hint && <span className={styles.note}>{field.hint}</span>}
    </label>
  )
}

function Input({ field, value, onChange }: { field: AgentField; value: unknown; onChange(v: unknown): void }) {
  switch (field.type) {
    case 'symbols':
    case 'text': {
      // 列表在界面上是一行空格分隔的字；服务端会去空白、去重、统一大写
      const text = Array.isArray(value) ? (value as string[]).join(' ') : String(value ?? '')
      return (
        <input className={styles.input} value={text} spellCheck={false}
          onChange={(e) => onChange(e.target.value.split(/\s+/).filter(Boolean))} />
      )
    }
    case 'number':
      return (
        <span className={styles.numberRow}>
          <input className={styles.input} type="number" value={Number(value ?? 0)}
            min={field.min as number} max={field.max as number} step={field.step}
            onChange={(e) => onChange(e.target.valueAsNumber)} />
          {field.unit && <span className={styles.unit}>{field.unit}</span>}
        </span>
      )
    case 'duration':
      return (
        <input className={styles.input} value={String(value ?? '')} spellCheck={false}
          placeholder="2m" onChange={(e) => onChange(e.target.value.trim())} />
      )
  }
}
