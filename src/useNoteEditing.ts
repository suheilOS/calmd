import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NoteEditingSession,
  type NoteEditingSnapshot,
  type NotePersistenceAdapter,
} from './noteEditing'
import type { Note, NoteDraft } from './notes'

export function useNoteEditing(
  persistence: NotePersistenceAdapter,
  onRename: (oldKey: string, newKey: string) => void,
) {
  const sessionRef = useRef<NoteEditingSession | null>(null)
  const [snapshot, setSnapshot] = useState<NoteEditingSnapshot | null>(null)
  const onRenameRef = useRef(onRename)

  useEffect(() => {
    onRenameRef.current = onRename
  }, [onRename])

  useEffect(() => () => sessionRef.current?.dispose(), [])

  const begin = useCallback((note: Note) => {
    sessionRef.current?.dispose()
    const session = new NoteEditingSession(
      persistence,
      note,
      setSnapshot,
      450,
      undefined,
      (oldKey, newKey) => onRenameRef.current(oldKey, newKey),
    )
    sessionRef.current = session
    setSnapshot(session.current())
  }, [persistence])

  const updateDraft = useCallback((draft: NoteDraft) => {
    sessionRef.current?.updateDraft(draft)
  }, [])

  const updateBody = useCallback((body: string) => {
    sessionRef.current?.updateBody(body)
  }, [])

  const reload = useCallback(async () => {
    return await sessionRef.current?.reload() ?? false
  }, [])

  const flush = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return null
    const snapshot = await session.flush()
    return sessionRef.current === session ? snapshot : null
  }, [])

  const close = useCallback(() => {
    const session = sessionRef.current
    session?.dispose()
    if (sessionRef.current === session) {
      sessionRef.current = null
      setSnapshot(null)
    }
  }, [])

  const flushAndClose = useCallback(async () => {
    if (!(await flush())) return false
    close()
    return true
  }, [close, flush])

  return { snapshot, begin, updateDraft, updateBody, reload, flush, close, flushAndClose }
}
