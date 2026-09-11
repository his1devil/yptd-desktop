import { useLayoutEffect, useRef, type RefObject } from 'react'
import { reduceMotion } from './transition'

/**
 * 列表重排时每一项从旧位置滑到新位置（FLIP）：提交后、画之前量新位置，和上一次的差
 * 写成一段 transform 动画。子元素带 `data-flip="<稳定 id>"`；新出现的项没有旧位置，不动。
 */
export function useFlip(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const next = new Map<string, number>()
    const quiet = reduceMotion()
    for (const item of root.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = item.dataset.flip ?? ''
      const top = item.getBoundingClientRect().top
      next.set(id, top)
      const prev = last.current.get(id)
      if (!quiet && prev !== undefined && Math.abs(prev - top) > 1) {
        item.animate([{ transform: `translateY(${prev - top}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    last.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 调用方给出会引起重排的依赖
  }, deps)
}
