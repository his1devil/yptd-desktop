/**
 * OpenIM 的错误文案每经过一层就被重新包一次：RPC 包一遍、网关再包一遍、SDK 又包一遍，
 * 每层都在前面粘上错误码，正文也跟着抄一份。一句「没有开放被加入群聊」传到界面上会变成
 *
 *   10001 10001 张三 没有开放被加入群聊 10001 张三 没有开放被加入群聊
 *
 * 这是上游的包装方式，改不了；能做的是在唯一要把它显示给人看的地方收干净。
 */

/** 把层层包装留下的错误码和重复正文收掉，只留人要看的那一句。 */
export function tidyError(message: string, code?: number): string {
  let s = message.trim()
  if (code !== undefined && code !== 0) {
    // 每一层都粘了一次错误码，全部去掉——界面上显示一串数字对谁都没用
    s = s.split(String(code)).join(' ')
  }
  s = s.replace(/\s+/g, ' ').trim()
  return unrepeat(s)
}

/** 整句被首尾相接地拼了两遍时只留一份。半句重复不动它：那可能本来就是原文。 */
function unrepeat(s: string): string {
  const mid = (s.length - 1) / 2
  if (Number.isInteger(mid) && s[mid] === ' ') {
    const head = s.slice(0, mid)
    if (head && head === s.slice(mid + 1)) return head
  }
  return s
}
