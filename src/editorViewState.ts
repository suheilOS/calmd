import { EditorSelection, type EditorState } from '@codemirror/state'

type StoredEditorViewState = {
  mainIndex: number
  ranges: readonly { anchor: number; head: number }[]
  scrollTop: number
}

const noteViewStates = new Map<string, StoredEditorViewState>()
const discardedNoteKeys = new Set<string>()
const MAX_REMEMBERED_NOTES = 100

export function rememberEditorViewState(
  noteKey: string,
  state: EditorState,
  scrollTop: number,
) {
  if (discardedNoteKeys.has(noteKey)) return
  noteViewStates.delete(noteKey)
  noteViewStates.set(noteKey, {
    mainIndex: state.selection.mainIndex,
    ranges: state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
    scrollTop,
  })
  while (noteViewStates.size > MAX_REMEMBERED_NOTES) {
    const oldest = noteViewStates.keys().next().value
    if (oldest === undefined) break
    noteViewStates.delete(oldest)
  }
}

export function recallEditorViewState(noteKey: string, documentLength: number) {
  if (discardedNoteKeys.delete(noteKey)) return null
  const stored = noteViewStates.get(noteKey)
  if (!stored) return null
  noteViewStates.delete(noteKey)
  noteViewStates.set(noteKey, stored)
  const clamp = (position: number) => Math.max(0, Math.min(position, documentLength))
  return {
    selection: EditorSelection.create(
      stored.ranges.map(({ anchor, head }) => EditorSelection.range(
        clamp(anchor),
        clamp(head),
      )),
      Math.min(stored.mainIndex, stored.ranges.length - 1),
    ),
    scrollTop: Math.max(0, stored.scrollTop),
  }
}

export function renameEditorViewState(oldKey: string, newKey: string) {
  if (oldKey === newKey) return
  discardedNoteKeys.delete(newKey)
  const stored = noteViewStates.get(oldKey)
  if (stored) noteViewStates.set(newKey, stored)
  noteViewStates.delete(oldKey)
}

export function discardEditorViewState(noteKey: string) {
  noteViewStates.delete(noteKey)
  discardedNoteKeys.delete(noteKey)
  discardedNoteKeys.add(noteKey)
  while (discardedNoteKeys.size > MAX_REMEMBERED_NOTES) {
    const oldest = discardedNoteKeys.values().next().value
    if (oldest === undefined) break
    discardedNoteKeys.delete(oldest)
  }
}

/** View positions belong to the selected vault and must not cross vault boundaries. */
export function clearEditorViewState() {
  noteViewStates.clear()
  discardedNoteKeys.clear()
}
