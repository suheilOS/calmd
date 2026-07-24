export type SearchTextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'match'; text: string }

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function segmentSearchMatches(text: string, query: string): SearchTextSegment[] {
  const canonicalQuery = query.trim().replace(/\s+/gu, ' ')
  if (!text || !canonicalQuery) return [{ kind: 'text', text }]

  const candidates = [
    canonicalQuery,
    ...canonicalQuery.split(' ').filter((candidate) => [...candidate].length >= 3),
  ]
  const uniqueCandidates = [...new Map(
    candidates.map((candidate) => [candidate.toLocaleLowerCase(), candidate]),
  ).values()]
    .sort((left, right) => right.length - left.length)

  if (uniqueCandidates.length === 0) return [{ kind: 'text', text }]

  const matcher = new RegExp(
    `(${uniqueCandidates.map(escapeRegularExpression).join('|')})`,
    'giu',
  )
  const segments: SearchTextSegment[] = []
  let start = 0

  for (const match of text.matchAll(matcher)) {
    const index = match.index
    if (index > start) segments.push({ kind: 'text', text: text.slice(start, index) })
    segments.push({ kind: 'match', text: match[0] })
    start = index + match[0].length
  }

  if (start < text.length) segments.push({ kind: 'text', text: text.slice(start) })
  return segments.length > 0 ? segments : [{ kind: 'text', text }]
}
