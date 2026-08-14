import type { EditorSelection } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { ImportedAttachment } from '../images'
import { markdownImage } from '../markdownImages'

type PendingInsertion = {
  ranges: { from: number; to: number }[]
}

class ImageInsertionTracker {
  private active = true
  private readonly pending = new Set<PendingInsertion>()
  private readonly view: EditorView

  constructor(view: EditorView) {
    this.view = view
  }

  update(update: ViewUpdate) {
    if (!update.docChanged) return
    for (const insertion of this.pending) {
      insertion.ranges = insertion.ranges.map((range) => {
        const from = update.changes.mapPos(range.from, 1)
        const to = update.changes.mapPos(range.to, -1)
        return { from, to: Math.max(from, to) }
      })
    }
  }

  destroy() {
    this.active = false
    this.pending.clear()
  }

  insert(
    selection: EditorSelection,
    imported: Promise<ImportedAttachment | null>,
    onError: (error: unknown) => void,
  ) {
    const insertion: PendingInsertion = {
      ranges: selection.ranges.map(({ from, to }) => ({ from, to })),
    }
    this.pending.add(insertion)
    void imported.then(
      (attachment) => {
        if (!attachment || !this.active || !this.pending.delete(insertion)) return
        const alt = attachment.relativePath.split('/').at(-1)?.replace(/\.[^.]+$/u, '') ?? ''
        const markdown = markdownImage(attachment.relativePath, alt)
        this.view.dispatch({
          changes: insertion.ranges.map(({ from, to }) => ({ from, to, insert: markdown })),
          userEvent: 'input.paste',
        })
        this.view.focus()
      },
      (error) => {
        this.pending.delete(insertion)
        if (this.active) onError(error)
      },
    )
  }
}

const insertionTracker = ViewPlugin.fromClass(ImageInsertionTracker)

export const trackedImageInsertion = insertionTracker

export function imagePaste(
  importFile: (file: File) => Promise<ImportedAttachment>,
  readClipboardImage: () => Promise<File>,
  onError: (error: unknown) => void,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const clipboardData = event.clipboardData
      const item = Array.from(clipboardData?.items ?? [])
        .find((candidate) => candidate.kind === 'file' && candidate.type.startsWith('image/'))
      const hasImageType = Array.from(clipboardData?.types ?? [])
        .some((type) => type.startsWith('image/'))
      const hasText = Boolean(
        clipboardData?.getData('text/plain') || clipboardData?.getData('text/uri-list'),
      )
      if (!item && !hasImageType && hasText) return false
      event.preventDefault()
      const file = item?.getAsFile()
      const imported = file
        ? importFile(file)
        : readClipboardImage().then(importFile)
      insertImportedImage(view, imported, onError)
      return true
    },
  })
}

export function insertImportedImage(
  view: EditorView,
  imported: Promise<ImportedAttachment | null>,
  onError: (error: unknown) => void,
) {
  view.plugin(insertionTracker)?.insert(view.state.selection, imported, onError)
}
