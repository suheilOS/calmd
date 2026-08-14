import type { WikiLinkActivation } from '../MarkdownEditor'
import { discardEditorViewState } from '../editorViewState'
import type {
  Note,
  NoteDraft,
  NoteReference,
  OpenNoteLinkResponse,
} from '../notes'
import {
  NoteEditingSession,
  type NoteEditingSnapshot,
  type NotePersistenceAdapter,
} from './noteEditing'
import { NoteNavigation, type NoteLocation } from './noteNavigation'

export type NoteWorkspaceAdapter = NotePersistenceAdapter & {
  create: (title: string) => Promise<Note>
  createUntitled: () => Promise<Note>
  delete: (key: string, expectedRevision: string) => Promise<void>
  openLink: (target: string) => Promise<OpenNoteLinkResponse>
  openRandom: (excludedKey: string | null) => Promise<Note | null>
  resolveWikiLink: (target: string) => Promise<boolean | null>
  suggestWikiLinks: (query: string) => Promise<NoteReference[]>
  errorMessage: (error: unknown) => string
}

export type NoteWorkspaceSnapshot = {
  backlinksOpen: boolean
  canGoBack: boolean
  canGoForward: boolean
  canGoHome: boolean
  deleting: boolean
  deleteOpen: boolean
  editorSessionId: number
  location: NoteLocation
  message: string | null
  note: NoteEditingSnapshot | null
}

type NoteWorkspaceOptions = {
  adapter: NoteWorkspaceAdapter
  onCollectionChange: () => void
  refreshVault: () => Promise<void>
}

type Listener = () => void

export class NoteWorkspaceRuntime {
  private readonly adapter: NoteWorkspaceAdapter
  private readonly listeners = new Set<Listener>()
  private readonly navigation = new NoteNavigation()
  private readonly onCollectionChange: () => void
  private readonly refreshVault: () => Promise<void>
  private editing: NoteEditingSession | null = null
  private note: NoteEditingSnapshot | null = null
  private editorSessionId = 0
  private backlinksOpen = false
  private deleteOpen = false
  private deleting = false
  private message: string | null = null
  private cachedSnapshot: NoteWorkspaceSnapshot | null = null

  constructor({ adapter, onCollectionChange, refreshVault }: NoteWorkspaceOptions) {
    this.adapter = adapter
    this.onCollectionChange = onCollectionChange
    this.refreshVault = refreshVault
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  current = (): NoteWorkspaceSnapshot => {
    if (this.cachedSnapshot) return this.cachedSnapshot
    const location = this.navigation.current() ?? { type: 'composer', thought: '' }
    this.cachedSnapshot = {
      backlinksOpen: this.backlinksOpen,
      canGoBack: this.navigation.canGoBack(),
      canGoForward: this.navigation.canGoForward(),
      canGoHome: location.type === 'note',
      deleting: this.deleting,
      deleteOpen: this.deleteOpen,
      editorSessionId: this.editorSessionId,
      location,
      message: this.message,
      note: this.note,
    }
    return this.cachedSnapshot
  }

  dispose = () => {
    this.editing?.dispose()
    this.editing = null
    this.listeners.clear()
  }

  updateComposerThought = (thought: string) => {
    this.navigation.updateComposerThought(thought)
    this.publish()
  }

  updateDraft = (draft: NoteDraft) => {
    this.editing?.updateDraft(draft)
  }

  updateBody = (body: string) => {
    this.editing?.updateBody(body)
  }

  flush = async () => {
    const editing = this.editing
    if (!editing) return null
    const snapshot = await editing.flush()
    return this.editing === editing ? snapshot : null
  }

  reportError = (error: unknown) => {
    this.setMessage(this.adapter.errorMessage(error))
  }

  setMessage = (message: string | null) => {
    this.message = message
    this.publish()
  }

  setBacklinksOpen = (open: boolean) => {
    this.backlinksOpen = open
    this.publish()
  }

  setDeleteOpen = (open: boolean) => {
    if (this.deleting) return
    this.deleteOpen = open
    this.publish()
  }

  open = async (key: string) => {
    const generation = this.navigation.startTransition()
    if (generation === null) return false
    try {
      if (this.note && !(await this.flush())) return false
      if (!this.navigation.isCurrent(generation) || this.note?.key === key) return false
      const note = await this.adapter.read(key)
      if (!this.navigation.isCurrent(generation)) return false
      this.beginEditing(note)
      return true
    } catch (error) {
      await this.handleVaultError(error)
      return false
    } finally {
      this.navigation.finishTransition()
    }
  }

  create = async (title: string) => {
    const generation = this.navigation.startTransition()
    if (generation === null) return false
    try {
      const note = await this.adapter.create(title)
      if (!this.navigation.isCurrent(generation)) return false
      this.beginEditing(note)
      return true
    } catch (error) {
      this.reportError(error)
      return false
    } finally {
      this.navigation.finishTransition()
    }
  }

  createUntitled = async () => {
    const generation = this.navigation.startTransition()
    if (generation === null) return false
    try {
      if (this.note && !(await this.flush())) return false
      if (!this.navigation.isCurrent(generation)) return false
      const note = await this.adapter.createUntitled()
      if (!this.navigation.isCurrent(generation)) return false
      this.beginEditing(note)
      return true
    } catch (error) {
      this.reportError(error)
      return false
    } finally {
      this.navigation.finishTransition()
    }
  }

  openRandom = async () => {
    const generation = this.navigation.startTransition()
    if (generation === null) return 'blocked' as const
    try {
      const saved = this.note ? await this.flush() : null
      if ((this.note && !saved) || !this.navigation.isCurrent(generation)) {
        return 'blocked' as const
      }
      const currentKey = saved?.key ?? null
      const note = await this.adapter.openRandom(currentKey)
      if (!this.navigation.isCurrent(generation)) return 'blocked' as const
      if (!note) {
        this.setMessage('No notes to rediscover yet.')
        return 'empty' as const
      }
      if (note.key === currentKey) return 'unchanged' as const
      this.beginEditing(note)
      return 'opened' as const
    } catch (error) {
      await this.handleVaultError(error)
      return 'blocked' as const
    } finally {
      this.navigation.finishTransition()
    }
  }

  reload = async () => {
    const reloaded = await this.editing?.reload() ?? false
    if (!reloaded) return false
    this.editorSessionId += 1
    this.publish()
    await this.refreshVault()
    return true
  }

  deleteCurrent = async () => {
    const generation = this.navigation.startTransition()
    if (generation === null) return false
    this.deleting = true
    this.publish()
    try {
      const saved = await this.flush()
      if (!saved) {
        this.deleteOpen = false
        this.publish()
        return false
      }
      if (!this.navigation.isCurrent(generation)) return false
      await this.adapter.delete(saved.key, saved.revision)
      if (!this.navigation.isCurrent(generation)) return false
      this.navigation.completeNoteDeletion(saved.key)
      discardEditorViewState(saved.key)
      this.closeEditing()
      this.backlinksOpen = false
      this.deleteOpen = false
      this.message = null
      this.onCollectionChange()
      this.publish()
      return true
    } catch (error) {
      this.deleteOpen = false
      this.reportError(error)
      return false
    } finally {
      this.deleting = false
      this.navigation.finishTransition()
      this.publish()
    }
  }

  back = () => this.navigateHistory('back')

  forward = () => this.navigateHistory('forward')

  home = async () => {
    if (this.navigation.current()?.type === 'composer') return true
    const generation = this.navigation.startTransition()
    if (generation === null) return false
    try {
      if ((this.note && !(await this.flush())) || !this.navigation.isCurrent(generation)) {
        return false
      }
      this.navigation.beginComposer()
      this.closeEditing()
      this.backlinksOpen = false
      this.message = null
      this.publish()
      return true
    } catch (error) {
      await this.handleVaultError(error)
      return false
    } finally {
      this.navigation.finishTransition()
    }
  }

  activateWikiLink = async (activation: WikiLinkActivation) => {
    const activatedKey = this.note?.key
    const generation = this.navigation.startTransition()
    if (generation === null || !activatedKey) {
      activation.finish()
      return false
    }
    try {
      const flushed = await this.flush()
      if (
        !flushed
        || !this.navigation.isCurrent(generation)
        || flushed.key !== activatedKey
        || !activation.validateCurrentOccurrence(flushed.draft.body)
      ) return false

      const resolved = await this.adapter.openLink(activation.target)
      if (!this.navigation.isCurrent(generation)) return false
      const rewrittenBody = activation.applyCanonical(
        resolved.canonicalTarget,
        resolved.note.title,
      )
      if (rewrittenBody === null) return false
      this.updateBody(rewrittenBody)

      const canonical = await this.flush()
      if (!canonical || !this.navigation.isCurrent(generation)) return false
      if (canonical.key !== resolved.note.key) this.beginEditing(resolved.note)
      return true
    } catch (error) {
      await this.handleVaultError(error)
      return false
    } finally {
      activation.finish()
      this.navigation.finishTransition()
    }
  }

  private async navigateHistory(direction: 'back' | 'forward') {
    const generation = this.navigation.startTransition()
    if (generation === null) return false
    try {
      if ((this.note && !(await this.flush())) || !this.navigation.isCurrent(generation)) {
        return false
      }
      const destination = direction === 'back'
        ? this.navigation.previous()
        : this.navigation.next()
      if (!destination) return false

      if (destination.type === 'note') {
        const note = await this.adapter.read(destination.key)
        if (!this.navigation.isCurrent(generation) || !this.commitHistory(direction)) {
          return false
        }
        this.beginEditing(note, false)
      } else {
        if (!this.commitHistory(direction)) return false
        this.closeEditing()
        this.backlinksOpen = false
        this.publish()
      }
      return true
    } catch (error) {
      await this.handleVaultError(error)
      return false
    } finally {
      this.navigation.finishTransition()
    }
  }

  private commitHistory(direction: 'back' | 'forward') {
    return direction === 'back'
      ? this.navigation.commitBack()
      : this.navigation.commitForward()
  }

  private beginEditing(note: Note, pushHistory = true) {
    this.editing?.dispose()
    if (pushHistory) this.navigation.beginNote(note.key)
    this.editing = new NoteEditingSession(
      this.adapter,
      note,
      (snapshot) => {
        this.note = snapshot
        this.publish()
      },
      450,
      undefined,
      (oldKey, newKey) => {
        this.navigation.rename(oldKey, newKey)
        this.publish()
      },
    )
    this.note = this.editing.current()
    this.editorSessionId += 1
    this.backlinksOpen = false
    this.message = null
    this.publish()
  }

  private closeEditing() {
    this.editing?.dispose()
    this.editing = null
    this.note = null
  }

  private async handleVaultError(error: unknown) {
    this.reportError(error)
    await this.refreshVault()
  }

  private publish() {
    this.cachedSnapshot = null
    for (const listener of this.listeners) listener()
  }
}
