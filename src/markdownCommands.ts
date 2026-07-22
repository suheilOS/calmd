import { syntaxTree } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { GFM } from '@lezer/markdown'

type MarkdownDelimiter = '*' | '**' | '~~' | '`'

const parserExtensions = [markdown({ extensions: GFM })]

const syntaxByDelimiter: Record<MarkdownDelimiter, { mark: string; node: string }> = {
  '*': { mark: 'EmphasisMark', node: 'Emphasis' },
  '**': { mark: 'EmphasisMark', node: 'StrongEmphasis' },
  '~~': { mark: 'StrikethroughMark', node: 'Strikethrough' },
  '`': { mark: 'CodeMark', node: 'InlineCode' },
}

function parse(text: string) {
  return EditorState.create({ doc: text, extensions: parserExtensions })
}

function markerRanges(text: string, delimiter: MarkdownDelimiter) {
  const parsed = parse(text)
  const syntax = syntaxByDelimiter[delimiter]
  const ranges: { from: number; to: number }[] = []

  syntaxTree(parsed).iterate({
    enter(node) {
      if (node.name !== syntax.node) return

      const cursor = node.node.cursor()
      if (!cursor.firstChild()) return

      do {
        if (cursor.name === syntax.mark) {
          ranges.push({ from: cursor.from, to: cursor.to })
        }
      } while (cursor.nextSibling())
    },
  })

  return ranges
}

function isFullyCovered(text: string, delimiter: MarkdownDelimiter) {
  const parsed = parse(text)
  return isRangeFullyCovered(parsed, { from: 0, to: text.length }, delimiter)
}

function removeRanges(text: string, ranges: { from: number; to: number }[]) {
  let result = text

  for (const range of ranges.sort((a, b) => b.from - a.from)) {
    result = result.slice(0, range.from) + result.slice(range.to)
  }

  return result
}

function delimitersFor(text: string, delimiter: MarkdownDelimiter) {
  if (delimiter !== '`') return { before: delimiter, after: delimiter }

  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestRun + 1)
  const padding = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return { before: `${fence}${padding}`, after: `${padding}${fence}` }
}

function contentBounds(text: string) {
  const first = text.search(/\S/)
  if (first === -1) return null

  let last = text.length
  while (last > first && /\s/.test(text[last - 1])) last -= 1
  return { first, last }
}

function stripProtectiveCodePadding(text: string) {
  if (
    text.startsWith(' ')
    && text.endsWith(' ')
    && (text[1] === '`' || text[text.length - 2] === '`')
  ) {
    return { leading: 1, text: text.slice(1, -1) }
  }

  return { leading: 0, text }
}

function transformBlock(text: string, delimiter: MarkdownDelimiter, remove: boolean) {
  const bounds = contentBounds(text)
  if (!bounds) return text

  const leading = text.slice(0, bounds.first)
  const content = text.slice(bounds.first, bounds.last)
  const trailing = text.slice(bounds.last)

  if (remove) {
    let unwrapped = removeRanges(content, markerRanges(content, delimiter))
    if (delimiter === '`') unwrapped = stripProtectiveCodePadding(unwrapped).text
    return leading + unwrapped + trailing
  }

  const normalized = delimiter === '`'
    ? content
    : removeRanges(content, markerRanges(content, delimiter))
  const markers = delimitersFor(normalized, delimiter)
  return leading + markers.before + normalized + markers.after + trailing
}

type InlineInterval = { from: number; to: number }
type LinkParts = {
  from: number
  labelFrom: number
  labelTo: number
  to: number
  urlFrom: number
  urlTo: number
}
type FormattedNode = {
  contentFrom: number
  contentTo: number
  from: number
  marks: InlineInterval[]
  to: number
}

function headingContent(state: EditorState, from: number, to: number, setext: boolean) {
  if (setext) {
    const firstLine = state.doc.lineAt(from)
    return { from, to: firstLine.to }
  }

  const text = state.sliceDoc(from, to)
  const opening = text.match(/^ {0,3}#{1,6}(?:[\t ]+|$)/)
  const closing = text.match(/[\t ]+#+[\t ]*$/)
  return {
    from: from + (opening?.[0].length ?? 0),
    to: to - (closing?.[0].length ?? 0),
  }
}

function inlineContent(
  state: EditorState,
  node: { from: number; name: string; to: number },
) {
  if (node.name === 'Paragraph' || node.name === 'TableCell') {
    return { from: node.from, to: node.to }
  }
  if (/^ATXHeading[1-6]$/.test(node.name)) {
    return headingContent(state, node.from, node.to, false)
  }
  if (/^SetextHeading[12]$/.test(node.name)) {
    return headingContent(state, node.from, node.to, true)
  }
  return null
}

function inlineIntervals(state: EditorState, range: { from: number; to: number }) {
  const intervals: InlineInterval[] = []

  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      const content = inlineContent(state, node)
      if (!content) return

      const from = Math.max(content.from, range.from)
      const to = Math.min(content.to, range.to)
      if (from < to) intervals.push({ from, to })
    },
  })

  return intervals.sort((a, b) => a.from - b.from)
}

function crossesProtectedSyntax(
  state: EditorState,
  range: { from: number; to: number },
) {
  const protectedNodes = new Set([
    'URL',
    'LinkTitle',
    'InlineCode',
    'FencedCode',
    'CodeBlock',
    'HTMLBlock',
  ])
  let crossesBoundary = false

  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (
        protectedNodes.has(node.name)
        && (
          (node.from < range.from && node.to > range.from)
          || (node.from < range.to && node.to > range.to)
          || (
            (node.name === 'URL' || node.name === 'LinkTitle')
            && node.from <= range.from
            && node.to >= range.to
          )
        )
      ) {
        crossesBoundary = true
      }
    },
  })

  return crossesBoundary
}

function overlapsLink(state: EditorState, range: { from: number; to: number }) {
  let overlaps = false

  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (node.name === 'Link' && node.from < range.to && node.to > range.from) {
        overlaps = true
      }
    },
  })

  return overlaps
}

function isInlinePosition(state: EditorState, position: number) {
  if (state.doc.length === 0) return true

  let inline = false

  syntaxTree(state).iterate({
    from: Math.max(0, position - 1),
    to: Math.min(state.doc.length, position + 1),
    enter(node) {
      const content = inlineContent(state, node)

      if (content && content.from <= position && content.to >= position) {
        inline = true
      }
    },
  })

  return inline
}

function linkAt(state: EditorState, range: { from: number; to: number }) {
  const result: { value: LinkParts | null } = { value: null }

  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (node.name !== 'Link' || node.from > range.from || node.to < range.to) return

      const marks: InlineInterval[] = []
      let url: InlineInterval | null = null
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          if (cursor.name === 'LinkMark') marks.push({ from: cursor.from, to: cursor.to })
          if (cursor.name === 'URL') url = { from: cursor.from, to: cursor.to }
        } while (cursor.nextSibling())
      }

      if (marks.length >= 4 && url) {
        result.value = {
          from: node.from,
          labelFrom: marks[0].to,
          labelTo: marks[1].from,
          to: node.to,
          urlFrom: url.from,
          urlTo: url.to,
        }
      }
    },
  })

  return result.value
}

function containingFormat(
  state: EditorState,
  position: number,
  delimiter: MarkdownDelimiter,
) {
  const syntax = syntaxByDelimiter[delimiter]
  const result: {
    value: { from: number; to: number; marks: InlineInterval[] } | null
  } = { value: null }

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== syntax.node || node.from > position || node.to < position) return
      if (result.value && node.to - node.from >= result.value.to - result.value.from) return

      const marks: InlineInterval[] = []
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          if (cursor.name === syntax.mark) marks.push({ from: cursor.from, to: cursor.to })
        } while (cursor.nextSibling())
      }

      result.value = { from: node.from, to: node.to, marks }
    },
  })

  return result.value
}

function formattedNodes(state: EditorState, delimiter: MarkdownDelimiter) {
  const syntax = syntaxByDelimiter[delimiter]
  const nodes: FormattedNode[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== syntax.node) return

      const marks: InlineInterval[] = []
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          if (cursor.name === syntax.mark) marks.push({ from: cursor.from, to: cursor.to })
        } while (cursor.nextSibling())
      }

      if (marks.length >= 2) {
        nodes.push({
          contentFrom: marks[0].to,
          contentTo: marks[marks.length - 1].from,
          from: node.from,
          marks,
          to: node.to,
        })
      }
    },
  })

  return nodes
    .sort((a, b) => a.from - b.from || b.to - a.to)
    .filter((node, index, sorted) => !sorted.some(
      (other, otherIndex) => otherIndex < index && other.from <= node.from && other.to >= node.to,
    ))
}

function isRangeFullyCovered(
  state: EditorState,
  range: { from: number; to: number },
  delimiter: MarkdownDelimiter,
) {
  const nodes = formattedNodes(state, delimiter)
  const marks = nodes.flatMap((node) => node.marks)

  for (let position = range.from; position < range.to; position += 1) {
    if (/\s/.test(state.sliceDoc(position, position + 1))) continue
    if (marks.some((mark) => mark.from <= position && mark.to > position)) continue
    if (!nodes.some((node) => node.contentFrom <= position && node.contentTo > position)) return false
  }

  return nodes.some((node) => node.contentFrom < range.to && node.contentTo > range.from)
}

function removeFormatAcrossRange(
  state: EditorState,
  range: { anchor: number; from: number; head: number; to: number },
  delimiter: MarkdownDelimiter,
) {
  const nodes = formattedNodes(state, delimiter).filter(
    (node) => node.contentFrom < range.to && node.contentTo > range.from,
  )
  const changes: { from: number; to: number; insert: string }[] = []
  let delta = 0
  let selectionFrom = range.from
  let selectionTo = range.to

  nodes.forEach((node, index) => {
    const raw = state.sliceDoc(node.contentFrom, node.contentTo)
    const nestedMarks = markerRanges(raw, delimiter)
    const mapOffset = (position: number) => position - node.contentFrom - nestedMarks.reduce(
      (total, mark) => total + (mark.to <= position - node.contentFrom ? mark.to - mark.from : 0),
      0,
    )
    const withoutMarks = removeRanges(raw, nestedMarks)
    const normalizedCode = delimiter === '`'
      ? stripProtectiveCodePadding(withoutMarks)
      : { leading: 0, text: withoutMarks }
    const normalized = normalizedCode.text
    const selectedFrom = Math.max(
      0,
      mapOffset(Math.max(range.from, node.contentFrom)) - normalizedCode.leading,
    )
    const selectedTo = Math.min(
      normalized.length,
      mapOffset(Math.min(range.to, node.contentTo)) - normalizedCode.leading,
    )
    const before = transformBlock(normalized.slice(0, selectedFrom), delimiter, false)
    const selected = normalized.slice(selectedFrom, selectedTo)
    const after = transformBlock(normalized.slice(selectedTo), delimiter, false)
    const insert = before + selected + after
    const newNodeFrom = node.from + delta

    changes.push({ from: node.from, to: node.to, insert })
    if (index === 0) selectionFrom = newNodeFrom + before.length
    if (index === nodes.length - 1) selectionTo = newNodeFrom + before.length + selected.length
    delta += insert.length - (node.to - node.from)
  })

  return {
    changes,
    range: range.anchor <= range.head
      ? EditorSelection.range(selectionFrom, selectionTo)
      : EditorSelection.range(selectionTo, selectionFrom),
  }
}

export function toggleMarkdown(delimiter: MarkdownDelimiter): StateCommand {
  return ({ state, dispatch }) => {
    dispatch(state.update(state.changeByRange((range) => {
      if (range.empty) {
        const formatted = containingFormat(state, range.from, delimiter)
        if (formatted && formatted.marks.length >= 2) {
          const removedBeforeCursor = formatted.marks.reduce(
            (total, mark) => total + (mark.to <= range.from ? mark.to - mark.from : 0),
            0,
          )
          return {
            changes: formatted.marks.map((mark) => ({ from: mark.from, to: mark.to })),
            range: EditorSelection.cursor(range.from - removedBeforeCursor),
          }
        }

        if (!isInlinePosition(state, range.from)) return { range }

        const markers = delimitersFor('', delimiter)
        const insert = markers.before + markers.after
        return {
          changes: { from: range.from, insert },
          range: EditorSelection.cursor(range.from + markers.before.length),
        }
      }

      if (isRangeFullyCovered(state, range, delimiter)) {
        return removeFormatAcrossRange(state, range, delimiter)
      }

      if (crossesProtectedSyntax(state, range)) {
        return { range }
      }

      const intervals = inlineIntervals(state, range)
      const remove = intervals.every((interval) => {
        const text = state.sliceDoc(interval.from, interval.to)
        const bounds = contentBounds(text)
        return bounds && isFullyCovered(text.slice(bounds.first, bounds.last), delimiter)
      })
      const changes: { from: number; to: number; insert: string }[] = []
      let delta = 0
      let selectionFrom = range.from
      let selectionTo = range.to

      intervals.forEach((interval, index) => {
        const text = state.sliceDoc(interval.from, interval.to)
        const insert = transformBlock(text, delimiter, remove)
        const oldLength = interval.to - interval.from
        const newFrom = interval.from + delta
        const newTo = newFrom + insert.length
        const bounds = contentBounds(insert)

        changes.push({ from: interval.from, to: interval.to, insert })

        if (bounds) {
          const markers = remove ? { before: '', after: '' } : delimitersFor(
            removeRanges(
              text.slice(contentBounds(text)!.first, contentBounds(text)!.last),
              markerRanges(text.slice(contentBounds(text)!.first, contentBounds(text)!.last), delimiter),
            ),
            delimiter,
          )
          const contentFrom = newFrom + bounds.first + markers.before.length
          const contentTo = newTo - (insert.length - bounds.last) - markers.after.length
          if (index === 0) selectionFrom = contentFrom
          if (index === intervals.length - 1) selectionTo = contentTo
        }

        delta += insert.length - oldLength
      })

      return {
        changes,
        range: range.anchor <= range.head
          ? EditorSelection.range(selectionFrom, selectionTo)
          : EditorSelection.range(selectionTo, selectionFrom),
      }
    })))
    return true
  }
}

export const toggleLink: StateCommand = ({ state, dispatch }) => {
  const links = state.selection.ranges.map((range) => linkAt(state, range))
  const duplicateLink = links.some((link, index) => link && links.some(
    (other, otherIndex) => otherIndex < index && other?.from === link.from && other.to === link.to,
  ))
  const invalidRange = state.selection.ranges.some((range, index) => {
    if (links[index] || range.empty) return false
    const intervals = inlineIntervals(state, range)
    return overlapsLink(state, range)
      || intervals.length !== 1
      || intervals[0].from > range.from
      || intervals[0].to < range.to
  })

  if (duplicateLink || invalidRange) return false

  dispatch(state.update(state.changeByRange((range) => {
    const link = linkAt(state, range)
    if (link) {
      if (range.from >= link.urlFrom && range.to <= link.urlTo) {
        return { range: EditorSelection.range(link.urlFrom, link.urlTo) }
      }

      const label = state.sliceDoc(link.labelFrom, link.labelTo)
      const selectionFrom = Math.max(link.labelFrom, range.from) - link.labelFrom + link.from
      const selectionTo = Math.min(link.labelTo, range.to) - link.labelFrom + link.from
      const hasLabelSelection = range.from >= link.labelFrom && range.to <= link.labelTo

      return {
        changes: { from: link.from, to: link.to, insert: label },
        range: hasLabelSelection
          ? EditorSelection.range(selectionFrom, selectionTo)
          : EditorSelection.range(link.from, link.from + label.length),
      }
    }

    const label = range.empty ? 'text' : state.sliceDoc(range.from, range.to)
    const insert = `[${label}](url)`

    if (range.empty) {
      return {
        changes: { from: range.from, insert },
        range: EditorSelection.range(range.from + 1, range.from + 1 + label.length),
      }
    }

    const urlFrom = range.from + label.length + 3
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlFrom, urlFrom + 3),
    }
  })))
  return true
}
