import { beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  insertImportedImage,
  trackedImageInsertion,
} from '../src/imageInsertion'
import type { ImportedAttachment } from '../src/images'

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

function editor(doc: string, selection = EditorSelection.cursor(doc.length)) {
  return new EditorView({
    doc,
    selection,
    extensions: [EditorState.allowMultipleSelections.of(true), trackedImageInsertion],
    parent: document.body.appendChild(document.createElement('div')),
  })
}

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
