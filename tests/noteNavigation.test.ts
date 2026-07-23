import { describe, expect, test } from 'bun:test'
import { NoteNavigation } from '../src/noteNavigation'

describe('NoteNavigation', () => {
  test('keeps ordinary transitions distinct and walks back to the composer', () => {
    const navigation = new NoteNavigation()
    navigation.updateComposerThought('starting thought')
    navigation.beginNote('A.md')
    navigation.beginNote('B.md')

    expect(navigation.entries()).toEqual([
      { type: 'composer', thought: 'starting thought' },
      { type: 'note', key: 'A.md' },
      { type: 'note', key: 'B.md' },
    ])
    expect(navigation.previous()).toEqual({ type: 'note', key: 'A.md' })
    navigation.commitBack()
    expect(navigation.previous()).toEqual({ type: 'composer', thought: 'starting thought' })
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
