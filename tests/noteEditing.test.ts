import { describe, expect, test } from 'bun:test'
import {
  NoteEditingSession,
  type NoteEditingScheduler,
  type NotePersistenceAdapter,
} from '../src/noteEditing'
import type { Note, NoteDraft } from '../src/notes'

const original: Note = {
  key: 'Patient thought.md',
  title: 'Patient thought',
  body: 'Original',
  revision: 'one',
}

function adapter(overrides: Partial<NotePersistenceAdapter> = {}): NotePersistenceAdapter {
  return {
    read: async () => original,
    save: async (key, draft) => ({ ...draft, key, revision: 'next' }),
    rename: async (_key, draft) => ({
      ...draft,
      key: `${draft.title}.md`,
      revision: 'next',
    }),
    ...overrides,
  }
}

function scheduler() {
  let callback: (() => void) | null = null
  const value: NoteEditingScheduler = {
    set(next) {
      callback = next
      return 1 as ReturnType<typeof setTimeout>
    },
    clear() {
      callback = null
    },
  }
  return {
    value,
    run() {
      const next = callback
      callback = null
      next?.()
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('NoteEditingSession', () => {
  test('autosaves an edited body through the persistence seam', async () => {
    const saves: NoteDraft[] = []
    const clock = scheduler()
    const session = new NoteEditingSession(adapter({
      save: async (key, draft) => {
        saves.push(draft)
        return { ...draft, key, revision: 'two' }
      },
    }), original, () => {}, 450, clock.value)

    session.updateDraft({ ...session.current().draft, body: 'Edited' })
    clock.run()
    await session.flush()

    expect(saves).toEqual([{ title: 'Patient thought', body: 'Edited' }])
    expect(session.current().savedDraft.body).toBe('Edited')
  })

  test('uses rename when the canonical title changes', async () => {
    const renames: NoteDraft[] = []
    const session = new NoteEditingSession(adapter({
      rename: async (_key, draft) => {
        renames.push(draft)
        return { ...draft, key: 'New title.md', revision: 'two' }
      },
    }), original, () => {})

    session.updateDraft({ title: '  New   title ', body: 'Original' })
    await session.flush()

    expect(renames[0].title).toBe('New title')
    expect(session.current().key).toBe('New title.md')
    expect(session.current().draft.title).toBe('New title')
  })

  test('preserves editable whitespace when the canonical title is already saved', async () => {
    let renames = 0
    const clock = scheduler()
    const session = new NoteEditingSession(adapter({
      rename: async (_key, draft) => {
        renames += 1
        return { ...draft, key: `${draft.title}.md`, revision: 'two' }
      },
    }), original, () => {}, 450, clock.value)

    session.updateDraft({ ...session.current().draft, title: 'Patient thought ' })
    clock.run()
    await Promise.resolve()

    expect(session.current().draft.title).toBe('Patient thought ')
    expect(renames).toBe(0)
    expect(await session.flush()).not.toBeNull()
  })

  test('flush returns the authoritative canonical snapshot', async () => {
    const session = new NoteEditingSession(adapter({
      rename: async () => ({
        key: 'New.md',
        title: 'New',
        body: 'Self [[New]]',
        revision: 'two',
      }),
    }), { ...original, key: 'Old.md', title: 'Old', body: 'Self [[Old]]' }, () => {})

    session.updateDraft({ title: 'New', body: 'Self [[Old]]' })
    const flushed = await session.flush()

    expect(flushed?.key).toBe('New.md')
    expect(flushed?.draft.body).toBe('Self [[New]]')
  })

  test('preserves newer edits while an older save is pending', async () => {
    const pending = deferred<Note>()
    const session = new NoteEditingSession(adapter({
      save: () => pending.promise,
    }), original, () => {})

    session.updateDraft({ title: original.title, body: 'First edit' })
    const save = session.save()
    await Promise.resolve()
    session.updateDraft({ title: original.title, body: 'Newer edit' })
    pending.resolve({
      key: original.key,
      title: original.title,
      body: 'First edit',
      revision: 'two',
    })
    await save

    expect(session.current().savedDraft.body).toBe('First edit')
    expect(session.current().draft.body).toBe('Newer edit')
  })

  test('rebases newer body edits onto canonical link rewrites from a pending rename', async () => {
    const pendingRename = deferred<Note>()
    const savedBodies: string[] = []
    const renamed: Note = {
      key: 'New.md',
      title: 'New',
      body: 'Self [[New]]',
      revision: 'two',
    }
    const session = new NoteEditingSession(adapter({
      rename: () => pendingRename.promise,
      save: async (key, draft) => {
        savedBodies.push(draft.body)
        return { ...draft, key, revision: 'three' }
      },
    }), {
      ...original,
      key: 'Old.md',
      title: 'Old',
      body: 'Self [[Old]]',
    }, () => {})

    session.updateDraft({ title: 'New', body: 'Self [[Old]]' })
    const rename = session.save()
    await Promise.resolve()
    session.updateBody('Self [[Old]]\nNewer text')
    pendingRename.resolve(renamed)
    await rename

    expect(session.current().draft.body).toBe('Self [[New]]\nNewer text')
    expect((await session.flush())?.savedDraft.body).toBe('Self [[New]]\nNewer text')
    expect(savedBodies).toEqual(['Self [[New]]\nNewer text'])
  })

  test('enters a recoverable conflict when canonical and newer edits overlap', async () => {
    const pendingRename = deferred<Note>()
    let saves = 0
    const session = new NoteEditingSession(adapter({
      rename: () => pendingRename.promise,
      save: async (key, draft) => {
        saves += 1
        return { ...draft, key, revision: 'three' }
      },
    }), {
      ...original,
      key: 'Old.md',
      title: 'Old',
      body: 'Self [[Old]]',
    }, () => {})

    session.updateDraft({ title: 'New', body: 'Self [[Old]]' })
    const rename = session.save()
    await Promise.resolve()
    session.updateBody('Self [[Custom]]')
    pendingRename.resolve({
      key: 'New.md',
      title: 'New',
      body: 'Self [[New]]',
      revision: 'two',
    })
    expect(await rename).toBe(false)

    expect(session.current().conflict).toBe(true)
    expect(session.current().draft.body).toBe('Self [[Custom]]')
    expect(session.current().savedDraft.body).toBe('Self [[New]]')
    expect(await session.flush()).toBeNull()
    expect(saves).toBe(0)
  })

  test('serializes a newer flush behind an in-flight save', async () => {
    const first = deferred<Note>()
    const savedBodies: string[] = []
    const session = new NoteEditingSession(adapter({
      save: async (key, draft) => {
        savedBodies.push(draft.body)
        if (savedBodies.length === 1) return first.promise
        return { ...draft, key, revision: 'three' }
      },
    }), original, () => {})

    session.updateDraft({ title: original.title, body: 'First edit' })
    const firstSave = session.save()
    await Promise.resolve()
    session.updateDraft({ title: original.title, body: 'Newer edit' })
    const flush = session.flush()
    await Promise.resolve()
    expect(savedBodies).toEqual(['First edit'])

    first.resolve({
      key: original.key,
      title: original.title,
      body: 'First edit',
      revision: 'two',
    })
    await firstSave

    expect((await flush)?.savedDraft.body).toBe('Newer edit')
    expect(savedBodies).toEqual(['First edit', 'Newer edit'])
    expect(session.current().savedDraft.body).toBe('Newer edit')
  })

  test('stops autosaving and preserves the draft after a conflict', async () => {
    let saves = 0
    const session = new NoteEditingSession(adapter({
      save: async () => {
        saves += 1
        throw { code: 'conflict', message: 'External change' }
      },
    }), original, () => {})

    session.updateDraft({ title: original.title, body: 'Local edit' })
    expect(await session.flush()).toBeNull()
    session.updateDraft({ title: original.title, body: 'Another edit' })
    await session.save()

    expect(saves).toBe(1)
    expect(session.current().conflict).toBe(true)
    expect(session.current().draft.body).toBe('Another edit')
  })

  test('reload explicitly replaces a conflicted draft', async () => {
    const external = { ...original, body: 'External edit', revision: 'external' }
    const session = new NoteEditingSession(adapter({
      read: async () => external,
      save: async () => {
        throw { code: 'conflict', message: 'External change' }
      },
    }), original, () => {})

    session.updateDraft({ title: original.title, body: 'Local edit' })
    await session.flush()
    expect(await session.reload()).toBe(true)

    expect(session.current().conflict).toBe(false)
    expect(session.current().draft.body).toBe('External edit')
  })
})
