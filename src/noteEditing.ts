import { canonicalizeTitle, type Note, type NoteDraft } from './notes'

export type NotePersistenceFailure = {
  code: string
  message: string
}

export type NotePersistenceAdapter = {
  read: (key: string) => Promise<Note>
  save: (
    key: string,
    draft: NoteDraft,
    expectedRevision: string,
  ) => Promise<Note>
  rename: (
    key: string,
    draft: NoteDraft,
    expectedRevision: string,
  ) => Promise<Note>
}

function persistenceFailure(error: unknown): NotePersistenceFailure {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && 'message' in error
    && typeof error.code === 'string'
    && typeof error.message === 'string'
  ) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }
}

export type NoteEditingSnapshot = {
  draft: NoteDraft
  savedDraft: NoteDraft
  key: string
  revision: string
  conflict: boolean
  failure: NotePersistenceFailure | null
}

export type NoteEditingScheduler = {
  set: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clear: (timer: ReturnType<typeof setTimeout>) => void
}

const defaultScheduler: NoteEditingScheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (timer) => clearTimeout(timer),
}

function draftsMatch(left: NoteDraft, right: NoteDraft) {
  return left.title === right.title && left.body === right.body
}

function draftFrom(note: Note): NoteDraft {
  return { title: note.title, body: note.body }
}

export class NoteEditingSession {
  private snapshot: NoteEditingSnapshot
  private saveChain: Promise<boolean> = Promise.resolve(true)
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly persistence: NotePersistenceAdapter
  private readonly publish: (snapshot: NoteEditingSnapshot) => void
  private readonly saveDelay: number
  private readonly scheduler: NoteEditingScheduler

  constructor(
    persistence: NotePersistenceAdapter,
    note: Note,
    publish: (snapshot: NoteEditingSnapshot) => void,
    saveDelay = 450,
    scheduler: NoteEditingScheduler = defaultScheduler,
  ) {
    this.persistence = persistence
    this.publish = publish
    this.saveDelay = saveDelay
    this.scheduler = scheduler
    const draft = draftFrom(note)
    this.snapshot = {
      draft,
      savedDraft: draft,
      key: note.key,
      revision: note.revision,
      conflict: false,
      failure: null,
    }
  }

  current() {
    return this.snapshot
  }

  updateDraft(draft: NoteDraft) {
    if (this.disposed) return
    this.setSnapshot({
      ...this.snapshot,
      draft,
      failure: this.snapshot.conflict ? this.snapshot.failure : null,
    })
    if (!this.snapshot.conflict) this.scheduleSave()
  }

  save() {
    this.cancelScheduledSave()
    const requestedDraft = this.snapshot.draft
    const operation = this.saveChain.then(() => this.persist(requestedDraft))
    this.saveChain = operation.catch(() => false)
    return operation
  }

  async flush() {
    this.cancelScheduledSave()
    if (this.snapshot.conflict) return false
    if (!draftsMatch(this.snapshot.draft, this.snapshot.savedDraft)) {
      await this.save()
    } else {
      await this.saveChain
    }
    return !this.snapshot.conflict && draftsMatch(
      this.snapshot.draft,
      this.snapshot.savedDraft,
    )
  }

  async reload() {
    this.cancelScheduledSave()
    const key = this.snapshot.key
    try {
      const note = await this.persistence.read(key)
      if (this.disposed) return false
      const draft = draftFrom(note)
      this.setSnapshot({
        draft,
        savedDraft: draft,
        key: note.key,
        revision: note.revision,
        conflict: false,
        failure: null,
      })
      return true
    } catch (error) {
      if (!this.disposed) {
        this.setSnapshot({
          ...this.snapshot,
          failure: persistenceFailure(error),
        })
      }
      return false
    }
  }

  dispose() {
    this.disposed = true
    this.cancelScheduledSave()
  }

  private scheduleSave() {
    this.cancelScheduledSave()
    if (draftsMatch(this.snapshot.draft, this.snapshot.savedDraft)) return
    this.timer = this.scheduler.set(() => {
      this.timer = null
      void this.save()
    }, this.saveDelay)
  }

  private cancelScheduledSave() {
    if (this.timer === null) return
    this.scheduler.clear(this.timer)
    this.timer = null
  }

  private async persist(sentDraft: NoteDraft) {
    if (this.disposed || this.snapshot.conflict) return false
    const requestDraft = {
      ...sentDraft,
      title: canonicalizeTitle(sentDraft.title),
    }
    if (draftsMatch(requestDraft, this.snapshot.savedDraft)) {
      if (draftsMatch(this.snapshot.draft, sentDraft)) {
        this.setSnapshot({ ...this.snapshot, draft: requestDraft })
      }
      return true
    }

    const { key, revision, savedDraft } = this.snapshot
    this.setSnapshot({ ...this.snapshot, failure: null })
    try {
      const note = requestDraft.title !== savedDraft.title
        ? await this.persistence.rename(key, requestDraft, revision)
        : await this.persistence.save(key, requestDraft, revision)
      if (this.disposed) return false

      const canonicalDraft = draftFrom(note)
      const currentDraft = this.snapshot.draft
      this.setSnapshot({
        ...this.snapshot,
        draft: draftsMatch(currentDraft, sentDraft) ? canonicalDraft : currentDraft,
        savedDraft: canonicalDraft,
        key: note.key,
        revision: note.revision,
        failure: null,
      })
      if (!draftsMatch(this.snapshot.draft, this.snapshot.savedDraft)) {
        this.scheduleSave()
      }
      return true
    } catch (error) {
      if (this.disposed) return false
      const failure = persistenceFailure(error)
      this.setSnapshot({
        ...this.snapshot,
        conflict: failure.code === 'conflict',
        failure,
      })
      return false
    }
  }

  private setSnapshot(snapshot: NoteEditingSnapshot) {
    this.snapshot = snapshot
    this.publish(snapshot)
  }
}
