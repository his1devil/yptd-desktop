import { useEffect, useState } from 'react'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { errorClass, ghostClass, inputClass, primaryClass } from '../components/Dialog'
import { api, type Invite } from '../im/api'
import { DOWNLOADS } from '../im/auth'
import { describe, useSession } from '../store/session'
import { useUI, type SettingsPage } from '../store/ui'
import { useUpdate } from '../store/update'
import styles from './Settings.module.css'

/**
 * 设置。左侧栏选页，这里画页：资料、成员与邀请、通知、外观、快捷键。
 * 每页都是"一段说明 + 几个能动的东西"，不做向导。
 */
export function Settings() {
  const page = useUI((s) => s.settingsPage)
  return (
    <div className={styles.wrap}>
      <div className={styles.page}>
        {page === 'profile' && <Profile />}
        {page === 'members' && <Members />}
        {page === 'notify' && <Notify />}
        {page === 'appearance' && <Appearance />}
        {page === 'keys' && <Keys />}
        {page === 'about' && <About />}
      </div>
    </div>
  )
}

export const SETTINGS_PAGES: { id: SettingsPage; name: string; group: 'workspace' | 'personal' }[] = [
  { id: 'members', name: '成员与邀请', group: 'workspace' },
  { id: 'profile', name: '资料', group: 'personal' },
  { id: 'notify', name: '通知', group: 'personal' },
  { id: 'appearance', name: '外观', group: 'personal' },
  { id: 'keys', name: '快捷键', group: 'personal' },
  { id: 'about', name: '关于与更新', group: 'personal' },
]

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>{title}</h2>
      {desc && <p className={styles.desc}>{desc}</p>}
      {children}
    </section>
  )
}

function Profile() {
  const me = useSession((s) => s.me)
  const myName = useSession((s) => s.myName)
  const avatar = useSession((s) => s.avatars[s.me] ?? s.myAvatar)
  const [name, setName] = useState(myName)
  const [busy, setBusy] = useState<'name' | 'avatar' | 'out' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setName(myName), [myName])

  const saveName = async (): Promise<void> => {
    const n = name.trim()
    if (!n || n === myName) return
    setBusy('name'); setErr(null)
    try { await useSession.getState().updateNickname(n); setSaved(true); window.setTimeout(() => setSaved(false), 1500) } catch (e) { setErr(describe(e)) } finally { setBusy(null) }
  }
  const pickAvatar = async (): Promise<void> => {
    const [path] = await window.desktop.files.pick('image')
    if (!path) return
    setBusy('avatar'); setErr(null)
    try { await useSession.getState().updateAvatar(path) } catch (e) { setErr(describe(e)) } finally { setBusy(null) }
  }

  return (
    <>
      <Section title="资料" desc="昵称是别人在群里看到的名字，随时能改；账号名按注册时的昵称生成，改不了。">
        <div className={styles.profileRow}>
          <button className={styles.avatarBtn} title="换头像" onClick={() => void pickAvatar()} disabled={busy === 'avatar'}>
            <Avatar glyph={glyphOf(myName || me)} pair={pairOf(me)} size={64} src={avatar} />
            <span className={styles.avatarHint}>{busy === 'avatar' ? '上传中…' : '换头像'}</span>
          </button>
          <div className={styles.fields}>
            <label className={styles.field}>
              <span className={styles.label}>昵称</span>
              <div className={styles.inline}>
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveName()} maxLength={32} />
                <button className={primaryClass} disabled={!name.trim() || name.trim() === myName || busy === 'name'} onClick={() => void saveName()}>{busy === 'name' ? '保存中…' : saved ? '已保存' : '保存'}</button>
              </div>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>账号</span>
              <input className={`${inputClass} mono`} value={`@${me}`} readOnly />
            </label>
          </div>
        </div>
        {err && <div className={errorClass}>{err}</div>}
      </Section>
      <Password />
      <Section title="这台机器" desc="退出后这台机器的登录凭据会被清掉。设过密码就能用账号密码再进来，否则要一个新邀请码。">
        <button className={ghostClass} disabled={busy === 'out'} onClick={() => { setBusy('out'); void useSession.getState().signOut() }}>退出登录</button>
      </Section>
    </>
  )
}

/** 设置或修改密码。有了密码，换一台机器或退出之后就不用再要邀请码。 */
function Password() {
  const has = useSession((s) => s.hasPassword)
  const me = useSession((s) => s.me)
  const [open, setOpen] = useState(false)
  const [oldPw, setOldPw] = useState('')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const ready = pw.length >= 8 && pw === again && (!has || oldPw.length > 0)
  const save = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true); setErr(null)
    try {
      await useSession.getState().setPassword(pw, has ? oldPw : undefined)
      setOldPw(''); setPw(''); setAgain(''); setOpen(false)
      setDone(true); window.setTimeout(() => setDone(false), 2000)
    } catch (e) { setErr(describe(e)) } finally { setBusy(false) }
  }

  return (
    <Section title="密码" desc={has ? '这个账号已经设过密码，可以用账号加密码在任何一台机器上登录。' : '设一个密码，换机器或退出之后就不用再要邀请码。'}>
      {!open ? (
        <div className={styles.inline}>
          <button className={ghostClass} onClick={() => setOpen(true)}>{has ? '修改密码' : '设置密码'}</button>
          {done && <span className={styles.muted}>已保存</span>}
          <span className={`${styles.muted} mono`}>账号 @{me}</span>
        </div>
      ) : (
        <div className={styles.pwForm}>
          {has && (
            <label className={styles.field}>
              <span className={styles.label}>当前密码</span>
              <input className={inputClass} type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
            </label>
          )}
          <label className={styles.field}>
            <span className={styles.label}>新密码</span>
            <input className={inputClass} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="至少 8 位" autoFocus={!has} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>再输一次</span>
            <input className={inputClass} type="password" value={again} onChange={(e) => setAgain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          </label>
          {pw.length > 0 && pw.length < 8 && <div className={errorClass}>密码至少 8 位</div>}
          {again.length > 0 && pw !== again && <div className={errorClass}>两次输入不一样</div>}
          {err && <div className={errorClass}>{err}</div>}
          <div className={styles.inline}>
            <button className={primaryClass} disabled={!ready || busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</button>
            <button className={ghostClass} onClick={() => { setOpen(false); setOldPw(''); setPw(''); setAgain(''); setErr(null) }}>取消</button>
          </div>
        </div>
      )}
    </Section>
  )
}

function Members() {
  const roster = useSession((s) => s.roster)
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [note, setNote] = useState('')
  const [fresh, setFresh] = useState<Invite[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    try { setInvites(await api.invites(false)) } catch (e) { setErr(describe(e)) }
  }
  useEffect(() => { void reload() }, [])

  const mint = async (): Promise<void> => {
    setBusy(true); setErr(null)
    try {
      const made = await api.createInvites(note.trim(), 1)
      setFresh((f) => [...made, ...f])
      setNote('')
      await reload()
    } catch (e) { setErr(describe(e)) } finally { setBusy(false) }
  }
  const copy = (key: string, text: string): void => { void navigator.clipboard.writeText(text); setCopied(key); window.setTimeout(() => setCopied(null), 1200) }
  // 直接能贴给对方的一段：装哪个包、码是什么、多久内有效
  const inviteText = (i: Invite): string => [
    '邀请你加入 yptd（我们内部的频道 + agent 工作台）',
    `1. 下载安装（macOS）：Apple 芯片 ${DOWNLOADS}yptd-latest-arm64.dmg ；Intel 芯片 ${DOWNLOADS}yptd-latest-x64.dmg`,
    `2. 打开后按提示填邀请码：${i.code}（${fmtTime(i.expiresAt)} 前有效，只能用一次）`,
  ].join('\n')
  const humans = roster.filter((p) => !p.isAgent)
  const agents = roster.filter((p) => p.isAgent)

  return (
    <>
      <Section title="邀请" desc="一个邀请码进一个人，24 小时内有效。备注写上给谁，之后列表里能对上；「复制邀请文案」是一段能直接贴给对方的话，带下载地址和码。对方进来后，HALX 会私信告诉你。">
        <div className={styles.inline}>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="给谁的（备注，可不填）" maxLength={60} onKeyDown={(e) => e.key === 'Enter' && void mint()} />
          <button className={primaryClass} disabled={busy} onClick={() => void mint()}>{busy ? '生成中…' : '生成邀请码'}</button>
        </div>
        {fresh.length > 0 && (
          <div className={styles.freshList}>
            {fresh.map((i) => (
              <div key={i.code} className={styles.freshRow}>
                <span className={`${styles.code} mono`}>{i.code}</span>
                <span className={styles.freshNote}>{i.note}</span>
                <button className={ghostClass} onClick={() => copy(`${i.code}:text`, inviteText(i))}>{copied === `${i.code}:text` ? '已复制' : '复制邀请文案'}</button>
                <button className={ghostClass} onClick={() => copy(i.code, i.code)}>{copied === i.code ? '已复制' : '只复制码'}</button>
              </div>
            ))}
          </div>
        )}
        {err && <div className={errorClass}>{err}</div>}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>未使用的邀请码</th><th>备注</th><th>有效期至</th><th /></tr></thead>
            <tbody>
              {(invites ?? []).filter((i) => !i.expired).map((i) => (
                <tr key={i.code}>
                  <td className="mono">{i.code}</td>
                  <td className={styles.muted}>{i.note || '—'}</td>
                  <td className={`${styles.muted} mono`}>{fmtTime(i.expiresAt)}</td>
                  <td>
                    <button className={styles.linkBtn} onClick={() => copy(`${i.code}:text`, inviteText(i))}>{copied === `${i.code}:text` ? '已复制' : '复制邀请文案'}</button>
                    {' · '}
                    <button className={styles.linkBtn} onClick={() => copy(i.code, i.code)}>{copied === i.code ? '已复制' : '只复制码'}</button>
                  </td>
                </tr>
              ))}
              {invites && invites.filter((i) => !i.expired).length === 0 && <tr><td colSpan={4} className={styles.muted}>现在没有可用的邀请码</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`成员 · ${humans.length} 人 · ${agents.length} 个 agent`}>
        <div className={styles.people}>
          {[...humans, ...agents].map((p) => (
            <div key={p.userID} className={styles.personRow}>
              <Avatar glyph={glyphOf(p.nickname)} pair={pairOf(p.userID)} size={26} kind={p.isAgent ? 'agent' : 'human'} id={p.userID} src={useSession.getState().avatars[p.userID]} />
              <span className={styles.personName}>{p.nickname}</span>
              <span className={`${styles.personId} mono`}>@{p.userID}</span>
              {p.isAgent && <span className={`${styles.tag} mono`}>{p.tag || 'AGENT'}</span>}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function Notify() {
  const on = useUI((s) => s.notifications)
  const setOn = useUI((s) => s.setNotifications)
  const [tested, setTested] = useState(false)
  const test = (): void => {
    new Notification('yptd', { body: '通知就长这样。有人 @ 你或私聊你时会弹出。' })
    setTested(true)
  }
  return (
    <Section title="通知" desc="窗口不在前台时，有人 @ 你、或者私聊里来了消息，弹一条系统通知。频道里没 @ 你的消息不弹。">
      <label className={styles.switchRow}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>桌面通知</span>
      </label>
      <button className={ghostClass} onClick={test}>{tested ? '已发一条试试' : '发一条试试'}</button>
    </Section>
  )
}

function Appearance() {
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  return (
    <Section title="外观" desc="两套配色都过了对比度审计。图标栏底部的太阳/月亮也能切。">
      <div className={styles.choices}>
        {(['light', 'dark'] as const).map((t) => (
          <button key={t} className={`${styles.choice} ${theme === t ? styles.choiceOn : ''}`} onClick={() => setTheme(t)}>
            <span className={`${styles.swatch} ${t === 'dark' ? styles.swatchDark : ''}`} />
            <span>{t === 'light' ? '浅色' : '深色'}</span>
          </button>
        ))}
      </div>
    </Section>
  )
}

function Keys() {
  const rows: [string, string][] = [
    ['⌘K', '搜索会话、成员、消息；直接派活给 agent'],
    ['⌥ ↑ / ⌥ ↓', '上一个 / 下一个会话（按侧栏顺序）'],
    ['⌥ ⇧ ↓', '下一个有未读的会话'],
    ['⌘ 1 … 9', '侧栏里的第 1 到第 9 个会话'],
    ['Enter', '发送'],
    ['Shift + Enter', '换行'],
    ['@', '点名一个人或 agent（↑↓ 选，Enter 确认）'],
    ['Esc', '回到输入框；有引用时取消引用；关掉弹层'],
    ['⌘ .', '收起 / 展开右侧栏'],
    ['⌘ ⇧ E', '把当前会话标成已读'],
    ['⌘ ,', '打开设置'],
  ]
  return (
    <Section title="快捷键">
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {rows.map(([k, d]) => <tr key={k}><td><kbd className={`${styles.kbd} mono`}>{k}</kbd></td><td>{d}</td></tr>)}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function About() {
  const status = useUpdate((s) => s.status)
  const check = useUpdate((s) => s.check)
  const install = useUpdate((s) => s.install)
  const [version, setVersion] = useState('')
  useEffect(() => { void window.desktop.version().then(setVersion) }, [])
  const line = (() => {
    switch (status.kind) {
      case 'dev': return '开发模式没有安装包，不检查更新。'
      case 'idle': return '还没检查过。'
      case 'checking': return '正在检查…'
      case 'none': return `已经是最新版（${fmtTime(status.at)} 检查过）。`
      case 'available': return `发现新版本 v${status.version}，正在准备下载。`
      case 'downloading': return `正在下载 v${status.version} · ${status.percent}%`
      case 'ready': return `v${status.version} 已下载好，重启就装上。`
      case 'error': return `检查失败：${status.message}`
    }
  })()
  return (
    <Section title="关于与更新" desc="启动后 8 秒查一次，之后每 4 小时一次。有新版会后台下好，不打断你；不点「重启安装」的话，下次退出时也会装上。">
      <dl className={styles.facts}>
        <dt>当前版本</dt><dd className="mono">v{version || '…'}</dd>
        <dt>更新状态</dt><dd>{line}</dd>
        <dt>更新源</dt><dd className="mono">im.zhanghuanyang.com/dl/desktop/</dd>
      </dl>
      <div className={styles.inline}>
        {status.kind === 'ready' ? (
          <button className={primaryClass} onClick={install}>重启安装 v{status.version}</button>
        ) : (
          <button className={ghostClass} disabled={status.kind === 'checking' || status.kind === 'downloading' || status.kind === 'dev'} onClick={() => void check()}>检查更新</button>
        )}
        <button className={ghostClass} onClick={() => useUI.getState().showWelcome()}>再看一遍新手引导</button>
      </div>
    </Section>
  )
}

const fmtTime = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
