import { useEffect, useState } from 'react'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { DEFAULT_SERVER, checkInvite, type InviteCheck } from '../im/auth'
import { describe, useSession } from '../store/session'
import styles from './SignIn.module.css'

/**
 * 第一次进来的三步：邀请码 → 你是谁 → 进来。
 *
 * 邀请码先验（问服务端一句），不对就当场说清是抄错了、用过了还是过期了，别等填完名字再失败；
 * 剪贴板里有码就预填——邀请多半是聊天里复制来的。连上之后卡片消失，主区是欢迎页（Welcome）。
 */
const STEPS = [
  ['邀请码', '找邀请你的人要一个'],
  ['你是谁', '一个昵称就够，随时能改'],
  ['进来', '频道、私聊和 agent 都在里面'],
] as const

const REASON: Record<string, string> = {
  invalid: '邀请码格式不对，应该长这样：YPTD-XXXX-XXXX',
  unknown: '没有这个邀请码，对一下有没有抄错',
  used: '这个邀请码已经用过了，再要一个新的',
  expired: '这个邀请码过期了，再要一个新的',
}
/** 注册时服务端怪邀请码的错误码（和别人抢同一个码、刚刚过期）：退回第一步 */
const INVITE_ERRORS = new Set(['invalid_invite', 'unknown_invite', 'invite_used', 'invite_expired'])
const CODE_RE = /YPTD[-\s]?([A-Z0-9]{4})[-\s]?([A-Z0-9]{4})/i

/** 边打边整理：大写、去掉不是字母数字的、4 位一组加连字符，最长 YPTD-XXXX-XXXX */
export function formatInvite(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12)].filter(Boolean).join('-')
}

export function SignIn() {
  const phase = useSession((s) => s.phase)
  const doRegister = useSession((s) => s.register)
  const [step, setStep] = useState(0)
  const [code, setCode] = useState('')
  const [pasted, setPasted] = useState(false)
  const [checking, setChecking] = useState(false)
  const [codeErr, setCodeErr] = useState<string | null>(null)
  const [invite, setInvite] = useState<InviteCheck | null>(null)
  const [nickname, setNickname] = useState('')
  const busy = phase.kind === 'connecting'
  const failed = phase.kind === 'failed' ? phase : null

  useEffect(() => {
    void window.desktop.clipboard.readText().then((text) => {
      const m = CODE_RE.exec(text ?? '')
      if (m) { setCode(`YPTD-${m[1]}-${m[2]}`.toUpperCase()); setPasted(true) }
    }).catch(() => { /* 读不到就手填 */ })
  }, [])

  useEffect(() => {
    if (failed && INVITE_ERRORS.has(failed.code ?? '')) { setStep(0); setInvite(null); setCodeErr(failed.why) }
  }, [failed])

  const codeReady = formatInvite(code).length === 14
  const next = async (): Promise<void> => {
    if (!codeReady || checking) return
    setChecking(true); setCodeErr(null)
    try {
      const r = await checkInvite(DEFAULT_SERVER, formatInvite(code))
      if (!r.valid) { setCodeErr(REASON[r.reason ?? 'invalid'] ?? '这个邀请码用不了'); return }
      setInvite(r); setStep(1)
    } catch (e) {
      setCodeErr(`连不上服务器：${describe(e)}`)
    } finally { setChecking(false) }
  }
  const nameReady = nickname.trim().length > 0 && nickname.trim().length <= 32
  const submit = (): void => { if (nameReady && !busy) void doRegister(formatInvite(code), nickname.trim()) }

  const active = busy ? 2 : step
  const hours = invite?.expiresAt ? Math.max(1, Math.round((invite.expiresAt - Date.now()) / 3_600_000)) : null

  return (
    <div className={styles.desk}>
      <div className={styles.card}>
        <aside className={styles.steps}>
          <div className={styles.brand}>yptd</div>
          <ol className={styles.stepList}>
            {STEPS.map(([t, d], i) => (
              <li key={t} className={`${styles.step} ${i === active ? styles.stepActive : ''} ${i < active ? styles.stepDone : ''}`}>
                <span className={`${styles.stepNo} mono`}>{i < active ? '✓' : `0${i + 1}`}</span>
                <span className={styles.stepText}>
                  <span className={styles.stepTitle}>{t}</span>
                  <span className={styles.stepDesc}>{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className={styles.stepsFoot}>内部使用 · 凭邀请码入场</div>
        </aside>

        {step === 0 ? (
          <section className={styles.content}>
            <div className={`${styles.kicker} mono`}>第 1 步 / 共 3 步</div>
            <h1 className={styles.title}>用邀请码进来</h1>
            <p className={styles.lead}>这里是内部的频道、私聊和 agent。邀请码 24 小时内有效、只能用一次；这台机器之后会自动登录。</p>
            <label className={styles.field}>
              <span className={styles.label}>邀请码</span>
              <input
                className={`${styles.input} ${styles.codeInput} mono`}
                value={code}
                onChange={(e) => { setCode(formatInvite(e.target.value)); setPasted(false); setCodeErr(null) }}
                onKeyDown={(e) => e.key === 'Enter' && void next()}
                placeholder="YPTD-XXXX-XXXX"
                spellCheck={false}
                autoFocus
                disabled={checking}
              />
            </label>
            {codeErr && <div className={styles.error}>{codeErr}</div>}
            <div className={styles.actions}>
              <span className={styles.hint}>{pasted ? '已从剪贴板填入，看一眼对不对。' : '邀请是聊天里复制来的？直接粘贴就行。'}</span>
              <button className={styles.primary} disabled={!codeReady || checking} onClick={() => void next()}>{checking ? '核对中…' : '下一步'}</button>
            </div>
          </section>
        ) : (
          <section className={styles.content}>
            <div className={`${styles.kicker} mono`}>{invite?.invitedBy ? `${invite.invitedBy} 邀请你加入` : '第 2 步 / 共 3 步'}</div>
            <h1 className={styles.title}>你叫什么？</h1>
            <p className={styles.lead}>昵称是别人在频道里看到的名字，随时能改；账号名会按昵称生成，之后不能改。</p>
            <div className={styles.whoRow}>
              <Avatar glyph={glyphOf(nickname.trim() || '?')} pair={pairOf(nickname.trim() || 'me')} size={52} />
              <label className={`${styles.field} ${styles.grow}`}>
                <span className={styles.label}>昵称</span>
                <input
                  className={styles.input}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="别人在群里看到的名字"
                  maxLength={32}
                  autoFocus
                  disabled={busy}
                />
              </label>
            </div>
            {failed && !INVITE_ERRORS.has(failed.code ?? '') && <div className={styles.error}>{failed.why}</div>}
            <div className={styles.actions}>
              <span className={styles.hint}>
                {phase.kind === 'connecting' ? phase.what : hours !== null ? `邀请码还有约 ${hours} 小时有效。` : '账号名按昵称生成，之后不能改。'}
              </span>
              <span className={styles.actionBtns}>
                <button className={styles.ghost} disabled={busy} onClick={() => setStep(0)}>上一步</button>
                <button className={styles.primary} disabled={!nameReady || busy} onClick={submit}>{busy ? '正在登录…' : '创建账号并登录'}</button>
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** 有凭据时的启动页：连上之前不闪表单 */
export function Splash({ what }: { what: string }) {
  return (
    <div className={styles.desk}>
      <div className={styles.splash}>
        <div className={styles.brand}>yptd</div>
        <div className={styles.splashWhat}>{what}</div>
      </div>
    </div>
  )
}

/** 自动登录失败：凭据还在，给「重试」，换账号才需要重新拿邀请码 */
export function Recover({ why }: { why: string }) {
  const boot = useSession((s) => s.boot)
  const signOut = useSession((s) => s.signOut)
  return (
    <div className={styles.desk}>
      <div className={styles.recover}>
        <div className={styles.brand}>yptd</div>
        <h1 className={styles.title}>没连上</h1>
        <div className={styles.error}>{why}</div>
        <p className={styles.lead}>这台机器的登录凭据还在，多半是网络或服务端的问题，稍后重试就好。只有换账号才需要重新用邀请码。</p>
        <div className={styles.recoverActions}>
          <button className={styles.primary} onClick={() => void boot()}>重试</button>
          <button className={styles.ghost} onClick={() => void signOut()}>换个账号登录</button>
        </div>
      </div>
    </div>
  )
}
