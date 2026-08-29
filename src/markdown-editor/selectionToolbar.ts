import type { EditorSelection } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { FormattingToolbarSnapshot } from './contracts'
import { selectedMarkdownBlockKind } from './markdownBlockCommands'
import { markdownFormatStates } from './markdownCommands'

type SelectionToolbarCallbacks = {
  onChange: (snapshot: FormattingToolbarSnapshot | null) => void
  onFocusRequest: () => void
}

function selectedRange(selection: EditorSelection) {
  if (!selection.main.empty) return selection.main
  return selection.ranges.find((range) => !range.empty) ?? null
}

type FormattingToolbarSemantics = Omit<FormattingToolbarSnapshot, 'anchor'>

export function selectionToolbarSemantics(
  view: EditorView,
  selectionRevision: number,
): FormattingToolbarSemantics | null {
  if (!selectedRange(view.state.selection)) return null
  return {
    blockKind: selectedMarkdownBlockKind(view.state),
    formats: markdownFormatStates(view.state),
    selectionRevision,
  }
}

function selectionToolbarAnchor(
  view: EditorView,
) {
  const range = selectedRange(view.state.selection)
  if (!range) return null

  const pointsBackward = range.head < range.anchor
  const coordinates = view.coordsAtPos(range.head, pointsBackward ? 1 : -1)
  if (!coordinates) return null
  const x = pointsBackward ? coordinates.left : coordinates.right

  return {
    height: coordinates.bottom - coordinates.top,
    width: 0,
    x,
    y: coordinates.top,
  }
}

export function selectionToolbarSnapshot(
  view: EditorView,
  selectionRevision = 0,
): FormattingToolbarSnapshot | null {
  const semantics = selectionToolbarSemantics(view, selectionRevision)
  const anchor = selectionToolbarAnchor(view)
  return semantics && anchor ? { ...semantics, anchor } : null
}

/** Tracks completed body selections and their viewport anchor for the React toolbar. */
export function selectionToolbar({ onChange, onFocusRequest }: SelectionToolbarCallbacks) {
  const plugin = ViewPlugin.fromClass(class {
    private dragging = false
    private measurePending = false
    private readonly ownerWindow: Window
    private readonly view: EditorView
    private selectionRevision = 0
    private semantics: FormattingToolbarSemantics | null

    constructor(view: EditorView) {
      this.view = view
      this.ownerWindow = view.dom.ownerDocument.defaultView ?? window
      this.semantics = selectionToolbarSemantics(view, this.selectionRevision)
      view.dom.addEventListener('pointerdown', this.startDrag)
      this.ownerWindow.addEventListener('pointerup', this.finishDrag)
      this.ownerWindow.addEventListener('pointercancel', this.finishDrag)
      this.ownerWindow.addEventListener('resize', this.requestPublish)
      this.ownerWindow.addEventListener('scroll', this.requestPublish, {
        capture: true,
        passive: true,
      })
      this.requestPublish()
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.selectionRevision += 1
        if (!this.dragging) {
          this.semantics = selectionToolbarSemantics(this.view, this.selectionRevision)
        }
      }
      if (
        !this.dragging
        && (
          update.docChanged
          || update.selectionSet
          || update.viewportChanged
          || update.geometryChanged
        )
      ) {
        this.requestPublish()
      }
    }

    destroy() {
      this.view.dom.removeEventListener('pointerdown', this.startDrag)
      this.ownerWindow.removeEventListener('pointerup', this.finishDrag)
      this.ownerWindow.removeEventListener('pointercancel', this.finishDrag)
      this.ownerWindow.removeEventListener('resize', this.requestPublish)
      this.ownerWindow.removeEventListener('scroll', this.requestPublish, true)
    }

    private readonly startDrag = (event: PointerEvent) => {
      if (event.button !== 0) return
      this.dragging = true
      onChange(null)
    }

    private readonly finishDrag = () => {
      if (!this.dragging) return
      this.dragging = false
      this.semantics = selectionToolbarSemantics(this.view, this.selectionRevision)
      this.requestPublish()
    }

    private readonly requestPublish = () => {
      if (this.dragging || this.measurePending) return
      this.measurePending = true
      this.view.requestMeasure({
        read: () => {
          const anchor = selectionToolbarAnchor(this.view)
          return this.semantics && anchor ? { ...this.semantics, anchor } : null
        },
        write: (nextSnapshot) => {
          this.measurePending = false
          onChange(nextSnapshot)
        },
      })
    }
  })

  const focusKeymap = EditorView.domEventHandlers({
    keydown(event, view) {
      if (
        event.key !== 'F10'
        || !event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || !selectedRange(view.state.selection)
      ) return false

      event.preventDefault()
      onFocusRequest()
      return true
    },
  })

  return [plugin, focusKeymap]
}
