import { describe, expect, test } from 'bun:test'
import { NoteNavigation } from '../src/noteNavigation'

describe('NoteNavigation', () => {
  test('traverses backward and forward without discarding history', () => {
    const navigation = new NoteNavigation()
    navigation.updateComposerThought('starting thought')
    navigation.beginNote('A.md')
    navigation.beginNote('B.md')

    expect(navigation.entries()).toEqual([
      { type: 'composer', thought: 'starting thought' },
      { type: 'note', key: 'A.md' },
      { type: 'note', key: 'B.md' },
    ])
    expect(navigation.current()).toEqual({ type: 'note', key: 'B.md' })
    expect(navigation.previous()).toEqual({ type: 'note', key: 'A.md' })
    expect(navigation.commitBack()).toBe(true)
    expect(navigation.current()).toEqual({ type: 'note', key: 'A.md' })
    expect(navigation.previous()).toEqual({ type: 'composer', thought: 'starting thought' })
    expect(navigation.next()).toEqual({ type: 'note', key: 'B.md' })
    expect(navigation.commitForward()).toBe(true)
    expect(navigation.current()).toEqual({ type: 'note', key: 'B.md' })
  })

  test('keeps Home reversible and preserves its composer thought', () => {
    const navigation = new NoteNavigation()
    navigation.beginNote('A.md')
    navigation.beginComposer()
    navigation.updateComposerThought('new thought')

    expect(navigation.current()).toEqual({ type: 'composer', thought: 'new thought' })
    expect(navigation.commitBack()).toBe(true)
    expect(navigation.current()).toEqual({ type: 'note', key: 'A.md' })
    expect(navigation.commitForward()).toBe(true)
    expect(navigation.current()).toEqual({ type: 'composer', thought: 'new thought' })
  })

  test('drops forward entries when a new destination opens after Back', () => {
    const navigation = new NoteNavigation()
    navigation.beginNote('A.md')
    navigation.beginNote('B.md')
    navigation.commitBack()
    navigation.beginNote('C.md')

    expect(navigation.entries()).toEqual([
      { type: 'composer', thought: '' },
      { type: 'note', key: 'A.md' },
      { type: 'note', key: 'C.md' },
    ])
    expect(navigation.canGoForward()).toBe(false)
  })

  test('updates every historical occurrence only for an explicit rename', () => {
    const navigation = new NoteNavigation()
    navigation.beginNote('A.md')
    navigation.beginNote('B.md')
    navigation.beginNote('A.md')
    navigation.rename('A.md', 'Renamed.md')

    expect(navigation.entries().map((entry) => entry.type === 'note' ? entry.key : 'composer'))
      .toEqual(['composer', 'Renamed.md', 'B.md', 'Renamed.md'])
  })

  test('serializes transitions and invalidates tokens when the session changes', () => {
    const navigation = new NoteNavigation()
    const token = navigation.startTransition()
    expect(token).toBe(0)
    expect(navigation.startTransition()).toBeNull()
    navigation.beginNote('A.md')
    expect(navigation.isCurrent(token!)).toBe(false)
    navigation.finishTransition()
    expect(navigation.startTransition()).toBe(1)
  })
})
