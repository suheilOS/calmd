import {
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import type { SlashCommandIcon } from './slashCommandIcons'

const slashQuery = /(?:^|\s)\/[^\s/]*$/u
const horizontalWhitespace = /[\t ]/u

type InsertionSelection =
  | { kind: 'cursor-after' }
  | { kind: 'cursor-at'; offset: number }
  | { kind: 'range'; from: number; to: number }

type SlashInsertion = {
  icon: SlashCommandIcon
  label: string
  markdown: string
  selection: InsertionSelection
}

const insertions: readonly SlashInsertion[] = [
  {
    icon: 'slash-callout',
    label: 'Insert callout',
    markdown: '> [!note] Callout title\n> Callout content',
    selection: { kind: 'range', from: 10, to: 23 },
  },
  {
    icon: 'slash-table',
    label: 'Insert table',
    markdown: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n|  |  |',
    selection: { kind: 'range', from: 2, to: 10 },
  },
  {
    icon: 'slash-code',
    label: 'Insert code block',
    markdown: '```\n\n```',
    selection: { kind: 'cursor-at', offset: 4 },
  },
  {
    icon: 'slash-rule',
    label: 'Insert horizontal rule',
    markdown: '---',
    selection: { kind: 'cursor-after' },
  },
]

type ProtectedContext = 'none' | 'indented-code' | 'protected'

function protectedContext(context: CompletionContext): ProtectedContext {
  let node = syntaxTree(context.state).resolveInner(context.pos, -1)
  let insideIndentedCode = false
  while (node) {
    if (
      node.name === 'InlineCode'
      || node.name === 'FencedCode'
      || node.name === 'URL'
      || node.name === 'Autolink'
    ) return 'protected'
    if (node.name === 'CodeBlock') insideIndentedCode = true
    node = node.parent!
  }
  return insideIndentedCode ? 'indented-code' : 'none'
}

function selectionAfterInsertion(
  blockFrom: number,
  insertedLength: number,
  selection: InsertionSelection,
) {
  switch (selection.kind) {
    case 'cursor-after':
      return EditorSelection.cursor(blockFrom + insertedLength)
    case 'cursor-at':
      return EditorSelection.cursor(blockFrom + selection.offset)
    case 'range':
      return EditorSelection.range(blockFrom + selection.from, blockFrom + selection.to)
    default: {
      const exhaustive: never = selection
      return exhaustive
    }
  }
}

function blankLineSuffix(context: string) {
  if (context.startsWith('\n\n')) return ''
  if (context.startsWith('\n')) return '\n'
  return '\n\n'
}

function insertionOption(insertion: SlashInsertion): Completion {
  return {
    apply: (view, completion, from, to) => {
      const slashFrom = from - 1
      const line = view.state.doc.lineAt(slashFrom)
      const contentBeforeSlash = view.state.sliceDoc(line.from, slashFrom).trim().length > 0
      let replaceFrom = contentBeforeSlash ? slashFrom : line.from
      while (
        contentBeforeSlash
        && replaceFrom > line.from
        && horizontalWhitespace.test(view.state.sliceDoc(replaceFrom - 1, replaceFrom))
      ) replaceFrom -= 1

      const prefix = contentBeforeSlash ? '\n\n' : ''
      const suffix = blankLineSuffix(view.state.sliceDoc(to, to + 2))
      const inserted = `${prefix}${insertion.markdown}${suffix}`
      const blockFrom = replaceFrom + prefix.length

      view.dispatch({
        annotations: pickedCompletion.of(completion),
        changes: { from: replaceFrom, to, insert: inserted },
        scrollIntoView: true,
        selection: selectionAfterInsertion(
          blockFrom,
          insertion.markdown.length + suffix.length,
          insertion.selection,
        ),
        userEvent: 'input.complete',
      })
    },
    label: insertion.label,
    type: insertion.icon,
  }
}

/** Offers block insertions after a slash typed at line start or after whitespace. */
export const slashCommandCompletion: CompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  if (!context.state.selection.main.empty || context.state.selection.ranges.length !== 1) return null

  const line = context.state.doc.lineAt(context.pos)
  if (context.pos !== line.to) return null

  const beforeCursor = context.state.sliceDoc(line.from, context.pos)
  if (!slashQuery.test(beforeCursor)) return null

  const slashIndex = beforeCursor.lastIndexOf('/')
  const hasContentBeforeSlash = beforeCursor.slice(0, slashIndex).trim().length > 0
  const contextKind = protectedContext(context)
  if (contextKind === 'protected' || (contextKind === 'indented-code' && hasContentBeforeSlash)) {
    return null
  }
  return {
    from: line.from + slashIndex + 1,
    options: insertions.map(insertionOption),
    validFor: /^[^\s/]*$/u,
  }
}
