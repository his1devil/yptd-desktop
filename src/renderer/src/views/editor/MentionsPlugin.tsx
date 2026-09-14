import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin, MenuOption, type MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { $createTextNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_NORMAL, type TextNode } from 'lexical'
import { Avatar, glyphOf, pairOf } from '../../components/Avatar'
import type { Mentionable } from '../../store/mentions'
import { $createMentionNode } from './MentionNode'
import styles from '../Composer.module.css'

/**
 * 打 @ 弹候选，选中插入一个原子色块。
 *
 * 触发规则自己写而不用官方的 useBasicTypeaheadTriggerMatch：它的正则按英文单词边界切，
 * 中文名字匹配不上。这里按「@ 前面是行首或空白/标点」判断，查询串可以是任意非空白字符。
 *
 * 组字（拼音输入）期间不弹：官方插件本身会看 isComposing，我们再在触发函数里挡一道，
 * 免得拼音的字母被当成查询串。
 */
class Option extends MenuOption {
  constructor(readonly who: Mentionable) { super(who.id) }
}

const BOUNDARY = /[\s(（,，。:：;；!！?？、]/

export function trigger(text: string): MenuTextMatch | null {
  const at = text.lastIndexOf('@')
  if (at < 0) return null
  const before = at === 0 ? '' : text[at - 1]!
  if (before && !BOUNDARY.test(before)) return null
  const query = text.slice(at + 1)
  if (query.length > 20 || /\s/.test(query)) return null
  return { leadOffset: at, matchingString: query, replaceableString: `@${query}` }
}

export function MentionsPlugin({ candidates }: { candidates: Mentionable[] }) {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  // 组字期间把候选清空。菜单本身的回车处理不看组字状态（读过它的源码），候选一空它就不接管回车，
  // 于是「打 @ 再敲拼音，回车想确认候选字」不会变成「插入了一个 @ 色块」。
  useEffect(() => editor.registerRootListener((root, prev) => {
    const on = (): void => setComposing(true)
    const off = (): void => setComposing(false)
    prev?.removeEventListener('compositionstart', on)
    prev?.removeEventListener('compositionend', off)
    root?.addEventListener('compositionstart', on)
    root?.addEventListener('compositionend', off)
  }), [editor])

  const options = useMemo(() => {
    if (query === null || composing) return []
    const q = query.toLowerCase()
    return candidates.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8).map((c) => new Option(c))
  }, [query, composing, candidates])

  const pick = useCallback((option: Option, nodeToReplace: TextNode | null, close: () => void) => {
    editor.update(() => {
      const chip = $createMentionNode(option.who.id, option.who.isAgent, `@${option.who.name}`)
      if (nodeToReplace) nodeToReplace.replace(chip)
      else {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.insertNodes([chip])
      }
      // 后面补一个空格，接着打字不会粘到色块上
      const space = $createTextNode(' ')
      chip.insertAfter(space)
      space.select()
    })
    close()
  }, [editor])

  return (
    <LexicalTypeaheadMenuPlugin<Option>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={pick}
      triggerFn={(text, ed) => (ed.isComposing() ? null : trigger(text))}
      // 比输入框的回车处理高一级：菜单开着时回车是「选中候选」，不是「发送」
      commandPriority={COMMAND_PRIORITY_NORMAL}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorRef.current && options.length > 0
          ? createPortal(
              <div className={styles.menu}>
                {options.map((o, i) => (
                  <button
                    key={o.who.id}
                    className={`${styles.menuItem} ${i === selectedIndex ? styles.menuActive : ''}`}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onMouseDown={(e) => { e.preventDefault(); selectOptionAndCleanUp(o) }}
                  >
                    <Avatar glyph={glyphOf(o.who.name)} pair={pairOf(o.who.id)} size={22} kind={o.who.isAgent ? 'agent' : 'human'} id={o.who.id} src={o.who.avatar} />
                    <span className={styles.menuName}>{o.who.name}</span>
                    {o.who.isAgent && <span className={`${styles.menuTag} mono`}>{o.who.tag || 'AGENT'}</span>}
                  </button>
                ))}
              </div>,
              anchorRef.current,
            )
          : null
      }
    />
  )
}
