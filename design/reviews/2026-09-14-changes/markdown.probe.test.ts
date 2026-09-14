import { expect, it } from 'vitest'
import { blocks } from '../../../src/renderer/src/views/markdown'

// This asserts the observed defect, not the desired behavior after a fix.
it('reproduces: an escaped pipe shifts the row and discards its final cell', () => {
  const parsed = blocks('| 表达式 | 描述 |\n|---|---|\n| a\\|b | 选择之一 |')
  expect(parsed).toEqual([{
    kind: 'table', head: ['表达式', '描述'], align: ['left', 'left'], rows: [['a\\', 'b']],
  }])
  expect(JSON.stringify(parsed)).not.toContain('选择之一')
})
