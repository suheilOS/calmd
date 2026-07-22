import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import type { StateCommand } from '@codemirror/state'

export const insertNewlineContinueBlockquote: StateCommand = (target) =>
  exitEmptyBlockquote(target) || insertNewlineContinueMarkup(target)

const emptyBlockquote = /^[\t ]*(?:>[\t ]*)+$/

function exitEmptyBlockquote({ state, dispatch }: Parameters<StateCommand>[0]) {
  const lines = new Map<number, number>()

  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head)

    if (!range.empty || range.head !== line.to || !emptyBlockquote.test(line.text)) {
      return false
    }

    lines.set(line.from, line.to)
  }

  dispatch(state.update({
    changes: [...lines].map(([from, to]) => ({ from, to })),
    scrollIntoView: true,
    userEvent: 'input',
  }))
  return true
}
