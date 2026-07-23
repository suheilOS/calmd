import type { MarkdownConfig } from '@lezer/markdown'

export const wikiLinkMarkdown: MarkdownConfig = {
  defineNodes: ['WikiLink', 'WikiLinkMark', 'WikiLinkTarget', 'WikiLinkDisplay'],
  parseInline: [{
    name: 'WikiLink',
    parse(cx, next, pos) {
      if (next !== 91 || cx.char(pos + 1) !== 91 || (pos > 0 && cx.char(pos - 1) === 33)) return -1
      let end = pos + 2
      while (cx.char(end) >= 0 && !(cx.char(end) === 93 && cx.char(end + 1) === 93)) {
        if (cx.char(end) === 10 || cx.char(end) === 13) return -1
        end += 1
      }
      if (cx.char(end) < 0) return -1
      const inner = cx.slice(pos + 2, end)
      if (!inner || inner.includes('[[') || /[\\/#^]/u.test(inner)) return -1
      const separator = inner.indexOf('|')
      if (separator !== inner.lastIndexOf('|')) return -1
      const targetEnd = separator < 0 ? end : pos + 2 + separator
      const target = cx.slice(pos + 2, targetEnd).trim()
      const display = separator < 0 ? null : cx.slice(targetEnd + 1, end).trim()
      if (!target || display === '') return -1
      const children = [
        cx.elt('WikiLinkMark', pos, pos + 2),
        cx.elt('WikiLinkTarget', pos + 2, targetEnd),
      ]
      if (display !== null) children.push(cx.elt('WikiLinkDisplay', targetEnd, end))
      children.push(cx.elt('WikiLinkMark', end, end + 2))
      return cx.addElement(cx.elt('WikiLink', pos, end + 2, children))
    },
  }],
}

export function parseWikiLinkText(text: string) {
  if (!text.startsWith('[[') || !text.endsWith(']]')) return null
  const inner = text.slice(2, -2)
  if (!inner || inner.includes('[[') || inner.includes(']]') || /[\\/#^\r\n]/u.test(inner)) return null
  const parts = inner.split('|')
  if (parts.length > 2) return null
  const target = parts[0].trim().replace(/\.md$/iu, '')
  const display = parts[1]?.trim()
  return target && display !== '' ? { target, display } : null
}

export function canonicalWikiLink(target: string, display?: string) {
  return display && display !== target ? `[[${target}|${display}]]` : `[[${target}]]`
}

export function canonicalResolvedWikiLink(
  target: string,
  resolvedTitle: string,
  originalDisplay?: string,
) {
  const display = originalDisplay ?? (
    resolvedTitle === target ? undefined : resolvedTitle
  )
  return canonicalWikiLink(target, display)
}
