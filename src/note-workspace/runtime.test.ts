import { describe, expect, test } from 'bun:test'
import type { WikiLinkActivation } from '../MarkdownEditor'
import type { Note } from '../notes'
import type { NoteWorkspaceAdapter } from './runtime'
import { NoteWorkspaceRuntime } from './runtime'

const original: Note = {
  key: 'Original.md',
  title: 'Original',
  body: 'Original body',
  revision: 'one',
}

function note(key: string, body = ''): Note {
  return {
    key,
    title: key.replace(/\.md$/u, ''),
    body,
    revision: 'one',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function adapter(overrides: Partial<NoteWorkspaceAdapter> = {}): NoteWorkspaceAdapter {
  return {
    create: async (title) => note(`${title}.md`),
    createUntitled: async () => note('Untitled.md'),
    delete: async () => {},
    errorMessage: (error) => error instanceof Error ? error.message : String(error),
    openLink: async () => ({ note: note('Linked.md'), canonicalTarget: 'Linked' }),
    openRandom: async () => note('Random.md'),
    read: async (key) => key === original.key ? original : note(key),
    rename: async (_key, draft) => ({
      ...draft,
      key: `${draft.title}.md`,
      revision: 'two',
    }),
    resolveWikiLink: async () => true,
    save: async (key, draft) => ({ ...draft, key, revision: 'two' }),
    suggestWikiLinks: async () => [],
    ...overrides,
  }
}

function runtime(
  noteAdapter: NoteWorkspaceAdapter,
  onCollectionChange = () => {},
) {
  return new NoteWorkspaceRuntime({
    adapter: noteAdapter,
    onCollectionChange,
    refreshVault: async () => {},
  })
}

describe('NoteWorkspaceRuntime', () => {
  test('opens Notes and restores the Composer thought through navigation', async () => {
    const workspace = runtime(adapter())
    workspace.updateComposerThought('starting thought')

    expect(await workspace.open('A.md')).toBe(true)
    expect(await workspace.open('B.md')).toBe(true)
    expect(workspace.current().note?.key).toBe('B.md')

    expect(await workspace.back()).toBe(true)
    expect(workspace.current().note?.key).toBe('A.md')
    expect(await workspace.back()).toBe(true)
    expect(workspace.current().location).toEqual({
      type: 'composer',
      thought: 'starting thought',
    })
    expect(await workspace.forward()).toBe(true)
    expect(workspace.current().note?.key).toBe('A.md')
    workspace.dispose()
  })

  test('flushes the active Note before creating an untitled Note', async () => {
    const calls: string[] = []
    const workspace = runtime(adapter({
      createUntitled: async () => {
        calls.push('create')
        return note('Untitled.md')
      },
      save: async (key, draft) => {
        calls.push('save')
        return { ...draft, key, revision: 'two' }
      },
    }))
    await workspace.open(original.key)
    workspace.updateDraft({ title: original.title, body: 'Changed' })

    expect(await workspace.createUntitled()).toBe(true)
    expect(calls).toEqual(['save', 'create'])
    expect(workspace.current().note?.key).toBe('Untitled.md')
    workspace.dispose()
  })

  test('blocks creation when the active Note cannot flush', async () => {
    let creates = 0
    const workspace = runtime(adapter({
      createUntitled: async () => {
        creates += 1
        return note('Untitled.md')
      },
      save: async () => {
        throw { code: 'conflict', message: 'External change' }
      },
    }))
    await workspace.open(original.key)
    workspace.updateDraft({ title: original.title, body: 'Changed' })

    expect(await workspace.createUntitled()).toBe(false)
    expect(creates).toBe(0)
    expect(workspace.current().note?.conflict).toBe(true)
    workspace.dispose()
  })

  test('serializes transitions and ignores a concurrent request', async () => {
    const pending = deferred<Note>()
    const workspace = runtime(adapter({ read: () => pending.promise }))
    const opening = workspace.open('Slow.md')

    expect(await workspace.createUntitled()).toBe(false)
    pending.resolve(note('Slow.md'))
    expect(await opening).toBe(true)
    expect(workspace.current().note?.key).toBe('Slow.md')
    workspace.dispose()
  })

  test('excludes the active Note from random selection and reports an empty vault', async () => {
    const excluded: Array<string | null> = []
    const workspace = runtime(adapter({
      openRandom: async (key) => {
        excluded.push(key)
        return null
      },
    }))
    await workspace.open(original.key)

    expect(await workspace.openRandom()).toBe('empty')
    expect(excluded).toEqual([original.key])
    expect(workspace.current().message).toBe('No notes to rediscover yet.')
    workspace.dispose()
  })

  test('deletes the saved Note and returns to a blank Composer', async () => {
    const deleted: string[] = []
    let collectionChanges = 0
    const workspace = runtime(adapter({
      delete: async (key) => { deleted.push(key) },
    }), () => { collectionChanges += 1 })
    await workspace.open(original.key)
    workspace.setDeleteOpen(true)

    expect(await workspace.deleteCurrent()).toBe(true)
    expect(deleted).toEqual([original.key])
    expect(collectionChanges).toBe(1)
    expect(workspace.current().note).toBeNull()
    expect(workspace.current().location).toEqual({ type: 'composer', thought: '' })
    workspace.dispose()
  })

  test('stops Internal-link activation when a flush renames the active Note', async () => {
    let opens = 0
    let finishes = 0
    const workspace = runtime(adapter({
      openLink: async () => {
        opens += 1
        return { note: original, canonicalTarget: 'Original' }
      },
      rename: async (_key, draft) => ({
        ...draft,
        body: 'Self [[Renamed]]',
        key: 'Renamed.md',
        revision: 'two',
      }),
    }))
    await workspace.open(original.key)
    workspace.updateDraft({ title: 'Renamed', body: 'Self [[Original]]' })
    const activation: WikiLinkActivation = {
      applyCanonical: () => null,
      finish: () => { finishes += 1 },
      target: 'Original',
      validateCurrentOccurrence: (body) => body === 'Self [[Original]]',
    }

    expect(await workspace.activateWikiLink(activation)).toBe(false)
    expect(opens).toBe(0)
    expect(finishes).toBe(1)
    expect(workspace.current().note?.key).toBe('Renamed.md')
    workspace.dispose()
  })

  test('creates a titled Note from the Composer', async () => {
    const titles: string[] = []
    const workspace = runtime(adapter({
      create: async (title) => {
        titles.push(title)
        return note(`${title}.md`)
      },
    }))

    expect(await workspace.create('A developed thought')).toBe(true)
    expect(titles).toEqual(['A developed thought'])
    expect(workspace.current().note?.key).toBe('A developed thought.md')
    workspace.dispose()
  })

  test('releases a transition after creation fails', async () => {
    const workspace = runtime(adapter({
      create: async () => { throw new Error('creation failed') },
    }))

    expect(await workspace.create('Failure')).toBe(false)
    expect(workspace.current().message).toBe('creation failed')
    expect(await workspace.createUntitled()).toBe(true)
    workspace.dispose()
  })

  test('does not replace the active Note when random selection returns it', async () => {
    const workspace = runtime(adapter({ openRandom: async () => original }))
    await workspace.open(original.key)
    const sessionId = workspace.current().editorSessionId

    expect(await workspace.openRandom()).toBe('unchanged')
    expect(workspace.current().editorSessionId).toBe(sessionId)
    workspace.dispose()
  })

  test('releases a transition after random selection fails', async () => {
    const workspace = runtime(adapter({
      openRandom: async () => { throw new Error('random failed') },
    }))

    expect(await workspace.openRandom()).toBe('blocked')
    expect(workspace.current().message).toBe('random failed')
    expect(await workspace.createUntitled()).toBe(true)
    workspace.dispose()
  })

  test('flushes before returning Home and keeps Home reversible', async () => {
    let saves = 0
    const workspace = runtime(adapter({
      save: async (key, draft) => {
        saves += 1
        return { ...draft, key, revision: 'two' }
      },
    }))
    await workspace.open(original.key)
    workspace.updateDraft({ title: original.title, body: 'Changed' })

    expect(await workspace.home()).toBe(true)
    expect(saves).toBe(1)
    expect(workspace.current().location).toEqual({ type: 'composer', thought: '' })
    expect(await workspace.back()).toBe(true)
    expect(workspace.current().note?.key).toBe(original.key)
    workspace.dispose()
  })

  test('keeps the active Note when deletion conflicts', async () => {
    const workspace = runtime(adapter({
      delete: async () => { throw { code: 'conflict', message: 'Delete conflict' } },
      errorMessage: (error) => (error as { message: string }).message,
    }))
    await workspace.open(original.key)

    expect(await workspace.deleteCurrent()).toBe(false)
    expect(workspace.current().note?.key).toBe(original.key)
    expect(workspace.current().message).toBe('Delete conflict')
    expect(workspace.current().deleteOpen).toBe(false)
    workspace.dispose()
  })

  test('reloads a conflict and starts a fresh editor session', async () => {
    let reads = 0
    const workspace = runtime(adapter({
      read: async () => {
        reads += 1
        return reads === 1 ? original : { ...original, body: 'From disk', revision: 'two' }
      },
      save: async () => { throw { code: 'conflict', message: 'External change' } },
    }))
    await workspace.open(original.key)
    workspace.updateDraft({ title: original.title, body: 'Local change' })
    await workspace.flush()
    const conflictedSession = workspace.current().editorSessionId

    expect(await workspace.reload()).toBe(true)
    expect(workspace.current().editorSessionId).toBe(conflictedSession + 1)
    expect(workspace.current().note?.draft.body).toBe('From disk')
    expect(workspace.current().note?.conflict).toBe(false)
    workspace.dispose()
  })

  test('canonicalizes an Internal link before opening its destination', async () => {
    const target = note('Target.md')
    const workspace = runtime(adapter({
      openLink: async () => ({ note: target, canonicalTarget: 'Target' }),
    }))
    await workspace.open(original.key)
    workspace.updateDraft({ title: original.title, body: 'See [[target]]' })
    let finishes = 0
    const activation: WikiLinkActivation = {
      applyCanonical: () => 'See [[Target]]',
      finish: () => { finishes += 1 },
      target: 'target',
      validateCurrentOccurrence: (body) => body === 'See [[target]]',
    }

    expect(await workspace.activateWikiLink(activation)).toBe(true)
    expect(finishes).toBe(1)
    expect(workspace.current().note?.key).toBe(target.key)
    workspace.dispose()
  })
})
