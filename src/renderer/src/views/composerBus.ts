/**
 * 别处想往输入框里塞字（侧栏的 agent 芯片、悬浮条的「转交给 agent」）时走这里，
 * 不用把输入框的 ref 传遍整棵树。
 */
type Listener = (text: string) => void
const listeners = new Set<Listener>()

export const composerBus = {
  insert(text: string): void { for (const l of listeners) l(text) },
  subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l) } },
}
