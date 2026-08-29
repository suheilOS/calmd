export type SearchTextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'match'; text: string }

const IGNORED_ARABIC_MARK_RANGES = [
  [0x0610, 0x061a],
  [0x0640, 0x0640],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0897, 0x089f],
  [0x08ca, 0x08e1],
  [0x08e3, 0x08ff],
  [0x10efa, 0x10eff],
] satisfies ReadonlyArray<readonly [number, number]>

function isIgnoredArabicMark(character: string) {
  const codePoint = character.codePointAt(0)
  return codePoint !== undefined && IGNORED_ARABIC_MARK_RANGES.some(
    ([first, last]) => codePoint >= first && codePoint <= last,
  )
}

type FoldedText = {
  text: string
  sourceRanges: Array<{ from: number; to: number }>
}

function foldCharacter(character: string) {
  return isIgnoredArabicMark(character) ? '' : character.toLowerCase()
}

function foldLiteralSearch(value: string) {
  return [...value].map(foldCharacter).join('')
}

function foldWithSourceOffsets(value: string): FoldedText {
  let text = ''
  const sourceRanges: FoldedText['sourceRanges'] = []
  let sourceStart = 0
  for (const character of value) {
    const sourceEnd = sourceStart + character.length
    const foldedCharacter = foldCharacter(character)
    text += foldedCharacter
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      sourceRanges.push({ from: sourceStart, to: sourceEnd })
    }
    sourceStart = sourceEnd
  }
  return { text, sourceRanges }
}

export function segmentSearchMatches(text: string, query: string): SearchTextSegment[] {
  const canonicalQuery = query.trim().replace(/\s+/gu, ' ')
  if (!text || !canonicalQuery) return [{ kind: 'text', text }]

  const candidates = [
    canonicalQuery,
    ...canonicalQuery.split(' ').filter((candidate) => [...candidate].length >= 3),
  ]
  const uniqueCandidates = [...new Set(candidates.map(foldLiteralSearch))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)

  if (uniqueCandidates.length === 0) return [{ kind: 'text', text }]

  const folded = foldWithSourceOffsets(text)
  const occurrences: Array<{ from: number; to: number }> = []
  for (const candidate of uniqueCandidates) {
    let foldedStart = 0
    while (foldedStart <= folded.text.length - candidate.length) {
      const matchStart = folded.text.indexOf(candidate, foldedStart)
      if (matchStart < 0) break
      const matchEnd = matchStart + candidate.length
      const from = folded.sourceRanges[matchStart]?.from
      let to = folded.sourceRanges[matchEnd - 1]?.to
      if (from !== undefined && to !== undefined) {
        while (to < text.length) {
          const trailing = text.slice(to)[Symbol.iterator]().next().value
          if (trailing === undefined || !isIgnoredArabicMark(trailing)) break
          to += trailing.length
        }
        occurrences.push({ from, to })
      }
      foldedStart = matchStart + Math.max(candidate.length, 1)
    }
  }
  occurrences.sort((left, right) => left.from - right.from || right.to - left.to)

  const matches: Array<{ from: number; to: number }> = []
  for (const candidate of occurrences) {
    if (!matches.some((accepted) =>
      accepted.from < candidate.to && candidate.from < accepted.to,
    )) {
      matches.push(candidate)
    }
  }
  const segments: SearchTextSegment[] = []
  let start = 0

  for (const match of matches) {
    if (match.from > start) segments.push({ kind: 'text', text: text.slice(start, match.from) })
    segments.push({ kind: 'match', text: text.slice(match.from, match.to) })
    start = match.to
  }

  if (start < text.length) segments.push({ kind: 'text', text: text.slice(start) })
  return segments.length > 0 ? segments : [{ kind: 'text', text }]
}
