import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 应用元素的入场动画一律用 `backwards` 填充，不用 `both`。
 *
 * `both` 会让动画结束后继续保留终帧。终帧写的是 `transform: none`，但计算值落成单位矩阵
 * `matrix(1, 0, 0, 1, 0, 0)`，而单位矩阵照样让元素成为固定定位后代的包含块和层叠上下文。
 * 0.3.4 的启动编排就是这样把 `main` 变成了包含块，灯箱、表情弹层和「更多」菜单三处一起错位：
 * 遮罩只盖住主区，弹层整体偏移主区原点。`backwards` 结束后回到 `none`，问题不存在。
 *
 * tokens.css 里的 `::view-transition-*` 是例外：那些伪元素只在过渡期间存在，靠填充维持首尾帧。
 */
const root = join(__dirname, '../../')

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? cssFiles(p) : e.name.endsWith('.css') ? [p] : []
  })
}

describe('动画填充模式', () => {
  it('src 下没有 animation ... both', () => {
    const offenders = cssFiles(join(root, 'src'))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n')
        .map((line, i) => ({ f: f.slice(root.length), i: i + 1, line }))
        .filter(({ line }) => /animation:[^;]*\bboth\b/.test(line)))
      .map(({ f, i, line }) => `${f}:${i} ${line.trim()}`)
    expect(offenders).toEqual([])
  })

  it('tokens.css 里只有过渡伪元素还用 both', () => {
    const lines = readFileSync(join(root, 'styles/tokens.css'), 'utf8').split('\n')
      .filter((l) => /animation:[^;]*\bboth\b/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).toMatch(/::view-transition-(old|new)\(/)
  })
})
