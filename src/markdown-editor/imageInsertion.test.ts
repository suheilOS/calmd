import { beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  imagePaste,
  insertImportedImage,
  trackedImageInsertion,
} from './imageInsertion'
import type { ImportedAttachment } from '../images'

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
})

const imported: ImportedAttachment = {
  height: 20,
  mime: 'image/png',
  relativePath: 'attachments/photo one.png',
  revision: 'abc',
  width: 30,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

function editor(
  doc: string,
  selection = EditorSelection.cursor(doc.length),
  extensions: Parameters<typeof EditorState.create>[0]['extensions'] = [],
) {
  return new EditorView({
    doc,
    selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      trackedImageInsertion,
      extensions,
    ],
    parent: document.body.appendChild(document.createElement('div')),
  })
}

function pasteEvent({
  items = [],
  text = '',
  types = [],
}: {
  items?: Pick<DataTransferItem, 'getAsFile' | 'kind' | 'type'>[]
  text?: string
  types?: string[]
}) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => type === 'text/plain' ? text : '',
      items,
      types,
    },
  })
  return event
}

describe('image paste handling', () => {
  test('uses the native clipboard fallback when Wayland exposes only an image MIME type', async () => {
    let clipboardReads = 0
    const view = editor('', undefined, imagePaste(
      async () => imported,
      async () => {
        clipboardReads += 1
        return new File(['image'], 'clipboard.png', { type: 'image/png' })
      },
      () => {},
    ))

    const event = pasteEvent({ types: ['image/png'] })
    view.contentDOM.dispatchEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(clipboardReads).toBe(1)
    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe(
      '![photo one](<attachments/photo one.png>)',
    )
    view.destroy()
  })

  test('leaves ordinary text paste to CodeMirror', async () => {
    let clipboardReads = 0
    const view = editor('', undefined, imagePaste(
      async () => imported,
      async () => {
        clipboardReads += 1
        return new File(['image'], 'clipboard.png', { type: 'image/png' })
      },
      () => {},
    ))

    const event = pasteEvent({ text: 'pasted text', types: ['text/plain'] })
    view.contentDOM.dispatchEvent(event)
    await Promise.resolve()

    expect(clipboardReads).toBe(0)
    expect(view.state.doc.toString()).toBe('pasted text')
    view.destroy()
  })

  test('imports an image file exposed by the browser paste event', async () => {
    let importedFile: File | null = null
    let clipboardReads = 0
    const file = new File(['image'], 'browser.png', { type: 'image/png' })
    const view = editor('', undefined, imagePaste(
      async (candidate) => {
        importedFile = candidate
        return imported
      },
      async () => {
        clipboardReads += 1
        return file
      },
      () => {},
    ))

    const event = pasteEvent({
      items: [{ getAsFile: () => file, kind: 'file', type: 'image/png' }],
      types: ['image/png'],
    })
    view.contentDOM.dispatchEvent(event)
    await Promise.resolve()
    await Promise.resolve()

    expect(importedFile).toBe(file)
    expect(clipboardReads).toBe(0)
    expect(view.state.doc.toString()).toBe(
      '![photo one](<attachments/photo one.png>)',
    )
    view.destroy()
  })
})

describe('asynchronous image insertion', () => {
  test('maps the captured selection through intervening edits', async () => {
    const view = editor('before after', EditorSelection.range(7, 12))
    const pending = deferred<ImportedAttachment | null>()
    insertImportedImage(view, pending.promise, () => {})
    view.dispatch({ changes: { from: 0, insert: 'new ' } })

    pending.resolve(imported)
    await pending.promise
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe(
      'new before ![photo one](<attachments/photo one.png>)',
    )
    view.destroy()
  })

  test('keeps a captured cursor valid when text is inserted at that position', async () => {
    const view = editor('after', EditorSelection.cursor(0))
    const pending = deferred<ImportedAttachment | null>()
    insertImportedImage(view, pending.promise, () => {})
    view.dispatch({ changes: { from: 0, insert: 'typed ' } })

    pending.resolve(imported)
    await pending.promise
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe(
      'typed ![photo one](<attachments/photo one.png>)after',
    )
    view.destroy()
  })

  test('abandons completion after the editor session is destroyed', async () => {
    const view = editor('unchanged')
    const pending = deferred<ImportedAttachment | null>()
    insertImportedImage(view, pending.promise, () => {})
    view.destroy()

    pending.resolve(imported)
    await pending.promise
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe('unchanged')
  })

  test('inserts at every captured selection in one transaction', async () => {
    const selection = EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(3),
    ])
    const view = editor('one', selection)
    insertImportedImage(view, Promise.resolve(imported), () => {})
    await Promise.resolve()
    await Promise.resolve()

    expect(view.state.doc.toString()).toBe(
      '![photo one](<attachments/photo one.png>)one![photo one](<attachments/photo one.png>)',
    )
    view.destroy()
  })
})
