import { syntaxTree } from '@codemirror/language'
import type { EditorState, StateCommand } from '@codemirror/state'

/** Structural source transformations available to editor callers. */
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

function parsedHeadingKind(state: EditorState, position: number): MarkdownBlockKind | null {
  let node = syntaxTree(state).resolveInner(position, 1)
  while (node.parent) {
    const atx = node.name.match(/^ATXHeading([1-6])$/)
    if (atx) {
      switch (atx[1]) {
        case '1': return 'heading-1'
        case '2': return 'heading-2'
        case '3': return 'heading-3'
        case '4': return 'heading-4'
        case '5': return 'heading-5'
        case '6': return 'heading-6'
      }
    }
    if (node.name === 'SetextHeading1') return 'heading-1'
    if (node.name === 'SetextHeading2') return 'heading-2'
    node = node.parent
  }
  return null
}

function blockKindForLine(state: EditorState, number: number): MarkdownBlockKind {
  const line = state.doc.line(number)
  const parsedHeading = parsedHeadingKind(state, line.from)
  if (parsedHeading) return parsedHeading
  const text = line.text
  const marker = text.match(structuralPrefix)?.[0].trimStart() ?? ''
  const heading = marker.match(/^(#{1,6})[\t ]+/)
  if (heading) {
    switch (heading[1].length) {
      case 1: return 'heading-1'
      case 2: return 'heading-2'
      case 3: return 'heading-3'
      case 4: return 'heading-4'
      case 5: return 'heading-5'
      case 6: return 'heading-6'
    }
  }
  if (/^>/.test(marker)) return 'quote'
  if (/^[-+*][\t ]+\[[ xX]\]/.test(marker)) return 'task'
  if (/^[-+*][\t ]+/.test(marker)) return 'bullet'
  if (/^\d+[.)][\t ]+/.test(marker)) return 'ordered'
  return 'paragraph'
}

/** Returns the shared block kind for the selected lines, or mixed for unlike lines. */
export function selectedMarkdownBlockKind(
  state: EditorState,
): MarkdownBlockKind | 'mixed' {
  const kinds = new Set<MarkdownBlockKind>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    let last = state.doc.lineAt(range.to).number
    if (!range.empty && range.to === state.doc.line(last).from) last -= 1
    for (let number = first; number <= last; number += 1) {
      kinds.add(blockKindForLine(state, number))
    }
  }
  return kinds.size === 1 ? [...kinds][0] : 'mixed'
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
        const sourcePrefix = match?.[0] ?? ''
        const indentation = match?.[1] ?? ''
        const marker = sourcePrefix.slice(indentation.length)
        const preservesContainerIndentation = /^(?:>|[-+*]|\d+[.)])/.test(marker)
        const normalizedIndentation = kind.startsWith('heading-')
          && indentation.length >= 4
          && !preservesContainerIndentation
          ? ''
          : indentation
        for (const existingIndentation of orderedIndexes.keys()) {
          if (existingIndentation.length > indentation.length) {
            orderedIndexes.delete(existingIndentation)
          }
        }
        const orderedIndex = orderedIndexes.get(indentation) ?? 0
        orderedIndexes.set(indentation, orderedIndex + 1)
        const prefixStart = line.from + normalizedIndentation.length
        const prefixEnd = line.from + sourcePrefix.length
        const replacement = prefixFor(kind, orderedIndex)
        const currentPrefix = line.text.slice(normalizedIndentation.length, prefixEnd - line.from)
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
