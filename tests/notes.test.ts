import { describe, expect, test } from 'bun:test'
import { constrainNoteTitle, MAX_NOTE_TITLE_LENGTH } from '../src/notes'

describe('constrainNoteTitle', () => {
  test('keeps a title on one logical line', () => {
    expect(constrainNoteTitle('First line\nSecond line')).toBe('First line Second line')
  })

  test('caps title length', () => {
    expect(constrainNoteTitle('a'.repeat(MAX_NOTE_TITLE_LENGTH + 1))).toHaveLength(
      MAX_NOTE_TITLE_LENGTH,
    )
  })
})
