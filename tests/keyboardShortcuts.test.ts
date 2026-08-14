import { describe, expect, test } from 'bun:test'
import {
  isCreateUntitledShortcut,
  isNavigateHomeShortcut,
  isOpenRandomNoteShortcut,
} from '../src/keyboardShortcuts'

describe('application shortcuts', () => {
  test('recognizes only an initial unmodified Ctrl+N press', () => {
    const shortcut = {
      altKey: false,
      ctrlKey: true,
      key: 'n',
      metaKey: false,
      repeat: false,
      shiftKey: false,
    }
    expect(isCreateUntitledShortcut(shortcut)).toBe(true)
    expect(isCreateUntitledShortcut({ ...shortcut, key: 'N' })).toBe(true)
    expect(isCreateUntitledShortcut({ ...shortcut, shiftKey: true })).toBe(false)
    expect(isCreateUntitledShortcut({ ...shortcut, repeat: true })).toBe(false)
  })

  test('recognizes only an initial Alt+Home press', () => {
    const shortcut = {
      altKey: true,
      ctrlKey: false,
      key: 'Home',
      metaKey: false,
      repeat: false,
      shiftKey: false,
    }
    expect(isNavigateHomeShortcut(shortcut)).toBe(true)
    expect(isNavigateHomeShortcut({ ...shortcut, altKey: false })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, metaKey: true })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, repeat: true })).toBe(false)
  })

  test('recognizes random-Note shortcuts without conflicting modifiers', () => {
    const shortcut = {
      altKey: true,
      code: 'KeyR',
      ctrlKey: true,
      key: 'r',
      metaKey: false,
      repeat: false,
      shiftKey: false,
    }
    expect(isOpenRandomNoteShortcut(shortcut)).toBe(true)
    expect(isOpenRandomNoteShortcut({ ...shortcut, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isOpenRandomNoteShortcut({ ...shortcut, repeat: true })).toBe(false)
    expect(isOpenRandomNoteShortcut({ ...shortcut, shiftKey: true })).toBe(false)
    expect(isOpenRandomNoteShortcut({ ...shortcut, ctrlKey: true, metaKey: true })).toBe(false)
  })
})
