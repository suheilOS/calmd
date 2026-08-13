import type { StateCommand } from '@codemirror/state'

export type MarkdownBlockKind =
  | 'paragraph'
  | `heading-${1 | 2 | 3 | 4 | 5 | 6}`
  | 'quote'
  | 'bullet'
  | 'ordered'
  | 'task'

const structuralPrefix = /^([\t ]*)(?:(?:#{1,6}[\t ]+)|(?:>[\t ]?)|(?:[-+*][\t ]+\[[ xX]\][\t ]+)|(?:[-+*][\t ]+)|(?:\d+[.)][\t ]+))?/

function prefixFor(kind: MarkdownBlockKind, index: number) {
  if (kind === 'paragraph') return ''
  if (kind.startsWith('heading-')) {
    return `${'#'.repeat(Number(kind.slice('heading-'.length)))} `
  }
  if (kind === 'quote') return '> '
  if (kind === 'bullet') return '- '
  if (kind === 'ordered') return `${index + 1}. `
  return '- [ ] '
}

/** Applies one structural Markdown kind to every line touched by the selection. */
export function setMarkdownBlock(kind: MarkdownBlockKind): StateCommand {
  return ({ state, dispatch }) => {
    const lineNumbers = new Set<number>()
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number
      let last = state.doc.lineAt(range.to).number
      if (!range.empty && range.to === state.doc.line(last).from) last -= 1
      for (let number = first; number <= last; number += 1) lineNumbers.add(number)
    }

    let previousLine: number | null = null
    const orderedIndexes = new Map<string, number>()
    const changes = [...lineNumbers]
      .sort((left, right) => left - right)
      .flatMap((number) => {
        if (previousLine !== number - 1) orderedIndexes.clear()
        previousLine = number
        const line = state.doc.line(number)
        const match = line.text.match(structuralPrefix)
        const indentation = match?.[1] ?? ''
        for (const existingIndentation of orderedIndexes.keys()) {
          if (existingIndentation.length > indentation.length) {
            orderedIndexes.delete(existingIndentation)
          }
        }
        const orderedIndex = orderedIndexes.get(indentation) ?? 0
        orderedIndexes.set(indentation, orderedIndex + 1)
        const prefixStart = line.from + indentation.length
        const prefixEnd = line.from + (match?.[0].length ?? indentation.length)
        const replacement = prefixFor(kind, orderedIndex)
        const currentPrefix = line.text.slice(indentation.length, prefixEnd - line.from)
        return replacement === currentPrefix
          ? []
          : [{ from: prefixStart, to: prefixEnd, insert: replacement }]
      })

    if (changes.length === 0) return false
    dispatch(state.update({
      changes,
      scrollIntoView: true,
      userEvent: 'input',
    }))
    return true
  }
}
