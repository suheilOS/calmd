import type { Link, Parent, Root, Text } from 'mdast'
import { parseWikiLinkText } from './wikiLinks'

function wikiLinkNodes(value: string): Array<Text | Link> | null {
  const nodes: Array<Text | Link> = []
  let textStart = 0
  let searchFrom = 0

  while (searchFrom < value.length) {
    const linkStart = value.indexOf('[[', searchFrom)
    if (linkStart < 0) break
    const linkEnd = value.indexOf(']]', linkStart + 2)
    if (linkEnd < 0) break
    if (linkStart > 0 && value[linkStart - 1] === '!') {
      searchFrom = linkStart + 2
      continue
    }

    const source = value.slice(linkStart, linkEnd + 2)
    const parsed = parseWikiLinkText(source)
    if (!parsed) {
      searchFrom = linkStart + 2
      continue
    }

    if (linkStart > textStart) {
      nodes.push({ type: 'text', value: value.slice(textStart, linkStart) })
    }
    nodes.push({
      type: 'link',
      url: '',
      data: { hProperties: { dataWikiTarget: parsed.target } },
      children: [{ type: 'text', value: parsed.display ?? parsed.target }],
    })
    textStart = linkEnd + 2
    searchFrom = textStart
  }

  if (textStart === 0) return null
  if (textStart < value.length) nodes.push({ type: 'text', value: value.slice(textStart) })
  return nodes
}

function transformChildren(parent: Parent) {
  parent.children = parent.children.flatMap((child) => {
    if (child.type === 'text') return wikiLinkNodes(child.value) ?? child
    if ('children' in child && child.type !== 'link' && child.type !== 'linkReference') {
      transformChildren(child)
    }
    return child
  })
}

export function remarkPreviewWikiLinks() {
  return (tree: Root) => transformChildren(tree)
}
