import { invoke } from '@tauri-apps/api/core'
import {
  canonicalizeTitle,
  type Note,
  type NoteReference,
  type NoteDraft,
  type NotePreview,
  type OpenNoteLinkResponse,
  type SearchResponse,
} from './notes'
import type { NotePersistenceAdapter } from './noteEditing'

export type StorageError = {
  code: string
  message: string
}

export function getStorageError(error: unknown): StorageError {
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

export function openVault() {
  return invoke<boolean>('open_vault')
}

export function selectVault(name: string) {
  return invoke<boolean>('select_vault', { name })
}

export function searchStoredNotes(query: string) {
  return invoke<SearchResponse>('search_notes', { query })
}

export function suggestStoredNotes(query: string) {
  return invoke<NoteReference[]>('suggest_notes', { query })
}

export function createStoredNote(title: string) {
  return invoke<Note>('create_note', { title: canonicalizeTitle(title) })
}

export function createUntitledStoredNote() {
  return invoke<Note>('create_untitled_note')
}

export function openStoredNoteLink(target: string) {
  return invoke<OpenNoteLinkResponse>('open_note_link', { target })
}

export function resolveStoredNotePreview(target: string) {
  return invoke<NotePreview | null>('resolve_note_preview', { target })
}

export async function storedWikiLinkExists(target: string): Promise<boolean | null> {
  try {
    return (await resolveStoredNotePreview(target)) !== null
  } catch (reason) {
    const error = getStorageError(reason)
    return error.code === 'not_found' || error.code === 'invalid_link' ? false : null
  }
}

export function readStoredNotePreview(key: string) {
  return invoke<NotePreview>('read_note_preview', { key })
}

export function getStoredBacklinks(key: string) {
  return invoke<NoteReference[]>('get_backlinks', { key })
}

export function readStoredNote(key: string) {
  return invoke<Note>('read_note', { key })
}

function saveStoredNote(
  key: string,
  draft: NoteDraft,
  expectedRevision: string,
) {
  return invoke<Note>('save_note', {
    key,
    title: canonicalizeTitle(draft.title),
    body: draft.body,
    expectedRevision,
  })
}

function renameStoredNote(
  key: string,
  draft: NoteDraft,
  expectedRevision: string,
) {
  return invoke<Note>('rename_note', {
    key,
    title: canonicalizeTitle(draft.title),
    body: draft.body,
    expectedRevision,
  })
}

export const tauriNotePersistence: NotePersistenceAdapter = {
  read: readStoredNote,
  save: saveStoredNote,
  rename: renameStoredNote,
}
