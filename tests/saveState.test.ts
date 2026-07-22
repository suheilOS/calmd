import { describe, expect, test } from 'bun:test'
import { reconcileSavedDraft } from '../src/saveState'
import type { Note, NoteDraft } from '../src/notes'

const savedNote: Note = {
  key: 'Patient thought.md',
  title: 'Patient thought',
  body: 'Saved body',
  revision: 'next',
}

describe('reconcileSavedDraft', () => {
  test('adopts the canonical returned title when the sent draft is still current', () => {
    const sent = { title: '  Patient   thought ', body: 'Saved body' }
    expect(reconcileSavedDraft(sent, sent, savedNote)).toEqual({
      canonicalDraft: { title: 'Patient thought', body: 'Saved body' },
      editorDraft: { title: 'Patient thought', body: 'Saved body' },
    })
  })

  test('does not overwrite edits made while a save is pending', () => {
    const sent: NoteDraft = { title: 'Patient thought', body: 'Saved body' }
    const newer: NoteDraft = { title: 'Patient thought', body: 'Newer edit' }
    expect(reconcileSavedDraft(newer, sent, savedNote)).toEqual({
      canonicalDraft: { title: 'Patient thought', body: 'Saved body' },
      editorDraft: newer,
    })
  })

  test('preserves canonical Unicode titles', () => {
    const unicodeNote = { ...savedNote, key: 'تنقية.md', title: 'تنقية هادئة' }
    const sent = { title: '  تنقية   هادئة ', body: 'Saved body' }
    expect(reconcileSavedDraft(sent, sent, unicodeNote).editorDraft.title).toBe('تنقية هادئة')
  })
})
