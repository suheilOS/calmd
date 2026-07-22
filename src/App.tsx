import { useEffect, useMemo, useState } from 'react'
import { ComposerScreen } from './ComposerScreen'
import { NoteEditor } from './NoteEditor'
import {
  findBacklinks,
  findExactNote,
  findRetrievalMatches,
  initialNotes,
  normalizeTitle,
  updateNote,
  type Note,
  type NoteDraft,
} from './notes'
import './App.css'

function App() {
  const [notes, setNotes] = useState<Note[]>(initialNotes)
  const [thought, setThought] = useState('')
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [editorDraft, setEditorDraft] = useState<NoteDraft | null>(null)
  const [backlinksOpen, setBacklinksOpen] = useState(false)
  const [activeResultIndex, setActiveResultIndex] = useState(-1)

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? null,
    [activeNoteId, notes],
  )
  const normalizedThought = normalizeTitle(thought)
  const exactNote = useMemo(
    () => findExactNote(notes, normalizedThought),
    [notes, normalizedThought],
  )
  const searchResults = useMemo(
    () => exactNote
      ? [exactNote]
      : findRetrievalMatches(notes, normalizedThought),
    [exactNote, notes, normalizedThought],
  )
  const editorTitle = editorDraft?.title
  const backlinks = useMemo(
    () => activeNote && editorTitle !== undefined
      ? findBacklinks(notes, activeNote, editorTitle)
      : [],
    [activeNote, editorTitle, notes],
  )

  useEffect(() => {
    if (!activeNoteId || !editorDraft) return

    const saveTimer = window.setTimeout(() => {
      setNotes((currentNotes) => updateNote(currentNotes, activeNoteId, editorDraft))
    }, 450)

    return () => window.clearTimeout(saveTimer)
  }, [activeNoteId, editorDraft])

  function openNote(note: Note) {
    setActiveNoteId(note.id)
    setEditorDraft({ title: note.title, body: note.body })
    setBacklinksOpen(false)
  }

  function createNote() {
    const title = thought.trim().replace(/\s+/g, ' ')
    if (!title) return

    if (exactNote) {
      openNote(exactNote)
      return
    }

    const newNote: Note = { id: `note-${Date.now()}`, title, body: '' }
    setNotes((currentNotes) => [newNote, ...currentNotes])
    openNote(newNote)
  }

  function selectSearchResult(index: number) {
    const note = searchResults[index]
    if (note) {
      openNote(note)
      return
    }

    if (!exactNote && index === searchResults.length) createNote()
  }

  function returnHome() {
    if (activeNoteId && editorDraft) {
      setNotes((currentNotes) => updateNote(currentNotes, activeNoteId, editorDraft))
    }

    setActiveNoteId(null)
    setEditorDraft(null)
    setThought('')
  }

  if (activeNote && editorDraft) {
    return (
      <NoteEditor
        backlinks={backlinks}
        backlinksOpen={backlinksOpen}
        draft={editorDraft}
        onBacklinksOpenChange={setBacklinksOpen}
        onDraftChange={setEditorDraft}
        onNoteOpen={openNote}
        onReturn={returnHome}
      />
    )
  }

  return (
    <ComposerScreen
      activeResultIndex={activeResultIndex}
      hasExactMatch={Boolean(exactNote)}
      onActiveResultChange={setActiveResultIndex}
      onResultSelect={selectSearchResult}
      onSubmit={createNote}
      onThoughtChange={(nextThought) => {
        setThought(nextThought)
        setActiveResultIndex(-1)
      }}
      results={searchResults}
      thought={thought}
    />
  )
}

export default App
