import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ComposerScreen } from './ComposerScreen'
import { NoteEditor } from './NoteEditor'
import { AppShell } from './TitleBar'
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

const EMPTY_SEARCH_VIEW: SearchView = {
  query: '',
  results: [],
  hasExactMatch: false,
}

function App() {
  const [vaultReady, setVaultReady] = useState<boolean | null>(null)
  const [selectingVault, setSelectingVault] = useState(false)
  const [vaultName, setVaultName] = useState('')
  const [thought, setThought] = useState('')
  const [backlinksOpen, setBacklinksOpen] = useState(false)
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const [storageMessage, setStorageMessage] = useState<string | null>(null)
  const [searchView, setSearchView] = useState<SearchView>(EMPTY_SEARCH_VIEW)
  const [searchGeneration, setSearchGeneration] = useState(0)
  const searchRequestRef = useRef(0)
  const noteEditing = useNoteEditing(tauriNotePersistence)
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

  function beginEditing(note: Note) {
    noteEditing.begin(note)
    setBacklinksOpen(false)
    setStorageMessage(null)
  }

  async function openNote(note: Pick<Note, 'key'>) {
    try {
      beginEditing(await readStoredNote(note.key))
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
      await refreshVault()
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

  async function returnHome() {
    if (!(await noteEditing.flushAndClose())) return
    setThought('')
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
      <main className="app flex items-center justify-center bg-canvas px-6 text-ink">
        <section className="w-full max-w-sm">
          <h1 className="sr-only">Calmd</h1>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void chooseVault()
            }}
          >
            <label className="mb-2 block text-small text-secondary" htmlFor="vault-name">
              Vault name
            </label>
            <Input
              aria-describedby="vault-location-help"
              autoFocus
              autoComplete="off"
              className="w-full rounded-lg border border-border bg-transparent px-4 py-2.5 text-base text-ink outline-none placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint"
              disabled={selectingVault}
              id="vault-name"
              onChange={(event) => {
                setVaultName(event.target.value)
                setStorageMessage(null)
              }}
              placeholder="My vault"
              value={vaultName}
            />
            <p className="mt-2 text-small text-faint" id="vault-location-help">
              A folder with this name will be created in the location you choose.
            </p>
            <Button
              className="mt-4 rounded-lg border border-border px-5 py-2.5 text-base text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint active:scale-[0.97] disabled:cursor-not-allowed disabled:text-faint"
              disabled={selectingVault || !vaultName.trim()}
              type="submit"
            >
              {selectingVault ? 'Creating…' : 'Choose location…'}
            </Button>
          </form>
          {storageMessage ? (
            <p className="mt-4 max-w-[45ch] text-small text-secondary" role="alert">
              {storageMessage}
            </p>
          ) : null}
        </section>
      </main>
      </AppShell>
    )
  }

  if (editorDraft) {
    return (
      <AppShell>
      <NoteEditor
        backlinksOpen={backlinksOpen}
        draft={editorDraft}
        onBacklinksOpenChange={setBacklinksOpen}
        onDraftChange={noteEditing.updateDraft}
        onConflictReload={noteEditing.snapshot?.conflict ? reloadConflictedNote : null}
        onReturn={returnHome}
        saveMessage={noteEditing.snapshot?.failure?.message ?? storageMessage}
      />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <ComposerScreen
        activeResultIndex={activeResultIndex}
        hasExactMatch={Boolean(exactNote)}
        onActiveResultChange={setActiveResultIndex}
        onResultSelect={selectSearchResult}
        onSubmit={() => void createNote()}
        onThoughtChange={(nextThought) => {
          setThought(nextThought)
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
