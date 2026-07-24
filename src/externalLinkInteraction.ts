import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { MouseClickModifiers } from './clickModifiers'
import {
  externalUrlFromText,
  isExternalLinkNavigationClick,
} from './externalLinks'

export type ExternalUrlOpener = (url: string) => Promise<void>
export type ExternalUrlOpenErrorHandler = (url: string, error: unknown) => void

type ExternalLinkMouseEvent = MouseClickModifiers & {
  target: EventTarget | null
  preventDefault: () => void
}

type ExternalLinkView = Pick<EditorView, 'posAtDOM' | 'state'>

export function externalUrlAtPosition(state: EditorState, position: number) {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1)
  while (node && node.name !== 'URL') node = node.parent
  return node ? externalUrlFromText(state.sliceDoc(node.from, node.to)) : null
}

export function handleExternalLinkMouseDown(
  view: ExternalLinkView,
  event: ExternalLinkMouseEvent,
  openUrl: ExternalUrlOpener,
  onError: ExternalUrlOpenErrorHandler,
) {
  if (!isExternalLinkNavigationClick(event)) return false

  const position = view.posAtDOM(event.target as Node)
  const url = externalUrlAtPosition(view.state, position)
  if (!url) return false

  event.preventDefault()
  void openUrl(url).catch((error: unknown) => onError(url, error))
  return true
}

export function externalLinkInteraction(
  openUrl: ExternalUrlOpener,
  onError: ExternalUrlOpenErrorHandler = (url, error) => {
    console.error(`Could not open external URL: ${url}`, error)
  },
) {
  return ViewPlugin.fromClass(class {
    activate(view: EditorView, event: MouseEvent) {
      return handleExternalLinkMouseDown(view, event, openUrl, onError)
    }
  }, {
    eventHandlers: {
      mousedown(event, view) { return this.activate(view, event) },
    },
  })
}
