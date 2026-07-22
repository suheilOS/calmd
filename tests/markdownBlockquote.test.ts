import { describe, expect, test } from 'bun:test'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { insertNewlineContinueBlockquote } from '../src/markdownBlockquote'

function run(command: StateCommand, state: EditorState) {
  command({
    state,
    dispatch: (transaction) => {
      state = transaction.state
    },
  })

  return state
}

function editorState(doc: string) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(doc.length),
    extensions: [markdown({ extensions: GFM })],
  })
}

describe('insertNewlineContinueBlockquote', () => {
  test('continues a quote once, then exits from its untouched empty line', () => {
    let state = editorState('> A thought')

    state = run(insertNewlineContinueBlockquote, state)
    expect(state.doc.toString()).toBe('> A thought\n> ')

    state = run(insertNewlineContinueBlockquote, state)
    expect(state.doc.toString()).toBe('> A thought\n')
    expect(state.selection.main.from).toBe(state.doc.length)
  })

  test('delegates ordinary list continuation to CodeMirror', () => {
    const state = run(insertNewlineContinueBlockquote, editorState('- An item'))

    expect(state.doc.toString()).toBe('- An item\n- ')
  })

  test('exits an indented nested quote without leaving source markers behind', () => {
    const state = run(insertNewlineContinueBlockquote, editorState('  > > '))

    expect(state.doc.toString()).toBe('')
    expect(state.selection.main.from).toBe(0)
  })
})
