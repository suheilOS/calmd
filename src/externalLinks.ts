import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { isPrimaryNavigationClick, navigationPlatform } from './navigation'

const markdownEscapableCharacters = new Set(
  "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
)

const fallbackCharacterReferences: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
}

function decodeMarkdownEntities(destination: string) {
  if (!destination.includes('&')) return destination
  if (typeof document !== 'undefined') {
    const decoder = document.createElement('textarea')
    decoder.innerHTML = destination
    return decoder.value
  }
  return destination.replace(
    /&(?:#x[\da-f]+|#[\d]+|amp|apos|gt|lt|nbsp|quot);/giu,
    (reference) => {
      if (reference[1] === '#') {
        const value = reference[2].toLowerCase() === 'x'
          ? Number.parseInt(reference.slice(3, -1), 16)
          : Number.parseInt(reference.slice(2, -1), 10)
        return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
          ? String.fromCodePoint(value)
          : reference
      }
      return fallbackCharacterReferences[reference.slice(1, -1).toLowerCase()] ?? reference
    },
  )
}

function decodeMarkdownDestination(destination: string) {
  const unescaped = destination.replace(
    /\\(.)/g,
    (match, character: string) => markdownEscapableCharacters.has(character) ? character : match,
  )
  return decodeMarkdownEntities(unescaped)
}

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
    const url = new URL(decodeMarkdownDestination(destination))
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
  onOpenError: (error: unknown) => void = () => {},
) {
  if (!isPrimaryNavigationClick(navigationPlatform(), event)) return false
  const destination = externalUrlAt(state, position)
  if (!destination) return false
  const href = supportedExternalUrl(destination)
  if (!href) return false

  event.preventDefault()
  onPreviewDismiss()
  void openExternalUrl(href).catch(onOpenError)
  return true
}
