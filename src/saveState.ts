import type { Note, NoteDraft } from './notes'

export function draftsMatch(left: NoteDraft, right: NoteDraft) {
  return left.title === right.title && left.body === right.body
}

export function reconcileSavedDraft(
  currentDraft: NoteDraft,
  sentDraft: NoteDraft,
  savedNote: Note,
) {
  const canonicalDraft = { title: savedNote.title, body: savedNote.body }
  return {
    canonicalDraft,
    editorDraft: draftsMatch(currentDraft, sentDraft) ? canonicalDraft : currentDraft,
  }
}
