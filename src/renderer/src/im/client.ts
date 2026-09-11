import { getWithRenderProcess } from '@openim/electron-client-sdk/render'
import { LoginStatus, LogLevel, MessageType, SdkEvent, SessionType } from '@openim/wasm-client-sdk'
import type { ConversationItem, GroupMemberItem, MessageItem, SdkResponse } from '@openim/wasm-client-sdk'
import { PLATFORM_ID, type ServerConfig } from './auth'

/**
 * 对 OpenIM 官方 SDK 的一层薄封装：把 `{errCode, errMsg, data}` 拆成"返回 data 或抛错"，
 * 把我们用到的十几个操作写成有类型的函数，事件订阅收口到一处。
 *
 * 不做业务：翻译、折叠、去重都在 translate.ts / 会话 store 里。
 */

const { instance: sdk } = getWithRenderProcess()

export class IMError extends Error {
  constructor(readonly code: number, message: string) { super(message); this.name = 'IMError' }
  /** 10102：这个 SDK 实例已经登录过了——重连时接着用即可 */
  get alreadyLoggedIn(): boolean { return this.code === 10102 }
}

async function unwrap<T>(p: Promise<SdkResponse<T>>): Promise<T> {
  const r = await p
  if (r.errCode !== 0) throw new IMError(r.errCode, r.errMsg || `SDK 错误 ${r.errCode}`)
  return r.data
}

export const im = {
  /** 已经登录了吗——重连、HMR 后再进来时先问一句，避免重复 init/login */
  async loggedIn(): Promise<boolean> {
    try { return (await unwrap(sdk.getLoginStatus())) === LoginStatus.LoggedIn } catch { return false }
  },
  async init(cfg: ServerConfig, dataDir: string): Promise<void> {
    try {
      await sdk.initSDK({
        apiAddr: cfg.api, wsAddr: cfg.ws, platformID: PLATFORM_ID, dataDir,
        systemType: 'electron', logLevel: LogLevel.Warn, isLogStandardOutput: false,
      })
    } catch {
      // 主进程里的核心已经 init 过了（重连 / 开发热更）——它是有状态的，再 init 会抛，忽略即可
    }
  },
  async login(userID: string, token: string): Promise<void> {
    try {
      await unwrap(sdk.login({ userID, token }))
    } catch (e) {
      if (!(e instanceof IMError && e.alreadyLoggedIn)) throw e
    }
  },
  logout: () => unwrap(sdk.logout()),

  conversations: () => unwrap(sdk.getAllConversationList()),
  /** 一页历史，`before` 是更早那一页的起点（最老那条的 clientMsgID），空串从最新开始 */
  history: (conversationID: string, before: string, count: number) =>
    unwrap(sdk.getAdvancedHistoryMessageList({ conversationID, startClientMsgID: before, count, viewType: 0 })),
  markRead: (conversationID: string) => unwrap(sdk.markConversationMessageAsRead(conversationID)),
  markAllRead: () => unwrap(sdk.markAllConversationMessageAsRead()),
  /** 本地全文搜索（所有会话），给 ⌘K 用 */
  searchMessages: (keyword: string, count = 30) =>
    unwrap(sdk.searchLocalMessages({
      conversationID: '', keywordList: [keyword], keywordListMatchType: 0, senderUserIDList: [],
      messageTypeList: [], searchTimePosition: 0, searchTimePeriod: 0, pageIndex: 1, count,
    })),
  members: (groupID: string) => unwrap(sdk.getGroupMemberList({ groupID, filter: 0, offset: 0, count: 200 })),
  atAllTag: () => unwrap(sdk.getAtAllTag()),
  self: () => unwrap(sdk.getSelfUserInfo()),
  /** 一批人的公开资料——头像在这里，名册接口不给 */
  users: (userIDs: string[]) => unwrap(sdk.getUsersInfo(userIDs)),

  createText: (text: string) => unwrap(sdk.createTextMessage(text)),
  createAt: (text: string, ids: string[], names: Record<string, string>, quote?: MessageItem) =>
    unwrap(sdk.createTextAtMessage({
      text, atUserIDList: ids,
      atUsersInfo: ids.map((id) => ({ atUserID: id, groupNickname: names[id] ?? id })),
      message: quote,
    })),
  // 被引用的消息以 JSON 字符串传——SDK 要的是它自己吐出来的原文
  createQuote: (text: string, message: MessageItem) =>
    unwrap(sdk.createQuoteMessage({ text, message: JSON.stringify(message) })),
  createCustom: (data: string, description: string) => unwrap(sdk.createCustomMessage({ data, description, extension: '' })),
  createImage: (path: string) => unwrap(sdk.createImageMessageFromFullPath(path)),
  async createFile(fileFullPath: string, fileName: string): Promise<MessageItem> {
    // 这个方法的返回类型里带一个空串：路径读不出来时 SDK 不报错，给个空
    const m = await unwrap(sdk.createFileMessageFromFullPath(fileFullPath, fileName))
    if (!m) throw new IMError(-1, '这个文件读不出来')
    return m
  },

  /** 发出去，回来的是服务端记录的那条：真 id、真时间、真图片地址——别信自己手里的那份。 */
  send(message: MessageItem, to: { groupID?: string; userID?: string }): Promise<MessageItem> {
    return unwrap(sdk.sendMessage({ recvID: to.userID ?? '', groupID: to.groupID ?? '', message }))
  },
  revoke: (conversationID: string, clientMsgID: string) => unwrap(sdk.revokeMessage({ conversationID, clientMsgID })),
  find: (conversationID: string, clientMsgIDList: string[]) =>
    unwrap(sdk.findMessageList([{ conversationID, clientMsgIDList }])),

  setSelf: (info: { nickname?: string; faceURL?: string }) => unwrap(sdk.setSelfInfo(info)),
  upload: (filepath: string, name: string) =>
    unwrap(sdk.uploadFile({ filepath, name, contentType: '', uuid: `${Date.now()}-${name}`, cause: 'avatar' })),

  createGroup: (groupName: string, memberUserIDs: string[]) =>
    unwrap(sdk.createGroup({ memberUserIDs, groupInfo: { groupName, groupType: 2 }, adminUserIDs: [] })),
  invite: (groupID: string, userIDs: string[], reason = '') =>
    unwrap(sdk.inviteUserToGroup({ groupID, userIDList: userIDs, reason })),
  quitGroup: (groupID: string) => unwrap(sdk.quitGroup(groupID)),
  dismissGroup: (groupID: string) => unwrap(sdk.dismissGroup(groupID)),
  renameGroup: (groupID: string, groupName: string) => unwrap(sdk.setGroupInfo({ groupID, groupName })),
  forget: (conversationID: string) => unwrap(sdk.deleteConversationAndDeleteAllMsg(conversationID)),

  /** 订阅一个事件；返回退订。 */
  on<E extends SdkEvent>(event: E, fn: (data: unknown) => void): () => void {
    const handler = (envelope: { data: unknown }): void => fn(envelope.data)
    // 类型上 Emitter 对每个事件有各自的 payload 类型；这里统一收成 unknown，由调用方解
    ;(sdk as unknown as { on(e: E, f: (x: { data: unknown }) => void): void }).on(event, handler)
    return () => (sdk as unknown as { off(e: E, f: (x: { data: unknown }) => void): void }).off(event, handler)
  },
}

export { SdkEvent, MessageType, SessionType }
export type { ConversationItem, GroupMemberItem, MessageItem }
