/**
 * 别处想往输入框里塞东西时走这里，不用把输入框的 ref 传遍整棵树：
 * 侧栏的 agent 芯片、悬浮条的「转交给 agent」塞文字；主区的拖放塞文件。
 */
type TextListener = (text: string) => void
type FilesListener = (files: File[]) => void
const textListeners = new Set<TextListener>()
const fileListeners = new Set<FilesListener>()

export const composerBus = {
  insert(text: string): void { for (const l of textListeners) l(text) },
  subscribe(l: TextListener): () => void { textListeners.add(l); return () => { textListeners.delete(l) } },
  /** 拖进来的文件：进输入框的附件栏，不直接发 */
  attach(files: File[]): void { for (const l of fileListeners) l(files) },
  onAttach(l: FilesListener): () => void { fileListeners.add(l); return () => { fileListeners.delete(l) } },
}
