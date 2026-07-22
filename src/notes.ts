export type Note = {
  key: string
  title: string
  body: string
  revision: string
}

export type NoteDraft = Pick<Note, 'title' | 'body'>

export const MAX_NOTE_TITLE_LENGTH = 120

export function constrainNoteTitle(value: string) {
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_NOTE_TITLE_LENGTH)
}

export function normalizeTitle(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

export function findExactNote(notes: Note[], normalizedTitle: string) {
  return notes.find((note) => normalizeTitle(note.title) === normalizedTitle) ?? null
}

export function findRetrievalMatches(
  notes: Note[],
  normalizedThought: string,
  excludedNoteId?: string,
) {
  if (!normalizedThought) return []

  const terms = normalizedThought.split(' ').filter((term) => term.length > 2)
  if (terms.length === 0) return []

  return notes
    .filter((note) => note.key !== excludedNoteId)
    .map((note) => {
      const searchableText = `${normalizeTitle(note.title)} ${note.body.toLocaleLowerCase()}`
      const score = terms.reduce(
        (total, term) => total + Number(searchableText.includes(term)),
        0,
      )
      return { note, score }
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ note }) => note)
}

export function getExcerpt(body: string) {
  return body.replace(/\[\[|\]\]/g, '')
}
