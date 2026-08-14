import { createContext, use } from 'react'
import type { NoteWorkspaceContextValue } from './provider'

export const NoteWorkspaceContext = createContext<NoteWorkspaceContextValue | null>(null)

export function useNoteWorkspace() {
  const workspace = use(NoteWorkspaceContext)
  if (!workspace) {
    throw new Error('Note workspace modules must be rendered inside NoteWorkspace.Provider.')
  }
  return workspace
}
