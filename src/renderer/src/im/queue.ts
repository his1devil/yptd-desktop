/**
 * 一屏图片按什么顺序去拿。
 *
 * 实测过的事实：**四条并发下载的总吞吐和一条一模一样**——这台服务器的出口是所有人共用的
 * 硬上限（~260 KB/s），不是每条连接的上限。所以同时要六张图不会让任何一张更早到，只会让
 * 六张一起在最后出现，而不是一张一张出来。
 *
 * 但也不是全都该串行。每个对象有约 0.5 秒与体积无关的固定开销（两跳各一次往返），对一张
 * 几 KB 的头像来说那半秒**就是**下载本身，几张并行是有收益的。所以分两道：
 *
 * - **小**（头像、缩略档）：3 条。延迟受限，重叠划算。
 * - **大**（主图、原图、视频、文件）：1 条。带宽受限，重叠纯亏——而且一张下完就是一张
 *   出现在屏幕上，好过三张各下一半。
 *
 * 同一道里是**后进先出**。快速滚动的人身后拖着一串请求，他现在正在看的是最新那个，不该
 * 排在他已经划过去的一整屏后面。
 *
 * 优先级只在这一层做。主进程那边只有一个纯兜底的信号量（见 mediaStore），不重排——
 * 谁在视口里只有渲染进程知道。
 */

export type Lane = 'small' | 'large'

const LIMIT: Record<Lane, number> = { small: 3, large: 1 }

const running: Record<Lane, number> = { small: 0, large: 0 }
const waiting: Record<Lane, (() => void)[]> = { small: [], large: [] }

function release(lane: Lane): void {
  running[lane]--
  // 后进先出：pop 而不是 shift
  waiting[lane].pop()?.()
}

async function slot(lane: Lane): Promise<void> {
  if (running[lane] < LIMIT[lane]) { running[lane]++; return }
  await new Promise<void>((r) => waiting[lane].push(r))
  running[lane]++
}

/** 排队跑一件事，完事（或者抛了）就让出位置 */
export async function inLane<T>(lane: Lane, work: () => Promise<T>): Promise<T> {
  await slot(lane)
  try {
    return await work()
  } finally {
    release(lane)
  }
}

/**
 * 让一张图排队加载：拿到位置才把地址交给 `<img>`。
 *
 * 靠「不给 src 就不发请求」这一点来控制——浏览器对 `<img>` 的请求时机我们插不上手，但
 * 可以决定什么时候给它地址。返回 null 表示还没轮到。
 */
export function laneFor(bytes: number | null | undefined, kind: 'avatar' | 'thumb' | 'main' | 'file'): Lane {
  if (kind === 'avatar' || kind === 'thumb') return 'small'
  // 主图有大有小：发送端报了字节数的，小的走快道
  if (kind === 'main' && typeof bytes === 'number' && bytes > 0 && bytes < 100 * 1024) return 'small'
  return 'large'
}

/** 测试用：把两条道清空 */
export function resetQueue(): void {
  running.small = 0
  running.large = 0
  waiting.small.length = 0
  waiting.large.length = 0
}
