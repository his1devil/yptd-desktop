import { create } from 'zustand'
import type { UpdateStatus } from '../../../shared/ipc'

/** 自动更新的状态镜像。主进程推什么这里就是什么；横幅和设置页都读它。 */
interface UpdateState {
  status: UpdateStatus
  /** 用户对某个版本的横幅点了"稍后"，这个版本就不再弹 */
  dismissed: string | null
  check(): Promise<void>
  install(): void
  dismiss(): void
}

export const useUpdate = create<UpdateState>()((set, get) => ({
  status: { kind: 'idle' },
  dismissed: null,
  async check() { await window.desktop.update.check() },
  install() { window.desktop.update.install() },
  dismiss() {
    const s = get().status
    if (s.kind === 'ready' || s.kind === 'available' || s.kind === 'downloading') set({ dismissed: s.version })
  },
}))

if (typeof window !== 'undefined' && window.desktop?.update) {
  void window.desktop.update.status().then((status) => useUpdate.setState({ status }))
  window.desktop.update.onStatus((status) => useUpdate.setState({ status }))
}
