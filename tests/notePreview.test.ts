import { describe, expect, test } from 'bun:test'
import {
  NOTE_PREVIEW_CHARACTER_LIMIT,
  NOTE_PREVIEW_CLOSE_DELAY_MS,
  NOTE_PREVIEW_OPEN_DELAY_MS,
  NotePreviewController,
  previewFromDraft,
  truncateNotePreviewBody,
  type NotePreviewCandidate,
  type NotePreviewLoadResult,
} from '../src/notePreview'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

class FakeScheduler {
  private now = 0
  private nextId = 1
  private readonly tasks = new Map<number, { at: number; callback: () => void }>()

  readonly scheduler = {
    set: (callback: () => void, delay: number) => {
      const id = this.nextId++
      this.tasks.set(id, { at: this.now + delay, callback })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clear: (handle: ReturnType<typeof setTimeout>) => {
      this.tasks.delete(handle as unknown as number)
    },
  }

  advance(milliseconds: number) {
    const target = this.now + milliseconds
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0]
      if (!next) break
      const [id, task] = next
      this.tasks.delete(id)
      this.now = task.at
      task.callback()
    }
    this.now = target
  }
}

function candidate(id: string): NotePreviewCandidate {
  return {
    source: 'wiki-link',
    id,
    target: id,
    anchor: {} as Element,
  }
}

async function settlePromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('note previews', () => {
  test('truncates by Unicode scalar values without splitting emoji', () => {
    const exact = 'é'.repeat(NOTE_PREVIEW_CHARACTER_LIMIT)
    expect(truncateNotePreviewBody(exact)).toEqual({
      excerpt: exact,
      truncated: false,
    })

    const long = `${'🙂'.repeat(NOTE_PREVIEW_CHARACTER_LIMIT)}end`
    const result = truncateNotePreviewBody(long)
    expect([...result.excerpt]).toHaveLength(NOTE_PREVIEW_CHARACTER_LIMIT)
    expect(result.excerpt.endsWith('🙂')).toBe(true)
    expect(result.truncated).toBe(true)
  })

  test('builds a bounded preview from an unsaved draft', () => {
    expect(previewFromDraft('Self.md', { title: 'Draft title', body: 'Draft body' })).toEqual({
      key: 'Self.md',
      title: 'Draft title',
      excerpt: 'Draft body',
      truncated: false,
    })
  })

  test('opens after intent and ignores a stale request after the candidate changes', async () => {
    const scheduler = new FakeScheduler()
    const first = deferred<NotePreviewLoadResult>()
    const second = deferred<NotePreviewLoadResult>()
    const requests = new Map([
      ['First', first],
      ['Second', second],
    ])
    const controller = new NotePreviewController(
      (request) => requests.get(request.id)!.promise,
      scheduler.scheduler,
    )

    controller.setModifierHeld(true)
    controller.enterSource(candidate('First'))
    expect(controller.getSnapshot().status).toBe('waiting')
    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    expect(controller.getSnapshot().status).toBe('loading')

    controller.enterSource(candidate('Second'))
    expect(controller.getSnapshot().status).toBe('waiting')
    first.resolve({
      kind: 'found',
      preview: { key: 'First.md', title: 'First', excerpt: '', truncated: false },
    })
    await settlePromises()
    expect(controller.getSnapshot().status).toBe('waiting')

    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    second.resolve({
      kind: 'found',
      preview: { key: 'Second.md', title: 'Second', excerpt: 'Body', truncated: false },
    })
    await settlePromises()
    expect(controller.getSnapshot()).toMatchObject({
      status: 'visible',
      preview: { key: 'Second.md' },
    })
  })

  test('supports modifier-after-hover, grace transfer, release, and missing results', async () => {
    const scheduler = new FakeScheduler()
    const result = deferred<NotePreviewLoadResult>()
    const controller = new NotePreviewController(() => result.promise, scheduler.scheduler)

    controller.enterSource(candidate('Target'))
    expect(controller.getSnapshot().status).toBe('armed')
    controller.setModifierHeld(true)
    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    result.resolve({
      kind: 'found',
      preview: { key: 'Target.md', title: 'Target', excerpt: '', truncated: false },
    })
    await settlePromises()
    expect(controller.getSnapshot().status).toBe('visible')

    controller.leaveSource()
    scheduler.advance(NOTE_PREVIEW_CLOSE_DELAY_MS - 1)
    controller.enterPreview()
    scheduler.advance(1)
    expect(controller.getSnapshot().status).toBe('visible')

    controller.setModifierHeld(false)
    expect(controller.getSnapshot().status).toBe('visible')

    controller.leavePreview()
    scheduler.advance(NOTE_PREVIEW_CLOSE_DELAY_MS)
    expect(controller.getSnapshot().status).toBe('idle')

    const missing = deferred<NotePreviewLoadResult>()
    const missingController = new NotePreviewController(() => missing.promise, scheduler.scheduler)
    missingController.enterSource(candidate('Missing'))
    missingController.setModifierHeld(true)
    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    missing.resolve({ kind: 'missing' })
    await settlePromises()
    expect(missingController.getSnapshot().status).toBe('armed')
  })

  test('cancels a pending preview when the modifier is released before opening', () => {
    const scheduler = new FakeScheduler()
    let loadCount = 0
    const controller = new NotePreviewController(async () => {
      loadCount += 1
      return { kind: 'missing' }
    }, scheduler.scheduler)

    controller.enterSource(candidate('Pending'))
    controller.setModifierHeld(true)
    expect(controller.getSnapshot().status).toBe('waiting')

    controller.setModifierHeld(false)
    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)

    expect(loadCount).toBe(0)
    expect(controller.getSnapshot().status).toBe('armed')
  })

  test('resets the preview and modifier state when the window loses focus', async () => {
    const scheduler = new FakeScheduler()
    const result = deferred<NotePreviewLoadResult>()
    const controller = new NotePreviewController(() => result.promise, scheduler.scheduler)

    controller.enterSource(candidate('Blurred'))
    controller.setModifierHeld(true)
    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    result.resolve({
      kind: 'found',
      preview: { key: 'Blurred.md', title: 'Blurred', excerpt: '', truncated: false },
    })
    await settlePromises()
    expect(controller.getSnapshot().status).toBe('visible')

    controller.resetOnBlur()

    expect(controller.getSnapshot().status).toBe('idle')
    controller.enterSource(candidate('After blur'))
    expect(controller.getSnapshot().status).toBe('armed')
  })

  test('cancels intent and pending work when left, dismissed, or disposed', () => {
    const scheduler = new FakeScheduler()
    let loadCount = 0
    const load = async (): Promise<NotePreviewLoadResult> => {
      loadCount += 1
      return { kind: 'missing' }
    }

    const left = new NotePreviewController(load, scheduler.scheduler)
    left.enterSource(candidate('Left'))
    left.setModifierHeld(true)
    left.leaveSource()

    const dismissed = new NotePreviewController(load, scheduler.scheduler)
    dismissed.enterSource(candidate('Dismissed'))
    dismissed.setModifierHeld(true)
    dismissed.dismiss()

    const disposed = new NotePreviewController(load, scheduler.scheduler)
    disposed.enterSource(candidate('Disposed'))
    disposed.setModifierHeld(true)
    disposed.dispose()

    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    expect(loadCount).toBe(0)
    expect(left.getSnapshot().status).toBe('idle')
    expect(dismissed.getSnapshot().status).toBe('idle')
  })

  test('closes after the pointer grace period and presents load errors', async () => {
    const scheduler = new FakeScheduler()
    const result = deferred<NotePreviewLoadResult>()
    const controller = new NotePreviewController(() => result.promise, scheduler.scheduler)
    controller.enterSource(candidate('Target'))
    controller.setModifierHeld(true)
    scheduler.advance(NOTE_PREVIEW_OPEN_DELAY_MS)
    result.resolve({ kind: 'error', message: 'Unavailable' })
    await settlePromises()
    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      message: 'Unavailable',
    })

    controller.leaveSource()
    scheduler.advance(NOTE_PREVIEW_CLOSE_DELAY_MS)
    expect(controller.getSnapshot().status).toBe('idle')
  })
})
