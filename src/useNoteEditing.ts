import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NoteEditingSession,
  type NoteEditingSnapshot,
  type NotePersistenceAdapter,
} from './noteEditing'
import type { Note, NoteDraft } from './notes'

export function useNoteEditing(persistence: NotePersistenceAdapter) {
  const sessionRef = useRef<NoteEditingSession | null>(null)
  const [snapshot, setSnapshot] = useState<NoteEditingSnapshot | null>(null)

  useEffect(() => () => sessionRef.current?.dispose(), [])

  const begin = useCallback((note: Note) => {
    sessionRef.current?.dispose()
    const session = new NoteEditingSession(persistence, note, setSnapshot)
    sessionRef.current = session
    setSnapshot(session.current())
  }, [persistence])

  const updateDraft = useCallback((draft: NoteDraft) => {
    sessionRef.current?.updateDraft(draft)
  }, [])

  const reload = useCallback(async () => {
    return await sessionRef.current?.reload() ?? false
  }, [])

  const flushAndClose = useCallback(async () => {
    const session = sessionRef.current
    if (!session || !(await session.flush())) return false
    session.dispose()
    if (sessionRef.current === session) {
      sessionRef.current = null
      setSnapshot(null)
    }
    return true
  }, [])

  return { snapshot, begin, updateDraft, reload, flushAndClose }
}
