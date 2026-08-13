import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { isPrimaryNavigationClick, navigationPlatform } from './navigation'

function externalUrlNode(node: SyntaxNode) {
  if (node.name === 'URL') return node
  if (node.name === 'Link' || node.name === 'Autolink') return node.getChild('URL')
  return null
}

/** Returns the external URL represented by the syntax at an editor position. */
export function externalUrlAt(state: EditorState, position: number) {
  for (const side of [1, -1] as const) {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, side)
    while (node) {
      const destination = externalUrlNode(node)
      if (destination) return state.sliceDoc(destination.from, destination.to)
      node = node.parent
    }
  }
  return null
}

/** Returns a normalized absolute HTTP(S) URL, or null for unsupported URLs. */
export function supportedExternalUrl(destination: string) {
  try {
    const url = new URL(destination)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

export function activateExternalLink(
  state: EditorState,
  position: number,
  event: MouseEvent,
  onPreviewDismiss: () => void,
  openExternalUrl: (url: string) => Promise<void>,
) {
  if (!isPrimaryNavigationClick(navigationPlatform(), event)) return false
  const destination = externalUrlAt(state, position)
  if (!destination) return false
  const href = supportedExternalUrl(destination)
  if (!href) return false

  event.preventDefault()
  onPreviewDismiss()
  void openExternalUrl(href).catch(() => {})
  return true
}
