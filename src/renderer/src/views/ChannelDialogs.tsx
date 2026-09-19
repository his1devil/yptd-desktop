import { useEffect, useMemo, useState } from 'react'
import type { Member, Person } from '../../../shared/model'
import { Avatar, glyphOf, pairOf } from '../components/Avatar'
import { Dialog, Field, dangerClass, errorClass, ghostClass, inputClass, primaryClass } from '../components/Dialog'
import { knownPeople } from '../store/mentions'
import { describe, useSession } from '../store/session'
import { useUI } from '../store/ui'
import styles from './ChannelDialogs.module.css'

/**
 * 频道的几件事：新建、拉人、改名、退出/解散。都是一张小卡，填完就走。
 * 哪张卡开着由 ui.dialog 说，这里只管画。
 */
export function Dialogs() {
  const dialog = useUI((s) => s.dialog)
  const close = useUI((s) => s.closeDialog)
  if (!dialog) return null
  switch (dialog.kind) {
    case 'newChannel': return <NewChannel onClose={close} />
    case 'invite': return <Invite groupID={dialog.groupID} onClose={close} />
    case 'rename': return <Rename groupID={dialog.groupID} current={dialog.current} onClose={close} />
    case 'leave': return <Leave groupID={dialog.groupID} owner={dialog.owner} title={dialog.title} onClose={close} />
    case 'remove': return <Remove groupID={dialog.groupID} member={dialog.member} onClose={close} />
  }
}

/** 从名册里挑人：人在前、agent 在后，可搜索 */
function Picker({ people, picked, onToggle, exclude }: { people: Person[]; picked: Set<string>; onToggle(id: string): void; exclude?: Set<string> }) {
  const [q, setQ] = useState('')
  // 打开选人的这一刻再问一次服务端。名单先用手上这份画出来，拉到了自己会重画——
  // 刚注册的同事最常见的遭遇就是在这里找不到自己。
  useEffect(() => { void useSession.getState().refreshRoster() }, [])
  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return people
      .filter((p) => !exclude?.has(p.userID))
      .filter((p) => !kw || p.nickname.toLowerCase().includes(kw) || p.userID.toLowerCase().includes(kw))
      // 拉不动的人沉到底下：它们还看得见（免得人以为对方不存在），但不占前面的位置
      .sort((a, b) => Number(b.joinable) - Number(a.joinable) || Number(a.isAgent) - Number(b.isAgent) || a.nickname.localeCompare(b.nickname, 'zh'))
  }, [people, q, exclude])
  return (
    <div className={styles.picker}>
      <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜昵称或账号" />
      <div className={styles.list}>
        {list.map((p) => {
          const on = picked.has(p.userID)
          return (
            <button
              key={p.userID}
              className={`${styles.person} ${on ? styles.personOn : ''}`}
              disabled={!p.joinable}
              title={p.joinable ? undefined : `${p.nickname} 没有开放被加入群聊`}
              onClick={() => onToggle(p.userID)}
            >
              <Avatar glyph={glyphOf(p.nickname)} pair={pairOf(p.userID)} size={22} kind={p.isAgent ? 'agent' : 'human'} id={p.userID} />
              <span className={styles.personName}>{p.nickname}</span>
              <span className={`${styles.personId} mono`}>@{p.userID}</span>
              {p.isAgent && <span className={`${styles.tag} mono`}>{p.tag || 'AGENT'}</span>}
              {/* 服务端会拒绝整批邀请，所以拉不动的人必须一开始就选不中，不能等点了才说 */}
              {!p.joinable && <span className={styles.closed}>未开放</span>}
              <span className={`${styles.check} ${on ? styles.checkOn : ''}`}>{on ? '✓' : ''}</span>
            </button>
          )
        })}
        {list.length === 0 && <div className={styles.empty}>没有匹配的人</div>}
      </div>
    </div>
  )
}

function usePicked(initial: string[] = []) {
  const [picked, setPicked] = useState(() => new Set(initial))
  const toggle = (id: string): void => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return { picked, toggle }
}

function NewChannel({ onClose }: { onClose(): void }) {
  const roster = useSession((s) => s.roster)
  const me = useSession((s) => s.me)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { picked, toggle } = usePicked()
  const people = roster.filter((p) => p.userID !== me)
  const ok = name.trim().length > 0 && !busy

  const submit = async (): Promise<void> => {
    if (!ok) return
    setBusy(true); setErr(null)
    try {
      await useSession.getState().createChannel(name.trim(), [...picked])
      onClose()
    } catch (e) { setErr(describe(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog title="新建频道" width={480} onClose={onClose} footer={<>
      <button className={ghostClass} onClick={onClose}>取消</button>
      <button className={primaryClass} disabled={!ok} onClick={() => void submit()}>{busy ? '正在建…' : `建频道${picked.size ? `，拉 ${picked.size} 人` : ''}`}</button>
    </>}>
      <Field label="名字" hint="像 #engineering 那样短一点，大家在侧栏里认它">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="频道名" autoFocus onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </Field>
      <Field label="拉谁进来" hint="agent 也能拉，进了群就能 @ 它派活；之后随时能再加人">
        <Picker people={people} picked={picked} onToggle={toggle} />
      </Field>
      {err && <div className={errorClass}>{err}</div>}
    </Dialog>
  )
}

function Invite({ groupID, onClose }: { groupID: string; onClose(): void }) {
  const roster = useSession((s) => s.roster)
  const allMembers = useSession((s) => s.members)
  const here = allMembers[groupID] ?? []
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { picked, toggle } = usePicked()
  const inGroup = useMemo(() => new Set(here.map((m) => m.id)), [here])
  // 同上：名册之外，别的群里见过的人也该能拉进来
  const people = useMemo(() => knownPeople(roster, allMembers), [roster, allMembers])

  const submit = async (): Promise<void> => {
    if (picked.size === 0 || busy) return
    setBusy(true); setErr(null)
    try {
      await useSession.getState().inviteToChannel(groupID, [...picked])
      onClose()
    } catch (e) { setErr(describe(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog title="邀请成员" width={480} onClose={onClose} footer={<>
      <button className={ghostClass} onClick={onClose}>取消</button>
      <button className={primaryClass} disabled={picked.size === 0 || busy} onClick={() => void submit()}>{busy ? '正在邀请…' : `邀请 ${picked.size || ''}`.trim()}</button>
    </>}>
      <Picker people={people} picked={picked} onToggle={toggle} exclude={inGroup} />
      {err && <div className={errorClass}>{err}</div>}
    </Dialog>
  )
}

function Rename({ groupID, current, onClose }: { groupID: string; current: string; onClose(): void }) {
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ok = name.trim().length > 0 && name.trim() !== current && !busy
  const submit = async (): Promise<void> => {
    if (!ok) return
    setBusy(true); setErr(null)
    try { await useSession.getState().renameChannel(groupID, name.trim()); onClose() } catch (e) { setErr(describe(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog title="改频道名" onClose={onClose} footer={<>
      <button className={ghostClass} onClick={onClose}>取消</button>
      <button className={primaryClass} disabled={!ok} onClick={() => void submit()}>{busy ? '保存中…' : '保存'}</button>
    </>}>
      <Field label="新名字">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void submit()} />
      </Field>
      {err && <div className={errorClass}>{err}</div>}
    </Dialog>
  )
}

function Leave({ groupID, owner, title, onClose }: { groupID: string; owner: boolean; title: string; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async (dismiss: boolean): Promise<void> => {
    setBusy(true); setErr(null)
    try {
      if (dismiss) await useSession.getState().dismissChannel(groupID)
      else await useSession.getState().leaveChannel(groupID)
      onClose()
    } catch (e) { setErr(describe(e)); setBusy(false) }
  }
  return (
    <Dialog title={owner ? '离开还是解散' : '退出频道'} onClose={onClose} footer={<>
      <button className={ghostClass} onClick={onClose}>取消</button>
      {owner ? (
        <button className={dangerClass} disabled={busy} onClick={() => void go(true)}>解散 #{title}</button>
      ) : (
        <button className={dangerClass} disabled={busy} onClick={() => void go(false)}>退出 #{title}</button>
      )}
    </>}>
      <p className={styles.para}>
        {owner
          ? '你是群主。群主不能直接退出：要么解散这个频道（所有人都会失去它，消息不可恢复），要么先在成员里转让群主。'
          : `退出后这个频道会从你的侧栏消失，之前的消息你也看不到了。别人再拉你进来就能回来。`}
      </p>
      {err && <div className={errorClass}>{err}</div>}
    </Dialog>
  )
}

/** 把一个成员移出频道。agent 和人走的是两条路，说的话也不一样。 */
function Remove({ groupID, member, onClose }: { groupID: string; member: Member; onClose(): void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async (): Promise<void> => {
    setBusy(true); setErr(null)
    try {
      await useSession.getState().removeMember(groupID, member)
      onClose()
    } catch (e) { setErr(describe(e)); setBusy(false) }
  }
  return (
    <Dialog title={`移除 ${member.name}`} onClose={onClose} footer={<>
      <button className={ghostClass} onClick={onClose}>取消</button>
      <button className={dangerClass} disabled={busy} onClick={() => void go()}>移出频道</button>
    </>}>
      <p className={styles.para}>
        {member.isAgent
          ? `${member.name} 会在频道里说一声再走。它在这个频道里的盯盘和新闻设置会一起清掉；想让它回来，再邀请一次就行。`
          : `${member.name} 不会收到通知，但会发现自己不在这个频道里了。别人再拉就能回来。`}
      </p>
      {err && <div className={errorClass}>{err}</div>}
    </Dialog>
  )
}
