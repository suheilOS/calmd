import { invoke } from '@tauri-apps/api/core'
import {
  canonicalizeTitle,
  type Note,
  type NoteDraft,
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

export function createStoredNote(title: string) {
  return invoke<Note>('create_note', { title: canonicalizeTitle(title) })
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
