import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { WikiLinkActivation } from '../markdown-editor/contracts'
import type { NoteDraft, NoteReference } from '../notes'
import {
  NoteWorkspaceRuntime,
  type NoteWorkspaceAdapter,
  type NoteWorkspaceSnapshot,
} from './runtime'
import { NoteWorkspaceContext } from './context'
import { EditorChromeProvider } from './EditorChromeProvider'

export type NoteWorkspaceActions = {
  activateWikiLink: (activation: WikiLinkActivation) => Promise<boolean>
  back: () => Promise<boolean>
  create: (title: string) => Promise<boolean>
  createUntitled: () => Promise<boolean>
  deleteCurrent: () => Promise<boolean>
  flush: NoteWorkspaceRuntime['flush']
  forward: () => Promise<boolean>
  home: () => Promise<boolean>
  open: (key: string) => Promise<boolean>
  openRandom: NoteWorkspaceRuntime['openRandom']
  reload: () => Promise<boolean>
  reportError: (error: unknown) => void
  setBacklinksOpen: (open: boolean) => void
  setDeleteOpen: (open: boolean) => void
  setMessage: (message: string | null) => void
  updateComposerThought: (thought: string) => void
  updateDraft: (draft: NoteDraft) => void
}

export type NoteWorkspaceMeta = {
  externalMessage: string | null
  onSpellcheckEnabledChange: (enabled: boolean) => void
  resolveWikiLink: (target: string) => Promise<boolean | null>
  spellcheckEnabled: boolean
  suggestWikiLinks: (query: string) => Promise<NoteReference[]>
}

export type NoteWorkspaceContextValue = {
  actions: NoteWorkspaceActions
  meta: NoteWorkspaceMeta
  state: NoteWorkspaceSnapshot
}

type NoteWorkspaceProviderProps = {
  adapter: NoteWorkspaceAdapter
  children: ReactNode
  externalMessage: string | null
  onCollectionChange: () => void
  onSpellcheckEnabledChange: (enabled: boolean) => void
  refreshVault: () => Promise<void>
  spellcheckEnabled: boolean
}

export function NoteWorkspaceProvider({
  adapter,
  children,
  externalMessage,
  onCollectionChange,
  onSpellcheckEnabledChange,
  refreshVault,
  spellcheckEnabled,
}: NoteWorkspaceProviderProps) {
  const [runtime] = useState(() => new NoteWorkspaceRuntime({
    adapter,
    onCollectionChange,
    refreshVault,
  }))
  const state = useSyncExternalStore(runtime.subscribe, runtime.current)
  useEffect(() => () => runtime.dispose(), [runtime])

  const actions = useMemo<NoteWorkspaceActions>(() => ({
    activateWikiLink: runtime.activateWikiLink,
    back: runtime.back,
    create: runtime.create,
    createUntitled: runtime.createUntitled,
    deleteCurrent: runtime.deleteCurrent,
    flush: runtime.flush,
    forward: runtime.forward,
    home: runtime.home,
    open: runtime.open,
    openRandom: runtime.openRandom,
    reload: runtime.reload,
    reportError: runtime.reportError,
    setBacklinksOpen: runtime.setBacklinksOpen,
    setDeleteOpen: runtime.setDeleteOpen,
    setMessage: runtime.setMessage,
    updateComposerThought: runtime.updateComposerThought,
    updateDraft: runtime.updateDraft,
  }), [runtime])

  const value = useMemo<NoteWorkspaceContextValue>(() => ({
    actions,
    meta: {
      externalMessage,
      onSpellcheckEnabledChange,
      resolveWikiLink: adapter.resolveWikiLink,
      spellcheckEnabled,
      suggestWikiLinks: adapter.suggestWikiLinks,
    },
    state,
  }), [
    actions,
    adapter,
    externalMessage,
    onSpellcheckEnabledChange,
    spellcheckEnabled,
    state,
  ])

  return (
    <NoteWorkspaceContext value={value}>
      <EditorChromeProvider>{children}</EditorChromeProvider>
    </NoteWorkspaceContext>
  )
}
