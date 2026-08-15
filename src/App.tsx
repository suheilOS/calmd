import { Button } from '@base-ui/react/button'
import { Input } from '@base-ui/react/input'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { ComposerScreen } from './ComposerScreen'
import { clearEditorViewState } from './markdown-editor/editorViewState'
import {
  isCreateUntitledShortcut,
  isNavigateHomeShortcut,
  isOpenRandomNoteShortcut,
} from './keyboardShortcuts'
import {
  NoteWorkspace,
  tauriNoteWorkspace,
  useNoteWorkspace,
} from './note-workspace'
import {
  canonicalizeTitle,
  type SearchHit,
  type SearchResponse,
} from './notes'
import {
  getStorageError,
  openVault,
  readStoredEditorSpellcheck,
  saveStoredEditorSpellcheck,
  searchStoredNotes,
  selectVault,
} from './storage'
import { AppShell, type TitleBarNavigation } from './TitleBar'
import './App.css'

type SearchView = SearchResponse & {
  query: string
}

const EMPTY_SEARCH_VIEW: SearchView = {
  query: '',
  results: [],
  hasExactMatch: false,
}

type ApplicationProps = {
  chooseVault: () => Promise<void>
  collectionRevision: number
  selectingVault: boolean
  setStorageMessage: (message: string | null) => void
  setVaultName: (name: string) => void
  storageMessage: string | null
  vaultName: string
  vaultReady: boolean | null
}

function OpeningVaultScreen() {
  return (
    <AppShell>
      <main aria-label="Opening vault" className="app bg-canvas" />
    </AppShell>
  )
}

function VaultSelectionScreen({
  chooseVault,
  selectingVault,
  setStorageMessage,
  setVaultName,
  storageMessage,
  vaultName,
}: Omit<ApplicationProps, 'collectionRevision' | 'vaultReady'>) {
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
              className="h-12 w-full rounded-xl bg-surface px-4 text-base text-ink outline-none placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint"
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
              className="mt-6 inline-flex h-11 w-full select-none items-center justify-center rounded-xl bg-accent px-5 text-base text-accent-ink transition-[background-color,color,transform] duration-150 ease-out enabled:hover:bg-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-surface disabled:text-faint"
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

function Application({
  chooseVault,
  collectionRevision,
  selectingVault,
  setStorageMessage,
  setVaultName,
  storageMessage,
  vaultName,
  vaultReady,
}: ApplicationProps) {
  const { actions, state } = useNoteWorkspace()
  const [activeResultIndex, setActiveResultIndex] = useState(-1)
  const [searchView, setSearchView] = useState<SearchView>(EMPTY_SEARCH_VIEW)
  const searchRequestRef = useRef(0)
  const thought = state.location.type === 'composer' ? state.location.thought : ''
  const isEditing = state.note !== null
  const searchQuery = canonicalizeTitle(thought)
  const currentSearch = searchView.query === searchQuery
    ? searchView
    : EMPTY_SEARCH_VIEW
  const searchResults = currentSearch.results
  const exactNote = currentSearch.hasExactMatch
    ? currentSearch.results[0] ?? null
    : null

  const createUntitled = useEffectEvent(() => {
    void actions.createUntitled()
  })
  const navigateHome = useEffectEvent(() => {
    void actions.home()
  })
  const openRandom = useEffectEvent(() => {
    if (vaultReady) void actions.openRandom()
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isOpenRandomNoteShortcut(event)) {
        event.preventDefault()
        openRandom()
        return
      }
      if (isCreateUntitledShortcut(event)) {
        event.preventDefault()
        createUntitled()
        return
      }
      if (isNavigateHomeShortcut(event)) {
        event.preventDefault()
        navigateHome()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

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
          actions.setMessage(null)
        },
        (error) => {
          if (searchRequestRef.current !== requestId) return
          setSearchView({ ...EMPTY_SEARCH_VIEW, query: searchQuery })
          setStorageMessage(getStorageError(error).message)
        },
      )
    }, 120)

    return () => window.clearTimeout(searchTimer)
  }, [
    actions,
    collectionRevision,
    searchQuery,
    setStorageMessage,
    isEditing,
    vaultReady,
  ])

  if (vaultReady === null) return <OpeningVaultScreen />
  if (!vaultReady) {
    return (
      <VaultSelectionScreen
        chooseVault={chooseVault}
        selectingVault={selectingVault}
        setStorageMessage={setStorageMessage}
        setVaultName={setVaultName}
        storageMessage={state.message ?? storageMessage}
        vaultName={vaultName}
      />
    )
  }

  const navigation: TitleBarNavigation = {
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    canGoHome: state.canGoHome,
    onBack: () => void actions.back(),
    onForward: () => void actions.forward(),
    onHome: () => void actions.home(),
  }

  if (state.note) {
    return (
      <AppShell navigation={navigation} noteActions={<NoteWorkspace.Actions />}>
        <NoteWorkspace.Editor />
      </AppShell>
    )
  }

  function createNote() {
    if (!searchQuery) return
    if (exactNote) {
      void actions.open(exactNote.key)
      return
    }
    void actions.create(searchQuery)
  }

  function selectSearchResult(index: number) {
    const note: SearchHit | undefined = searchResults[index]
    if (note) {
      void actions.open(note.key)
      return
    }
    if (!exactNote && index === searchResults.length) createNote()
  }

  return (
    <AppShell navigation={navigation}>
      <ComposerScreen
        activeResultIndex={activeResultIndex}
        hasExactMatch={Boolean(exactNote)}
        onActiveResultChange={setActiveResultIndex}
        onRandomNote={() => void actions.openRandom()}
        onResultSelect={selectSearchResult}
        onSubmit={createNote}
        onThoughtChange={(nextThought) => {
          actions.updateComposerThought(nextThought)
          setActiveResultIndex(-1)
        }}
        results={searchResults}
        thought={thought}
      />
      {state.message ?? storageMessage ? (
        <p className="fixed inset-x-6 bottom-6 text-center text-small text-secondary" role="alert">
          {state.message ?? storageMessage}
        </p>
      ) : null}
    </AppShell>
  )
}

function App() {
  const [vaultReady, setVaultReady] = useState<boolean | null>(null)
  const [selectingVault, setSelectingVault] = useState(false)
  const [vaultName, setVaultName] = useState('My vault')
  const [storageMessage, setStorageMessage] = useState<string | null>(null)
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(true)
  const [collectionRevision, setCollectionRevision] = useState(0)
  const spellcheckRequestRef = useRef(0)
  const lastPersistedSpellcheckRef = useRef(true)
  const spellcheckSaveRef = useRef(Promise.resolve())

  const refreshVault = useCallback(async () => {
    try {
      const isReady = await openVault()
      setVaultReady(isReady)
      if (isReady) {
        setCollectionRevision((revision) => revision + 1)
        setStorageMessage(null)
      }
    } catch (error) {
      setVaultReady(false)
      setStorageMessage(getStorageError(error).message)
    }
  }, [])

  const collectionChanged = useCallback(() => {
    setCollectionRevision((revision) => revision + 1)
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
    const requestId = ++spellcheckRequestRef.current
    void readStoredEditorSpellcheck().then(
      (enabled) => {
        if (spellcheckRequestRef.current === requestId) {
          lastPersistedSpellcheckRef.current = enabled
          setSpellcheckEnabled(enabled)
        }
      },
      (error) => {
        if (spellcheckRequestRef.current === requestId) {
          setStorageMessage(getStorageError(error).message)
        }
      },
    )
  }, [])

  async function updateSpellcheck(enabled: boolean) {
    const requestId = ++spellcheckRequestRef.current
    setSpellcheckEnabled(enabled)
    try {
      const operation = spellcheckSaveRef.current.then(() =>
        saveStoredEditorSpellcheck(enabled),
      )
      spellcheckSaveRef.current = operation.then(() => undefined, () => undefined)
      const saved = await operation
      lastPersistedSpellcheckRef.current = saved
      if (spellcheckRequestRef.current === requestId) setSpellcheckEnabled(saved)
    } catch (error) {
      if (spellcheckRequestRef.current === requestId) {
        setSpellcheckEnabled(lastPersistedSpellcheckRef.current)
        setStorageMessage(getStorageError(error).message)
      }
    }
  }

  async function chooseVault() {
    setSelectingVault(true)
    setStorageMessage(null)
    try {
      const didSelect = await selectVault(vaultName)
      if (didSelect) {
        clearEditorViewState()
        setVaultReady(true)
        collectionChanged()
        setVaultName('')
      }
    } catch (error) {
      setStorageMessage(getStorageError(error).message)
    } finally {
      setSelectingVault(false)
    }
  }

  return (
    <NoteWorkspace.Provider
      adapter={tauriNoteWorkspace}
      externalMessage={storageMessage}
      onCollectionChange={collectionChanged}
      onSpellcheckEnabledChange={(enabled) => void updateSpellcheck(enabled)}
      refreshVault={refreshVault}
      spellcheckEnabled={spellcheckEnabled}
    >
      <Application
        chooseVault={chooseVault}
        collectionRevision={collectionRevision}
        selectingVault={selectingVault}
        setStorageMessage={setStorageMessage}
        setVaultName={setVaultName}
        storageMessage={storageMessage}
        vaultName={vaultName}
        vaultReady={vaultReady}
      />
    </NoteWorkspace.Provider>
  )
}

export default App
