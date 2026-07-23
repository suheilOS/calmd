import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'bun:test'
import { NoteEditingSession } from '../src/noteEditing'
import type { Note } from '../src/notes'
import { resolveWikiLinkActivation } from '../src/wikiLinkNavigation'
import {
  validateWikiLinkOccurrence,
  wikiLinkMarkdown,
} from '../src/wikiLinks'

function state(doc: string) {
  return EditorState.create({
    doc,
    extensions: markdown({ extensions: [wikiLinkMarkdown] }),
  })
}

const oldNote: Note = {
  key: 'Old.md',
  title: 'Old',
  body: 'Self [[Old]]',
  revision: 'one',
}

function activation(editor: EditorState, from: number, to: number) {
  return {
    target: 'Old',
    validateCurrentOccurrence: (body: string) => validateWikiLinkOccurrence(
      editor,
      { from, to, target: 'Old' },
      body,
    ),
    applyCanonical: () => editor.doc.toString(),
  }
}

describe('resolveWikiLinkActivation', () => {
  test('does not resolve a self-link after its flush renames and rewrites the note', async () => {
    let opens = 0
    const session = new NoteEditingSession({
      read: async () => oldNote,
      save: async () => oldNote,
      rename: async () => ({
        key: 'New.md',
        title: 'New',
        body: 'Self [[New]]',
        revision: 'two',
      }),
    }, oldNote, () => {})
    session.updateDraft({ title: 'New', body: oldNote.body })

    await resolveWikiLinkActivation({
      activatedKey: oldNote.key,
      activation: activation(state(oldNote.body), 5, 12),
      flush: () => session.flush(),
      open: async () => {
        opens += 1
        return { note: oldNote, canonicalTarget: 'Old' }
      },
      updateBody: (body) => session.updateBody(body),
      isCurrent: () => true,
    })

    expect(opens).toBe(0)
    expect(session.current().key).toBe('New.md')
    expect(session.current().draft.body).toBe('Self [[New]]')
  })

  test('does not resolve a range wrapped in inline code while flush is pending', async () => {
    let opens = 0
    const body = '`[[Old]]`'
    await resolveWikiLinkActivation({
      activatedKey: 'Old.md',
      activation: activation(state(body), 1, 8),
      flush: async () => ({
        draft: { title: 'Old', body },
        savedDraft: { title: 'Old', body },
        key: 'Old.md', revision: 'two', conflict: false, failure: null,
      }),
      open: async () => {
        opens += 1
        return { note: oldNote, canonicalTarget: 'Old' }
      },
      updateBody: () => {},
      isCurrent: () => true,
    })
    expect(opens).toBe(0)
  })

  test('does not resolve when flush canonicalizes the body ahead of CodeMirror', async () => {
    let opens = 0
    await resolveWikiLinkActivation({
      activatedKey: 'Old.md',
      activation: activation(state('Self [[Old]]'), 5, 12),
      flush: async () => ({
        draft: { title: 'Old', body: 'Self [[New]]' },
        savedDraft: { title: 'Old', body: 'Self [[New]]' },
        key: 'Old.md', revision: 'two', conflict: false, failure: null,
      }),
      open: async () => {
        opens += 1
        return { note: oldNote, canonicalTarget: 'Old' }
      },
      updateBody: () => {},
      isCurrent: () => true,
    })
    expect(opens).toBe(0)
  })
})
