import { Avatar, glyphOf } from '../components/Avatar'
import { IconChat, IconHash, IconSearch } from '../components/Icons'
import { directId } from '../im/translate'
import { useAgentProfiles } from '../store/agents'
import { agentsOf, useSession } from '../store/session'
import { useUI } from '../store/ui'
import { composerBus } from './composerBus'
import styles from './Welcome.module.css'

/**
 * 新账号第一眼看到的主区：三件事够上手、从一个 agent 开始、把人拉进来。
 * 打开任何会话或点「先逛逛」就收起，之后主区回到普通的空态；设置 → 关于 里能再看一遍。
 */
const TIPS = [
  { icon: <IconHash />, title: '在频道里 @ 一个 agent，就是派活', desc: '它带着频道的上下文回答；收到时先给你的消息点个 👌，答完再回一条。' },
  { icon: <IconChat />, title: '和 agent 单聊，看得见它怎么想', desc: '私聊里回答是一个字一个字出来的，思考过程和用到的工具都能展开看。' },
  { icon: <IconSearch />, title: '⌘K 找一切', desc: '搜消息、跳会话、找人、找 agent，一个框搞定。' },
]
const FIRST_PROMPT = '你好！先介绍一下你能帮我做什么，怎么问你效果最好？'

export function Welcome() {
  const myName = useSession((s) => s.myName)
  const me = useSession((s) => s.me)
  const roster = useSession((s) => s.roster)
  const avatars = useSession((s) => s.avatars)
  const profiles = useAgentProfiles()
  const setWelcome = useUI((s) => s.setWelcome)
  const agents = agentsOf(roster)
  const start = (userID: string): void => {
    void useSession.getState().open(directId(me, userID)).then(() => composerBus.insert(FIRST_PROMPT))
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.col}>
        <div className={`${styles.eyebrow} mono`}>欢迎 WELCOME</div>
        <h1 className={styles.title}>你好，{myName || me}</h1>
        <p className={styles.lead}>这里是内部的频道、私聊和 agent。先记住三件事，剩下的边用边看。</p>

        <div className={styles.tips}>
          {TIPS.map((t) => (
            <div key={t.title} className={styles.tip}>
              <span className={styles.tipIcon}>{t.icon}</span>
              <span className={styles.tipTitle}>{t.title}</span>
              <span className={styles.tipDesc}>{t.desc}</span>
            </div>
          ))}
        </div>

        {agents.length > 0 && (
          <>
            <div className={`${styles.section} mono`}>从一个 agent 开始 START WITH AN AGENT</div>
            <div className={styles.agents}>
              {agents.map((a) => {
                const p = profiles?.find((x) => x.userID === a.userID)
                return (
                  <div key={a.userID} className={styles.agent}>
                    <Avatar glyph={glyphOf(a.nickname)} pair={0} size={36} kind="agent" id={a.userID} src={avatars[a.userID]} />
                    <div className={styles.agentText}>
                      <div className={styles.agentHead}>
                        <span className={styles.agentName}>{a.nickname}</span>
                        <span className={`${styles.agentTag} mono`}>{a.tag || 'AGENT'}</span>
                      </div>
                      <div className={styles.agentDesc}>{p?.description || '还没写自我介绍——直接问它能做什么。'}</div>
                    </div>
                    <button className={styles.agentGo} onClick={() => start(a.userID)}>开始对话</button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className={styles.foot}>
          <span className={styles.footText}>频道要有人拉你进去：让邀请你的人把你加进频道，或者自己建一个、把人拉进来。</span>
          <span className={styles.footBtns}>
            <button className={styles.ghost} onClick={() => useUI.getState().openDialog({ kind: 'newChannel' })}>新建频道</button>
            <button className={styles.ghost} onClick={() => useUI.getState().setSettingsPage('members')}>邀请同事</button>
            <button className={styles.primary} onClick={() => setWelcome(false)}>先逛逛</button>
          </span>
        </div>
      </div>
    </div>
  )
}
