import {
  createStoredNote,
  createUntitledStoredNote,
  deleteStoredNote,
  getStorageError,
  openRandomStoredNote,
  openStoredNoteLink,
  storedWikiLinkExists,
  suggestStoredNotes,
  tauriNotePersistence,
} from '../storage'
import type { NoteWorkspaceAdapter } from './runtime'

export const tauriNoteWorkspace: NoteWorkspaceAdapter = {
  ...tauriNotePersistence,
  create: createStoredNote,
  createUntitled: createUntitledStoredNote,
  delete: deleteStoredNote,
  errorMessage: (error) => getStorageError(error).message,
  openLink: openStoredNoteLink,
  openRandom: openRandomStoredNote,
  resolveWikiLink: storedWikiLinkExists,
  suggestWikiLinks: suggestStoredNotes,
}
