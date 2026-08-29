import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { EditorView } from '@codemirror/view'
import { clearEditorViewState } from './editorViewState'
import {
  createMarkdownEditorSession,
  type MarkdownEditorSession,
  type MarkdownEditorSessionInput,
} from './session'

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
})

const sessions: MarkdownEditorSession[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.destroy()
  clearEditorViewState()
  document.body.replaceChildren()
})

function input(
  value: string,
  editorSessionId = 1,
  overrides: Partial<MarkdownEditorSessionInput> = {},
): MarkdownEditorSessionInput {
  return {
    editorSessionId,
    noteKey: `note-${editorSessionId}.md`,
    value,
    onChange: () => {},
    onPreviewCandidateEnter: () => {},
    onPreviewCandidateLeave: () => {},
    onPreviewDismiss: () => {},
    onWikiLinkActivate: () => {},
    resolveWikiLink: async () => null,
    spellcheckEnabled: true,
    suggestWikiLinks: async () => [],
    ...overrides,
  }
}

function createSession(initialInput: MarkdownEditorSessionInput) {
  const scrollContainer = document.createElement('div')
  scrollContainer.className = 'app-scroll-container'
  const host = document.createElement('div')
  scrollContainer.append(host)
  document.body.append(scrollContainer)
  const session = createMarkdownEditorSession(host, initialInput)
  sessions.push(session)
  const content = host.querySelector<HTMLElement>('.cm-content')
  if (!content) throw new Error('CodeMirror content was not mounted')
  return {
    content,
    host,
    scrollContainer,
    session,
    view: EditorView.findFromDOM(content),
  }
}

function pressUndo(content: HTMLElement) {
  content.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'z',
    ctrlKey: true,
  }))
}

describe('MarkdownEditorSession interface', () => {
  test('synchronizes callbacks and dynamic editor configuration', () => {
    const firstChanges: string[] = []
    const secondChanges: string[] = []
    const initialInput = input('a', 1, {
      onChange: (value) => firstChanges.push(value),
    })
    const { content, session, view } = createSession(initialInput)

    view.dispatch({ changes: { from: 1, insert: 'b' }, userEvent: 'input' })
    expect(firstChanges).toEqual(['ab'])

    session.update({
      ...initialInput,
      value: 'ab',
      onChange: (value) => secondChanges.push(value),
      spellcheckEnabled: false,
    })
    view.dispatch({ changes: { from: 2, insert: 'c' }, userEvent: 'input' })

    expect(firstChanges).toEqual(['ab'])
    expect(secondChanges).toEqual(['abc'])
    expect(content.getAttribute('spellcheck')).toBe('false')
  })

  test('isolates history when the document session changes', () => {
    const initialInput = input('note A')
    const { content, session, view } = createSession(initialInput)
    view.dispatch({ changes: { from: 6, insert: ' edit' }, userEvent: 'input' })

    session.update(input('note B', 2))
    pressUndo(content)

    expect(content.textContent).toBe('note B')
  })

  test('destroys its CodeMirror view and listeners idempotently', () => {
    const { host, session } = createSession(input('words'))

    session.destroy()
    session.destroy()

    expect(host.querySelector('.cm-editor')).toBeNull()
  })
})
