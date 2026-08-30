import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export type BacktickInsertion = 'default' | 'literal' | 'fence'

/**
 * Keeps ordinary inline-code pairing with CodeMirror, but treats the first
 * three backticks on an otherwise blank line as one Markdown fence opener.
 */
export function backtickInsertionAt(
  lineText: string,
  offset: number,
): BacktickInsertion {
  const before = lineText.slice(0, offset)
  const after = lineText.slice(offset)

  if (!/^ {0,3}`{0,2}$/.test(before) || !/^\s*$/.test(after)) return 'default'
  return before.endsWith('``') ? 'fence' : 'literal'
}

export const markdownBacktickPairing = EditorView.inputHandler.of(
  (view, from, to, text, insert) => {
    if (text !== '`' || from !== to || !view.state.selection.main.empty) return false

    const line = view.state.doc.lineAt(from)
    const insertion = backtickInsertionAt(line.text, from - line.from)
    if (insertion === 'default') return false

    if (insertion === 'literal') {
      view.dispatch(insert())
      return true
    }

    // The first two keystrokes are already in the document. Insert the typed
    // third backtick plus a three-backtick closer, leaving the caret between.
    view.dispatch({
      changes: { from, insert: '````' },
      selection: EditorSelection.cursor(from + 1),
      scrollIntoView: true,
      userEvent: 'input.type',
    })
    return true
  },
)
