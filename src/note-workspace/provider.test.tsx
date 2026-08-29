import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { NoteWorkspaceAdapter } from './runtime'
import {
  type NoteWorkspaceContextValue,
  NoteWorkspaceProvider,
} from './provider'
import { useNoteWorkspace } from './context'

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

const roots: Root[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount()
  })
  document.body.replaceChildren()
})

function adapter(): NoteWorkspaceAdapter {
  return {
    create: async (title) => ({
      key: `${title}.md`,
      title,
      body: '',
      revision: 'one',
    }),
    createUntitled: async () => ({
      key: 'Untitled.md',
      title: 'Untitled',
      body: '',
      revision: 'one',
    }),
    delete: async () => {},
    errorMessage: String,
    openLink: async () => { throw new Error('not used') },
    openRandom: async () => null,
    read: async () => { throw new Error('not used') },
    rename: async (key, draft) => ({ ...draft, key, revision: 'two' }),
    resolveWikiLink: async () => true,
    save: async (key, draft) => ({ ...draft, key, revision: 'two' }),
    suggestWikiLinks: async () => [],
  }
}

async function renderProvider(
  capture: (workspace: NoteWorkspaceContextValue) => void,
  spellcheckEnabled = true,
) {
  function Probe() {
    const workspace = useNoteWorkspace()
    capture(workspace)
    return <span>{workspace.state.note?.draft.title ?? 'Composer'}</span>
  }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <NoteWorkspaceProvider
        adapter={adapter()}
        externalMessage={null}
        onCollectionChange={() => {}}
        onSpellcheckEnabledChange={() => {}}
        refreshVault={async () => {}}
        spellcheckEnabled={spellcheckEnabled}
      >
        <Probe />
      </NoteWorkspaceProvider>,
    )
  })
  return container
}

describe('NoteWorkspaceProvider', () => {
  test('publishes runtime state through the composed interface', async () => {
    let workspace!: NoteWorkspaceContextValue
    const container = await renderProvider((value) => { workspace = value })
    expect(container.textContent).toBe('Composer')

    await act(async () => {
      await workspace.actions.create('Provider Note')
    })

    expect(container.textContent).toBe('Provider Note')
    expect(workspace.state.note?.key).toBe('Provider Note.md')
  })

  test('injects editor preferences through meta', async () => {
    let workspace!: NoteWorkspaceContextValue
    await renderProvider((value) => { workspace = value }, false)

    expect(workspace.meta.spellcheckEnabled).toBe(false)
    expect(await workspace.meta.resolveWikiLink('Existing')).toBe(true)
  })

})
