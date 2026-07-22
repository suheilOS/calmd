export type Note = {
  key: string
  title: string
  body: string
  revision: string
}

export type NoteDraft = Pick<Note, 'title' | 'body'>

export type SearchHit = Pick<Note, 'key' | 'title'> & {
  excerpt: string
}

export type SearchResponse = {
  results: SearchHit[]
  hasExactMatch: boolean
}

export const MAX_NOTE_TITLE_LENGTH = 120

export function constrainNoteTitle(value: string) {
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_NOTE_TITLE_LENGTH)
}

export function canonicalizeTitle(value: string) {
  return constrainNoteTitle(value).trim().replace(/\s+/gu, ' ')
}
