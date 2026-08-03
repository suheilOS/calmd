import { describe, expect, test } from 'bun:test'
import { createUntitledNote } from '../src/createUntitledNote'
import {
  isCreateUntitledShortcut,
  isNavigateHomeShortcut,
} from '../src/keyboardShortcuts'
import { NoteNavigation } from '../src/noteNavigation'
import type { Note } from '../src/notes'

const note: Note = {
  key: 'Untitled.md',
  title: 'Untitled',
  body: '',
  revision: 'one',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('createUntitledNote', () => {
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
    expect(isCreateUntitledShortcut({ ...shortcut, ctrlKey: false })).toBe(false)
    expect(isCreateUntitledShortcut({ ...shortcut, shiftKey: true })).toBe(false)
    expect(isCreateUntitledShortcut({ ...shortcut, repeat: true })).toBe(false)
  })

  test('recognizes only an initial Alt+Home press for Home', () => {
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
    expect(isNavigateHomeShortcut({ ...shortcut, ctrlKey: true })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, key: 'End' })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, altKey: false, ctrlKey: true, key: 'h', shiftKey: true })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, metaKey: true })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, repeat: true })).toBe(false)
    expect(isNavigateHomeShortcut({ ...shortcut, shiftKey: true })).toBe(false)
  })

  test('prepares before creating and opens exactly once', async () => {
    const calls: string[] = []
    const opened: Note[] = []

    const created = await createUntitledNote({
      navigation: new NoteNavigation(),
      prepare: async () => {
        calls.push('prepare')
        return true
      },
      create: async () => {
        calls.push('create')
        return note
      },
      open: (createdNote) => {
        calls.push('open')
        opened.push(createdNote)
      },
    })

    expect(created).toBe(true)
    expect(calls).toEqual(['prepare', 'create', 'open'])
    expect(opened).toEqual([note])
  })

  test('does not create when preparing the current note fails', async () => {
    let creates = 0

    const created = await createUntitledNote({
      navigation: new NoteNavigation(),
      prepare: async () => false,
      create: async () => {
        creates += 1
        return note
      },
      open: () => {},
    })

    expect(created).toBe(false)
    expect(creates).toBe(0)
  })

  test('rejects concurrent requests and stale transitions', async () => {
    const navigation = new NoteNavigation()
    const pendingPrepare = deferred<boolean>()
    let creates = 0
    let opens = 0
    const options = {
      navigation,
      prepare: () => pendingPrepare.promise,
      create: async () => {
        creates += 1
        return note
      },
      open: () => {
        opens += 1
      },
    }

    const first = createUntitledNote(options)
    expect(await createUntitledNote(options)).toBe(false)
    navigation.beginComposer('new generation')
    pendingPrepare.resolve(true)

    expect(await first).toBe(false)
    expect(creates).toBe(0)
    expect(opens).toBe(0)
  })

  test('finishes the transition when creation fails', async () => {
    const navigation = new NoteNavigation()
    const failure = new Error('creation failed')

    await expect(createUntitledNote({
      navigation,
      prepare: async () => true,
      create: async () => { throw failure },
      open: () => {},
    })).rejects.toBe(failure)

    expect(navigation.startTransition()).not.toBeNull()
    navigation.finishTransition()
  })
})
