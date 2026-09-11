import { useState } from 'react'
import { useSession } from '../store/session'
import styles from './SignIn.module.css'

/**
 * 第一次进来：填昵称、贴邀请码。
 *
 * 设计稿的 onboarding 是三步（用途 → 邀请 → 装第一个 agent）；我们真实的门只有
 * 邀请码这一道，所以只做第二步，样式沿用它的 880×540 卡片、左步骤栏右内容区。
 */
export function SignIn() {
  const phase = useSession((s) => s.phase)
  const doRegister = useSession((s) => s.register)
  const [nickname, setNickname] = useState('')
  const [invite, setInvite] = useState('')
  const busy = phase.kind === 'connecting'
  const why = phase.kind === 'failed' ? phase.why : null
  const ready = nickname.trim().length > 0 && /^[A-Z0-9-]{8,}$/i.test(invite.trim())

  const submit = (): void => {
    if (!ready || busy) return
    void doRegister(invite.trim().toUpperCase(), nickname.trim())
  }

  return (
    <div className={styles.desk}>
      <div className={styles.card}>
        <aside className={styles.steps}>
          <div className={styles.brand}>yptd</div>
          <ol className={styles.stepList}>
            {[['01', '你是谁', '一个昵称就够'], ['02', '邀请码', '找管理员要一个'], ['03', '进来', '群、私聊和 agent 都在里面']].map(([n, t, d], i) => (
              <li key={n} className={`${styles.step} ${i === 1 ? styles.stepActive : ''}`}>
                <span className={`${styles.stepNo} mono`}>{n}</span>
                <span className={styles.stepText}>
                  <span className={styles.stepTitle}>{t}</span>
                  <span className={styles.stepDesc}>{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
        <section className={styles.content}>
          <h1 className={styles.title}>用邀请码登录这台机器</h1>
          <p className={styles.lead}>邀请码 24 小时内有效、只能用一次；换一台机器要一个新码，同一台机器之后会自动登录。</p>

          <label className={styles.field}>
            <span className={styles.label}>昵称</span>
            <input
              className={styles.input}
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="别人在群里看到的名字"
              autoFocus
              disabled={busy}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>邀请码</span>
            <input
              className={`${styles.input} mono`}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="YPTD-XXXX-XXXX"
              spellCheck={false}
              disabled={busy}
            />
          </label>

          {why && <div className={styles.error}>{why}</div>}

          <div className={styles.actions}>
            <span className={styles.hint}>{busy && phase.kind === 'connecting' ? phase.what : '账号名会按昵称生成，之后不能改；昵称随时能改。'}</span>
            <button className={styles.primary} disabled={!ready || busy} onClick={submit}>
              {busy ? '正在登录…' : '登录'}
            </button>
          </div>
        </section>
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
