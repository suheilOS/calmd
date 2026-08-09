import { expect, test } from 'bun:test'
import { EditorState } from '@codemirror/state'
import {
  discardEditorViewState,
  recallEditorViewState,
  rememberEditorViewState,
} from '../src/editorViewState'

test('discarded note state cannot be recreated by a late editor cleanup', () => {
  const state = EditorState.create({ doc: 'deleted' })
  rememberEditorViewState('deleted.md', state, 120)
  discardEditorViewState('deleted.md')

  rememberEditorViewState('deleted.md', state, 120)
  expect(recallEditorViewState('deleted.md', state.doc.length)).toBeNull()

  rememberEditorViewState('deleted.md', state, 40)
  expect(recallEditorViewState('deleted.md', state.doc.length)?.scrollTop).toBe(40)
})
