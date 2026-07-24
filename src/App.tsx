import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ComposerScreen } from './ComposerScreen'
import { NoteEditor } from './NoteEditor'
import type { WikiLinkActivation } from './MarkdownEditor'
import { NoteNavigation } from './noteNavigation'
import { resolveWikiLinkActivation } from './wikiLinkNavigation'
import { AppShell, type TitleBarNavigation } from './TitleBar'
import {
  canonicalizeTitle,
  type Note,
  type SearchHit,
  type SearchResponse,
} from './notes'
import {
  createStoredNote,
  getStorageError,
  openVault,
  openStoredNoteLink,
  readStoredNote,
  searchStoredNotes,
  selectVault,
  tauriNotePersistence,
} from './storage'
import { useNoteEditing } from './useNoteEditing'
import './App.css'

type SearchView = SearchResponse & {
  query: string
}

type NavigationDirection = 'back' | 'forward'

const EMPTY_SEARCH_VIEW: SearchView = {
  query: '',
  results: [],
  hasExactMatch: false,
}

function App() {
  const [vaultReady, setVaultReady] = useState<boolean | null>(null)
  const [selectingVault, setSelectingVault] = useState(false)
  const [vaultName, setVaultName] = useState('My vault')
  const [thought, setThought] = useState('')
  const [backlinksOpen, setBacklinksOpen] = useState(false)
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const [storageMessage, setStorageMessage] = useState<string | null>(null)
  const [searchView, setSearchView] = useState<SearchView>(EMPTY_SEARCH_VIEW)
  const [searchGeneration, setSearchGeneration] = useState(0)
  const searchRequestRef = useRef(0)
  const [navigation] = useState(() => new NoteNavigation())
  const [, setNavigationRevision] = useState(0)
  const noteEditing = useNoteEditing(tauriNotePersistence, (oldKey, newKey) => {
    navigation.rename(oldKey, newKey)
    setNavigationRevision((revision) => revision + 1)
  })
  const editorDraft = noteEditing.snapshot?.draft ?? null

  const searchQuery = canonicalizeTitle(thought)
  const isEditing = editorDraft !== null
  const currentSearch = searchView.query === searchQuery
    ? searchView
    : EMPTY_SEARCH_VIEW
  const searchResults = currentSearch.results
  const exactNote = currentSearch.hasExactMatch
    ? currentSearch.results[0] ?? null
    : null

  const refreshVault = useCallback(async () => {
    try {
      const isReady = await openVault()
      setVaultReady(isReady)
      if (isReady) {
        setSearchGeneration((generation) => generation + 1)
        setStorageMessage(null)
      }
    } catch (error) {
      setVaultReady(false)
      setStorageMessage(getStorageError(error).message)
    }
  }, [])

  useEffect(() => {
    const startupTimer = window.setTimeout(() => void refreshVault(), 0)
    return () => window.clearTimeout(startupTimer)
  }, [refreshVault])

  useEffect(() => {
    function handleFocus() {
      void refreshVault()
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refreshVault])

  useEffect(() => {
    const requestId = ++searchRequestRef.current
    if (!vaultReady || isEditing || !searchQuery) return

    const searchTimer = window.setTimeout(() => {
      void searchStoredNotes(searchQuery).then(
        (response) => {
          if (searchRequestRef.current !== requestId) return
          setSearchView({ ...response, query: searchQuery })
          setActiveResultIndex(-1)
          setStorageMessage(null)
        },
        (error) => {
          if (searchRequestRef.current !== requestId) return
          setSearchView({ ...EMPTY_SEARCH_VIEW, query: searchQuery })
          setStorageMessage(getStorageError(error).message)
        },
      )
    }, 120)

    return () => window.clearTimeout(searchTimer)
  }, [isEditing, searchGeneration, searchQuery, vaultReady])

  function beginEditing(note: Note, pushHistory = true) {
    if (pushHistory) {
      navigation.beginNote(note.key)
      setNavigationRevision((revision) => revision + 1)
    }
    noteEditing.begin(note)
    setBacklinksOpen(false)
    setStorageMessage(null)
  }

  async function openNote(note: Pick<Note, 'key'>) {
    const generation = navigation.startTransition()
    if (generation === null) return
    try {
      if (isEditing && !(await noteEditing.flush())) return
      if (!navigation.isCurrent(generation) || noteEditing.snapshot?.key === note.key) return
      const destination = await readStoredNote(note.key)
      if (!navigation.isCurrent(generation)) return
      beginEditing(destination)
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
      await refreshVault()
    } finally {
      navigation.finishTransition()
    }
  }

  async function createNote() {
    const title = canonicalizeTitle(thought)
    if (!title) return

    if (exactNote) {
      await openNote(exactNote)
      return
    }

    try {
      beginEditing(await createStoredNote(title))
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
    }
  }

  function selectSearchResult(index: number) {
    const note: SearchHit | undefined = searchResults[index]
    if (note) {
      void openNote(note)
      return
    }

    if (!exactNote && index === searchResults.length) void createNote()
  }

  async function reloadConflictedNote() {
    if (await noteEditing.reload()) await refreshVault()
  }

  async function navigateHistory(direction: NavigationDirection) {
    const generation = navigation.startTransition()
    if (generation === null) return
    try {
      if (
        (isEditing && !(await noteEditing.flush()))
        || !navigation.isCurrent(generation)
      ) return

      const destination = direction === 'back'
        ? navigation.previous()
        : navigation.next()
      if (!destination) return

      if (destination.type === 'note') {
        const note = await readStoredNote(destination.key)
        if (!navigation.isCurrent(generation)) return
        const didCommit = direction === 'back'
          ? navigation.commitBack()
          : navigation.commitForward()
        if (!didCommit) return
        setNavigationRevision((revision) => revision + 1)
        beginEditing(note, false)
      } else {
        const didCommit = direction === 'back'
          ? navigation.commitBack()
          : navigation.commitForward()
        if (!didCommit) return
        setNavigationRevision((revision) => revision + 1)
        noteEditing.close()
        setThought(destination.thought)
        setBacklinksOpen(false)
      }
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
      await refreshVault()
    } finally {
      navigation.finishTransition()
    }
  }

  async function navigateHome() {
    if (navigation.current()?.type === 'composer') return

    const generation = navigation.startTransition()
    if (generation === null) return
    try {
      if (
        (isEditing && !(await noteEditing.flush()))
        || !navigation.isCurrent(generation)
      ) return

      navigation.beginComposer()
      setNavigationRevision((revision) => revision + 1)
      noteEditing.close()
      setThought('')
      setBacklinksOpen(false)
      setStorageMessage(null)
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
      await refreshVault()
    } finally {
      navigation.finishTransition()
    }
  }

  async function activateWikiLink(activation: WikiLinkActivation) {
    const activatedKey = noteEditing.snapshot?.key
    const generation = navigation.startTransition()
    if (generation === null || !activatedKey) return
    try {
      const destination = await resolveWikiLinkActivation({
        activatedKey,
        activation,
        flush: noteEditing.flush,
        open: openStoredNoteLink,
        updateBody: noteEditing.updateBody,
        isCurrent: () => navigation.isCurrent(generation),
      })
      if (destination) beginEditing(destination)
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
      await refreshVault()
    } finally {
      navigation.finishTransition()
    }
  }

  async function chooseVault() {
    setSelectingVault(true)
    setStorageMessage(null)
    try {
      const didSelect = await selectVault(vaultName)
      if (didSelect) {
        setVaultReady(true)
        setSearchGeneration((generation) => generation + 1)
        setVaultName('')
      }
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
    } finally {
      setSelectingVault(false)
    }
  }

  if (vaultReady === null) {
    return (
      <AppShell>
        <main aria-label="Opening vault" className="app bg-canvas" />
      </AppShell>
    )
  }

  if (!vaultReady) {
    return (
      <AppShell>
      <main className="app flex items-center justify-center bg-canvas px-6 pb-[8svh] text-ink">
        <section className="w-full max-w-sm">
          <h1 className="sr-only">Calmd</h1>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void chooseVault()
            }}
          >
            <label className="mb-1.5 block text-small text-secondary" htmlFor="vault-name">
              Name your vault
            </label>
            <Input
              aria-describedby="vault-location-help"
              autoFocus
              autoComplete="off"
              className="h-12 w-full rounded-lg border border-border bg-transparent px-4 text-base text-ink outline-none placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint"
              disabled={selectingVault}
              id="vault-name"
              onChange={(event) => {
                setVaultName(event.target.value)
                setStorageMessage(null)
              }}
              onFocus={(event) => {
                if (event.currentTarget.value === 'My vault') {
                  event.currentTarget.select()
                }
              }}
              placeholder="My vault"
              value={vaultName}
            />
            <p className="mt-2 text-pretty text-small text-faint" id="vault-location-help">
              Calmd will create this folder inside the location you choose.
            </p>
            <Button
              className="mt-6 inline-flex h-11 w-full select-none items-center justify-center rounded-lg bg-ink px-5 text-base text-canvas transition-[background-color,color,transform] duration-150 ease-out enabled:hover:bg-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-surface disabled:text-faint"
              disabled={selectingVault || !vaultName.trim()}
              type="submit"
            >
              {selectingVault ? 'Creating…' : 'Choose folder…'}
            </Button>
          </form>
          <div className="mt-4 min-h-10">
            {storageMessage ? (
              <p className="max-w-[45ch] text-pretty text-small text-secondary" role="alert">
                {storageMessage}
              </p>
            ) : null}
          </div>
        </section>
      </main>
      </AppShell>
    )
  }

  const currentLocation = navigation.current()
  const titleBarNavigation: TitleBarNavigation = {
    canGoBack: navigation.canGoBack(),
    canGoForward: navigation.canGoForward(),
    canGoHome: currentLocation?.type === 'note',
    onBack: () => void navigateHistory('back'),
    onForward: () => void navigateHistory('forward'),
    onHome: () => void navigateHome(),
  }

  if (editorDraft) {
    return (
      <AppShell navigation={titleBarNavigation}>
      <NoteEditor
        backlinksOpen={backlinksOpen}
        draft={editorDraft}
        noteKey={noteEditing.snapshot!.key}
        onBacklinksOpenChange={setBacklinksOpen}
        onDraftChange={noteEditing.updateDraft}
        onConflictReload={noteEditing.snapshot?.conflict ? reloadConflictedNote : null}
        onWikiLinkActivate={(activation) => void activateWikiLink(activation)}
        onBacklinkSelect={(key) => void openNote({ key })}
        saveMessage={noteEditing.snapshot?.failure?.message ?? storageMessage}
      />
      </AppShell>
    )
  }

  return (
    <AppShell navigation={titleBarNavigation}>
      <ComposerScreen
        activeResultIndex={activeResultIndex}
        hasExactMatch={Boolean(exactNote)}
        onActiveResultChange={setActiveResultIndex}
        onResultSelect={selectSearchResult}
        onSubmit={() => void createNote()}
        onThoughtChange={(nextThought) => {
          setThought(nextThought)
          navigation.updateComposerThought(nextThought)
          setActiveResultIndex(-1)
        }}
        results={searchResults}
        thought={thought}
      />
      {storageMessage ? (
        <p className="fixed inset-x-6 bottom-6 text-center text-small text-secondary" role="alert">
          {storageMessage}
        </p>
      ) : null}
    </AppShell>
  )
}

export default App
