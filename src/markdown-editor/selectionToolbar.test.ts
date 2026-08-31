import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { FormattingToolbarSnapshot } from './contracts'
import { selectionToolbar, selectionToolbarSnapshot } from './selectionToolbar'

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
})

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function viewWithSelection(anchor: number, head = anchor) {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView({
    doc: 'select these words',
    extensions: [markdown()],
    parent: host,
    selection: EditorSelection.range(anchor, head),
  })
  views.push(view)
  Object.defineProperty(view, 'coordsAtPos', {
    value: () => ({ bottom: 30, left: 10, right: 10, top: 10 }),
  })
  return view
}

describe('selectionToolbarSnapshot', () => {
  test('anchors and describes a non-empty editor selection', () => {
    const snapshot = selectionToolbarSnapshot(viewWithSelection(0, 6))

    expect(snapshot?.selectionRevision).toBe(0)
    expect(snapshot?.anchor).toEqual({ height: 20, width: 0, x: 10, y: 10 })
    expect(snapshot?.formats.bold).toBe('inactive')
    expect(snapshot?.blockKind).toBe('paragraph')
  })

  test('describes a collapsed caret only when explicitly requested', () => {
    const view = viewWithSelection(6)

    expect(selectionToolbarSnapshot(view)).toBeNull()
    expect(selectionToolbarSnapshot(view, 0, 'caret')).toMatchObject({
      anchor: { height: 20, width: 0, x: 10, y: 10 },
      blockKind: 'paragraph',
    })
  })

  test('requests a caret toolbar from Alt+F10 without showing it automatically', () => {
    let requested: FormattingToolbarSnapshot | null = null
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      doc: 'place caret here',
      extensions: [
        markdown(),
        selectionToolbar({
          onChange: () => {},
          onFocusRequest: (snapshot) => {
            requested = snapshot
          },
        }),
      ],
      parent: host,
      selection: EditorSelection.cursor(6),
    })
    views.push(view)
    Object.defineProperty(view, 'coordsAtPos', {
      value: () => ({ bottom: 30, left: 10, right: 10, top: 10 }),
    })

    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      altKey: true,
      bubbles: true,
      cancelable: true,
      key: 'F10',
    }))

    expect(requested).toMatchObject({
      anchor: { height: 20, width: 0, x: 10, y: 10 },
      blockKind: 'paragraph',
    })
  })

  test('reuses semantic analysis for geometry-only updates', async () => {
    const snapshots: FormattingToolbarSnapshot[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({
      doc: 'select these words',
      extensions: [
        markdown(),
        selectionToolbar({
          onChange: (snapshot) => {
            if (snapshot) snapshots.push(snapshot)
          },
          onFocusRequest: () => {},
        }),
      ],
      parent: host,
      selection: EditorSelection.range(0, 6),
    })
    views.push(view)
    Object.defineProperty(view, 'coordsAtPos', {
      value: () => ({ bottom: 30, left: 10, right: 10, top: 10 }),
    })

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    const selectionSnapshot = snapshots.at(-1)
    expect(selectionSnapshot).toBeDefined()

    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    const scrollSnapshot = snapshots.at(-1)

    expect(scrollSnapshot).not.toBe(selectionSnapshot)
    expect(scrollSnapshot?.formats).toBe(selectionSnapshot?.formats)
    expect(scrollSnapshot?.selectionRevision).toBe(selectionSnapshot?.selectionRevision)
  })
})
