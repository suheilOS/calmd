import { NoteEditor } from './NoteEditor'
import { NoteWorkspaceProvider } from './provider'
import { WorkspaceActions } from './WorkspaceActions'

export { useNoteWorkspace } from './context'
export { type NoteWorkspaceAdapter } from './runtime'
export { tauriNoteWorkspace } from './tauriAdapter'

export const NoteWorkspace = {
  Actions: WorkspaceActions,
  Editor: NoteEditor,
  Provider: NoteWorkspaceProvider,
}
