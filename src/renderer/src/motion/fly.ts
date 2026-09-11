import { reduceMotion } from './transition'

/**
 * 表情从你点的按钮飞到消息的回应行：动作有起点和终点，网络慢 300ms 也不觉得。
 * 一个临时节点走 Web Animations API，结束就删；只动 transform / opacity。
 */
export function flyEmoji(emoji: string, from: DOMRect, to: DOMRect): void {
  if (reduceMotion() || typeof document === 'undefined') return
  const el = document.createElement('span')
  el.textContent = emoji
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', lineHeight: '1',
    zIndex: '90', pointerEvents: 'none', willChange: 'transform',
  })
  document.body.appendChild(el)
  const dx = to.left + 12 - from.left
  const dy = to.top - from.top
  const anim = el.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 22}px) scale(1.45)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.85)`, opacity: 0.6 },
    ],
    { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' },
  )
  anim.onfinish = () => el.remove()
  anim.oncancel = () => el.remove()
}
