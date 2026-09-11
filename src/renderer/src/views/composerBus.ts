import type { MessageId, OutgoingAttachment } from '../../../shared/model'

/**
 * 别处想往输入框里塞东西时走这里，不用把输入框的 ref 传遍整棵树：
 * 侧栏的 agent 芯片、悬浮条的「转交给 agent」塞文字；主区的拖放塞文件；
 * 发送失败时会话 store 把整条草稿还回来。
 */
type TextListener = (text: string) => void
type FilesListener = (files: File[]) => void
export interface RestoredDraft { text: string; attachments: OutgoingAttachment[]; quote: MessageId | null }
type RestoreListener = (conversationId: string, draft: RestoredDraft) => void
const textListeners = new Set<TextListener>()
const fileListeners = new Set<FilesListener>()
const restoreListeners = new Set<RestoreListener>()

export const composerBus = {
  insert(text: string): void { for (const l of textListeners) l(text) },
  subscribe(l: TextListener): () => void { textListeners.add(l); return () => { textListeners.delete(l) } },
  /** 拖进来的文件：进输入框的附件栏，不直接发 */
  attach(files: File[]): void { for (const l of fileListeners) l(files) },
  onAttach(l: FilesListener): () => void { fileListeners.add(l); return () => { fileListeners.delete(l) } },
  /** 没发出去：文字和附件原样回到输入框，人改一改再发，不用重新找文件 */
  restore(conversationId: string, draft: RestoredDraft): void { for (const l of restoreListeners) l(conversationId, draft) },
  onRestore(l: RestoreListener): () => void { restoreListeners.add(l); return () => { restoreListeners.delete(l) } },
}
