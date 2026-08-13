import { describe, expect, test } from 'bun:test'
import { openRandomNote } from '../src/openRandomNote'
import { isOpenRandomNoteShortcut } from '../src/keyboardShortcuts'
import { NoteNavigation } from '../src/noteNavigation'
import type { Note } from '../src/notes'

const note: Note = {
  key: 'Random.md',
  title: 'Random',
  body: 'A rediscovered thought',
  revision: 'one',
}

function shortcut(overrides: Partial<KeyboardEvent> = {}) {
  return {
    altKey: true,
    code: 'KeyR',
    ctrlKey: true,
    key: 'r',
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  }
}

describe('open random note shortcut', () => {
  test('recognizes initial Ctrl+Alt+R and Cmd+Alt+R presses', () => {
    expect(isOpenRandomNoteShortcut(shortcut())).toBe(true)
    expect(isOpenRandomNoteShortcut(shortcut({ ctrlKey: false, metaKey: true }))).toBe(true)
    expect(isOpenRandomNoteShortcut(shortcut({ code: 'KeyR', key: '®' }))).toBe(true)
  })

  test('rejects repeats, extra modifiers, and conflicting primary modifiers', () => {
    expect(isOpenRandomNoteShortcut(shortcut({ repeat: true }))).toBe(false)
    expect(isOpenRandomNoteShortcut(shortcut({ shiftKey: true }))).toBe(false)
    expect(isOpenRandomNoteShortcut(shortcut({ altKey: false }))).toBe(false)
    expect(isOpenRandomNoteShortcut(shortcut({ ctrlKey: false, metaKey: false }))).toBe(false)
    expect(isOpenRandomNoteShortcut(shortcut({ ctrlKey: true, metaKey: true }))).toBe(false)
    expect(isOpenRandomNoteShortcut(shortcut({ code: 'KeyT', key: 't' }))).toBe(false)
  })
})

describe('openRandomNote', () => {
  test('flushes before picking and opens exactly once', async () => {
    const calls: string[] = []
    const opened: Note[] = []

    const result = await openRandomNote({
      navigation: new NoteNavigation(),
      prepare: async () => {
        calls.push('prepare')
        return { currentKey: null }
      },
      pick: async (excludedKey) => {
        calls.push(`pick:${excludedKey}`)
        return note
      },
      open: (destination) => {
        calls.push('open')
        opened.push(destination)
      },
    })

    expect(result).toBe('opened')
    expect(calls).toEqual(['prepare', 'pick:null', 'open'])
    expect(opened).toEqual([note])
  })

  test('does not pick when flushing fails', async () => {
    let picks = 0

    const result = await openRandomNote({
      navigation: new NoteNavigation(),
      prepare: async () => null,
      pick: async () => {
        picks += 1
        return note
      },
      open: () => {},
    })

    expect(result).toBe('blocked')
    expect(picks).toBe(0)
  })

  test('does not replace the current note when it is the only choice', async () => {
    let opens = 0

    const result = await openRandomNote({
      navigation: new NoteNavigation(),
      prepare: async () => ({ currentKey: note.key }),
      pick: async (excludedKey) => {
        expect(excludedKey).toBe(note.key)
        return note
      },
      open: () => {
        opens += 1
      },
    })

    expect(result).toBe('unchanged')
    expect(opens).toBe(0)
  })

  test('reports an empty vault without opening a note', async () => {
    const result = await openRandomNote({
      navigation: new NoteNavigation(),
      prepare: async () => ({ currentKey: null }),
      pick: async () => null,
      open: () => {
        throw new Error('should not open')
      },
    })

    expect(result).toBe('empty')
  })

  test('finishes the transition when picking fails', async () => {
    const navigation = new NoteNavigation()
    const failure = new Error('random selection failed')

    await expect(openRandomNote({
      navigation,
      prepare: async () => ({ currentKey: null }),
      pick: async () => { throw failure },
      open: () => {},
    })).rejects.toBe(failure)

    expect(navigation.startTransition()).not.toBeNull()
    navigation.finishTransition()
  })

  test('rejects a stale result after navigation changes', async () => {
    const navigation = new NoteNavigation()
    let opens = 0

    const resultPromise = openRandomNote({
      navigation,
      prepare: async () => ({ currentKey: null }),
      pick: async () => {
        navigation.beginComposer('new thought')
        return note
      },
      open: () => {
        opens += 1
      },
    })

    expect(await resultPromise).toBe('blocked')
    expect(opens).toBe(0)
  })
})
