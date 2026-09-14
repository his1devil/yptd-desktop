import type { Member, Person } from '../../../shared/model'
import type { Mentions } from '../views/rich'
import type { Place } from './selectors'

/*
 * @ 的两件事：谁能被 @（输入框的候选），以及正文里的 @名字 怎么画。
 *
 * 单独一个模块，依赖全是 type-only：selectors 会把 session 连带拉进来，而 session 顶上
 * 就初始化了 OpenIM SDK，一碰就要 window。这两个函数是纯计算，不该为此进不了测试。
 */

/**
 * 能被 @ 的人：只有这个会话里的人。
 *
 * 频道里就是群成员——不在群里的人（agent 也一样）@ 了收不到，列出来就会被选中，
 * 于是发出去一条指望别人回应的消息，而那个人根本看不见。成员还没拉下来时宁可一个
 * 候选都不给，也不要退回整本名册。
 *
 * 私聊里只有对面那一个。@ 第三个人不会把他叫来，这里 @ 谁都只有你们俩看得到。
 */
export interface Mentionable { id: string; name: string; isAgent: boolean; avatar: string | null; tag: string | null }

export function mentionables(place: Place, roster: Person[], me: string): Mentionable[] {
  const agentTag = new Map(roster.filter((p) => p.isAgent).map((p) => [p.userID, p.tag]))
  const list: Mentionable[] = place.kind === 'channel'
    ? place.members.map((m) => ({ id: m.id, name: m.name, isAgent: m.isAgent || agentTag.has(m.id), avatar: m.avatar, tag: agentTag.get(m.id) ?? null }))
    : place.peer
      ? [{ id: place.peer.userID, name: place.peer.nickname, isAgent: place.peer.isAgent, avatar: place.avatar, tag: place.peer.tag }]
      : []
  return list
    .filter((p) => p.id !== me)
    .sort((a, b) => Number(b.isAgent) - Number(a.isAgent) || a.name.localeCompare(b.name, 'zh'))
}

/**
 * 消息正文里的 @名字 该怎么画。按「在不在这个会话里」分三档，见 rich.tsx。
 *
 * 频道的成员表还没拉下来时不知道谁在里面，这时按名册当作都在——闪一下满屏灰色比
 * 乐观地画对再改回来难看得多，而成员一到就会重算。
 */
export function mentionLook(place: Place | null, roster: Person[], myName: string): Mentions {
  const agents = new Set<string>()
  const members = new Set<string>()
  const outsiders = new Set<string>()
  if (!place) return { agents, members, outsiders }

  const unknown = place.kind === 'channel' && place.members.length === 0
  const here: { name: string; isAgent: boolean }[] = unknown
    ? roster.map((p) => ({ name: p.nickname, isAgent: p.isAgent }))
    : place.kind === 'channel'
      ? place.members.map((m) => ({ name: m.name, isAgent: m.isAgent }))
      : [
          ...(place.peer ? [{ name: place.peer.nickname, isAgent: place.peer.isAgent }] : []),
          { name: myName, isAgent: false },
        ]
  for (const p of here) (p.isAgent ? agents : members).add(p.name)
  for (const p of roster) {
    if (!agents.has(p.nickname) && !members.has(p.nickname)) outsiders.add(p.nickname)
  }
  // 自己的名字永远算「在场」：私聊、群里、被别人 @ 到，都该正常高亮
  if (myName && !agents.has(myName)) { members.add(myName); outsiders.delete(myName) }
  return { agents, members, outsiders }
}

/**
 * 从 `@` 后面那串字里认出一个名字，取认得出的最长前缀。
 *
 * 不靠正则猜边界。`@` 和名字之间没有分隔符，而名字可以是中英混排（「tui测试」）、
 * 后面还可能直接跟标点或汉字（「@JOMO也来」）——原来那条
 * `/@[A-Za-z][A-Za-z0-9_]*|@[一-龥]{2,4}/` 遇到「@tui测试」只认得出「@tui」，
 * 于是自己的名字从来没高亮过。有了确切的名单，就该拿名单去对，而不是猜。
 *
 * 返回空串表示这串字里没有任何认识的名字，那它就是普通文字。
 */
export function resolveMention(run: string, look: Mentions): string {
  for (let n = run.length; n > 0; n--) {
    const name = run.slice(0, n)
    if (look.agents.has(name) || look.members.has(name) || look.outsiders.has(name)) return name
  }
  return ''
}

/**
 * 你能看见的人：名册 + 所有你打开过的群里的成员。
 *
 * 名册只列开放了搜索的人，而同群的人不该因此从选人面板和 ⌘K 里消失——群成员表来自
 * OpenIM，本来就绕开了名册那道过滤，这里只是把两边合到一起。成员表是按需加载的，
 * 所以这份名单会随着你打开群而变长，这没关系：少列一个刚好是「还没见过」的意思。
 *
 * 从成员表补进来的人只知道名字和是不是 agent，不知道他允不允许被拉进群——按不允许
 * 算。他已经在那个群里了，不需要再被拉一次；要拉进别的群，等名册里出现他再说。
 */
export function knownPeople(roster: Person[], members: Record<string, Member[]>): Person[] {
  const out = new Map(roster.map((p) => [p.userID, p]))
  for (const list of Object.values(members)) {
    for (const m of list) {
      if (out.has(m.id)) continue
      out.set(m.id, { userID: m.id, nickname: m.name, isAgent: m.isAgent, tag: null, color: null, joinable: false })
    }
  }
  return [...out.values()]
}
