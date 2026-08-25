import type { NoteDraft, NotePreview } from './notes'

export const NOTE_PREVIEW_CHARACTER_LIMIT = 4_000
export const NOTE_PREVIEW_OPEN_DELAY_MS = 300
export const NOTE_PREVIEW_CLOSE_DELAY_MS = 100

export type NotePreviewCandidate =
  | {
    source: 'wiki-link'
    id: string
    target: string
    anchor: Element
  }
  | {
    source: 'backlink'
    id: string
    key: string
    anchor: Element
  }

export type NotePreviewLoadResult =
  | { kind: 'found'; preview: NotePreview }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }

export type NotePreviewState =
  | { status: 'idle' }
  | { status: 'armed' | 'waiting' | 'loading'; candidate: NotePreviewCandidate }
  | { status: 'visible'; candidate: NotePreviewCandidate; preview: NotePreview }
  | { status: 'error'; candidate: NotePreviewCandidate; message: string }

type TimerHandle = ReturnType<typeof setTimeout>
type PreviewScheduler = {
  set: (callback: () => void, delay: number) => TimerHandle
  clear: (handle: TimerHandle) => void
}

const DEFAULT_SCHEDULER: PreviewScheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (handle) => clearTimeout(handle),
}
const IDLE_STATE: NotePreviewState = { status: 'idle' }

export class NotePreviewController {
  private state: NotePreviewState = IDLE_STATE
  private candidate: NotePreviewCandidate | null = null
  private sourceHovered = false
  private previewHovered = false
  private modifierHeld = false
  private intentTimer: TimerHandle | null = null
  private closeTimer: TimerHandle | null = null
  private requestGeneration = 0
  private readonly listeners = new Set<() => void>()
  private readonly load: (candidate: NotePreviewCandidate) => Promise<NotePreviewLoadResult>
  private readonly scheduler: PreviewScheduler

  constructor(
    load: (candidate: NotePreviewCandidate) => Promise<NotePreviewLoadResult>,
    scheduler: PreviewScheduler = DEFAULT_SCHEDULER,
  ) {
    this.load = load
    this.scheduler = scheduler
  }

  getSnapshot = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enterSource = (candidate: NotePreviewCandidate) => {
    this.sourceHovered = true
    const changed = this.candidate?.id !== candidate.id
    this.candidate = candidate

    if (changed) {
      this.invalidatePendingWork()
      if (this.modifierHeld) this.waitToLoad()
      else this.publish({ status: 'armed', candidate })
      return
    }

    if (this.state.status !== 'idle') {
      this.publish({ ...this.state, candidate })
    } else if (this.modifierHeld) {
      this.waitToLoad()
    } else {
      this.publish({ status: 'armed', candidate })
    }
  }

  leaveSource = () => {
    this.sourceHovered = false
    if (this.state.status === 'loading'
      || this.state.status === 'visible'
      || this.state.status === 'error') {
      this.scheduleClose()
    } else {
      this.dismiss()
    }
  }

  enterPreview = () => {
    this.previewHovered = true
    this.clearCloseTimer()
  }

  leavePreview = () => {
    this.previewHovered = false
    if (!this.sourceHovered) this.scheduleClose()
  }

  setModifierHeld = (held: boolean) => {
    if (this.modifierHeld === held) return
    this.modifierHeld = held
    if (!held) {
      if (this.state.status === 'waiting') this.deactivate()
      return
    }
    if (this.candidate && this.sourceHovered) {
      this.waitToLoad()
    }
  }

  resetOnBlur = () => {
    this.modifierHeld = false
    this.dismiss()
  }

  dismiss = () => {
    this.invalidatePendingWork()
    this.candidate = null
    this.sourceHovered = false
    this.previewHovered = false
    this.publish(IDLE_STATE)
  }

  dispose = () => {
    this.invalidatePendingWork()
    this.listeners.clear()
  }

  private waitToLoad() {
    const candidate = this.candidate
    if (!candidate || !this.sourceHovered || !this.modifierHeld) return
    this.clearIntentTimer()
    this.publish({ status: 'waiting', candidate })
    this.intentTimer = this.scheduler.set(() => {
      this.intentTimer = null
      void this.loadCandidate(candidate)
    }, NOTE_PREVIEW_OPEN_DELAY_MS)
  }

  private async loadCandidate(candidate: NotePreviewCandidate) {
    if (this.candidate?.id !== candidate.id || !this.modifierHeld) return
    const generation = ++this.requestGeneration
    this.publish({ status: 'loading', candidate })
    const result = await this.load(candidate)
    if (generation !== this.requestGeneration || this.candidate?.id !== candidate.id) return

    if (result.kind === 'found') {
      this.publish({ status: 'visible', candidate: this.candidate, preview: result.preview })
    } else if (result.kind === 'error') {
      this.publish({ status: 'error', candidate: this.candidate, message: result.message })
    } else {
      this.deactivate()
    }
  }

  private scheduleClose() {
    this.clearCloseTimer()
    this.closeTimer = this.scheduler.set(() => {
      this.closeTimer = null
      if (!this.sourceHovered && !this.previewHovered) this.dismiss()
    }, NOTE_PREVIEW_CLOSE_DELAY_MS)
  }

  private deactivate() {
    this.invalidatePendingWork()
    this.previewHovered = false
    if (this.candidate && this.sourceHovered) {
      this.publish({ status: 'armed', candidate: this.candidate })
    } else {
      this.candidate = null
      this.publish(IDLE_STATE)
    }
  }

  private invalidatePendingWork() {
    this.clearIntentTimer()
    this.clearCloseTimer()
    this.requestGeneration += 1
  }

  private clearIntentTimer() {
    if (this.intentTimer === null) return
    this.scheduler.clear(this.intentTimer)
    this.intentTimer = null
  }

  private clearCloseTimer() {
    if (this.closeTimer === null) return
    this.scheduler.clear(this.closeTimer)
    this.closeTimer = null
  }

  private publish(state: NotePreviewState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

export function truncateNotePreviewBody(body: string) {
  let characterCount = 0
  let utf16Offset = 0
  for (const character of body) {
    if (characterCount === NOTE_PREVIEW_CHARACTER_LIMIT) {
      return { excerpt: body.slice(0, utf16Offset), truncated: true }
    }
    characterCount += 1
    utf16Offset += character.length
  }
  return { excerpt: body, truncated: false }
}

export function previewFromDraft(key: string, draft: NoteDraft): NotePreview {
  return {
    key,
    title: draft.title,
    ...truncateNotePreviewBody(draft.body),
  }
}
