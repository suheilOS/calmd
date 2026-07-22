export type Note = {
  id: string
  title: string
  body: string
}

export type NoteDraft = Pick<Note, 'title' | 'body'>

export const MAX_NOTE_TITLE_LENGTH = 120

export function constrainNoteTitle(value: string) {
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_NOTE_TITLE_LENGTH)
}

export const initialNotes: Note[] = [
  {
    id: 'good-systems-disappear',
    title: 'A good system disappears while you use it',
    body: 'The best tools make room for the work itself. A system should support attention without asking to be maintained.',
  },
  {
    id: 'shape-of-useful-thought',
    title: 'The shape of a useful thought',
    body: 'A thought becomes easier to return to when it has one clear edge. Start with the smallest sentence that feels true.',
  },
  {
    id: 'attention-is-finite',
    title: 'Attention is a finite room',
    body: 'Every visible choice takes a little space. Calm software protects the room around the thought.',
  },
  {
    id: 'writing-is-returning',
    title: 'Writing is a way of returning',
    body: 'Notes are invitations to meet an earlier version of an idea again, with a little more distance.',
  },
]

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
    .filter((note) => note.id !== excludedNoteId)
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

export function updateNote(notes: Note[], noteId: string, draft: NoteDraft) {
  return notes.map((note) =>
    note.id === noteId ? { ...note, ...draft } : note,
  )
}

export function getExcerpt(body: string) {
  return body.replace(/\[\[|\]\]/g, '')
}
