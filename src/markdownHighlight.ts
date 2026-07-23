import { tags } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const punctuation = /[\\p{P}\\p{S}]/u
const HighlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' }

/** Markdown highlight syntax using Obsidian's `==highlight==` delimiters. */
export const markdownHighlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': tags.content } },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [{
    name: 'Highlight',
    parse(cx, next, pos) {
      if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1

      const before = cx.slice(pos - 1, pos)
      const after = cx.slice(pos + 2, pos + 3)
      const spaceBefore = /\s|^$/.test(before)
      const spaceAfter = /\s|^$/.test(after)
      const punctuationBefore = punctuation.test(before)
      const punctuationAfter = punctuation.test(after)

      return cx.addDelimiter(
        HighlightDelimiter,
        pos,
        pos + 2,
        !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore),
        !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter),
      )
    },
    after: 'Emphasis',
  }],
}
