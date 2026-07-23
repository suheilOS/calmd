import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'bun:test'
import {
  canonicalResolvedWikiLink,
  canonicalWikiLink,
  parseWikiLinkText,
  validateWikiLinkOccurrence,
  wikiLinkHiddenSyntaxRanges,
  wikiLinkMarkdown,
} from '../src/wikiLinks'

function markdownState(doc: string) {
  return EditorState.create({
    doc,
    extensions: markdown({ extensions: [wikiLinkMarkdown] }),
  })
}

function wikiLinkSyntax(doc: string) {
  const state = markdownState(doc)
  let link: { from: number; to: number } | null = null
  const children: { name: string; from: number; to: number }[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'WikiLink') return
      link = { from: node.from, to: node.to }
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          children.push({ name: cursor.name, from: cursor.from, to: cursor.to })
        } while (cursor.nextSibling())
      }
    },
  })

  return { link, children }
}

function hiddenRanges(doc: string, selections: { from: number; to: number }[]) {
  const { link, children } = wikiLinkSyntax(doc)
  if (!link) throw new Error(`Expected a wiki link in ${doc}`)
  return wikiLinkHiddenSyntaxRanges(link, children, selections)
}

describe('wiki-link contract', () => {
  test('takes parser precedence for supported wiki links', () => {
    expect(wikiLinkSyntax('[[Target]]')).toEqual({
      link: { from: 0, to: 10 },
      children: [
        { name: 'WikiLinkMark', from: 0, to: 2 },
        { name: 'WikiLinkTarget', from: 2, to: 8 },
        { name: 'WikiLinkMark', from: 8, to: 10 },
      ],
    })
    expect(wikiLinkSyntax('[[Target.md|Visible]]').children).toEqual([
      { name: 'WikiLinkMark', from: 0, to: 2 },
      { name: 'WikiLinkTarget', from: 2, to: 11 },
      { name: 'WikiLinkDisplay', from: 11, to: 19 },
      { name: 'WikiLinkMark', from: 19, to: 21 },
    ])
    expect(wikiLinkSyntax('[[عنوان]]').link).toEqual({ from: 0, to: 9 })
  })

  test('hides delimiters for plain links and target syntax for aliases', () => {
    expect(hiddenRanges('[[Target]] x', [{ from: 11, to: 11 }])).toEqual([
      { from: 0, to: 2 },
      { from: 8, to: 10 },
    ])
    expect(hiddenRanges('[[Target|Display]] x', [{ from: 19, to: 19 }])).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 8 },
      { from: 8, to: 9 },
      { from: 16, to: 18 },
    ])
  })

  test('reveals complete source for cursors, overlaps, boundaries, and secondary selections', () => {
    const outside = { from: 12, to: 12 }
    for (const selection of [
      { from: 0, to: 0 },
      { from: 5, to: 5 },
      { from: 10, to: 10 },
      { from: 0, to: 4 },
      { from: 6, to: 12 },
      { from: 0, to: 10 },
    ]) {
      expect(hiddenRanges('[[Target]]', [selection])).toEqual([])
    }
    expect(hiddenRanges('[[Target]] extra', [outside, { from: 4, to: 4 }])).toEqual([])
  })

  test('does not parse malformed, embedded, unsupported, or code-contained syntax', () => {
    for (const doc of [
      '[[Target',
      '![[Target]]',
      '[[path/Target]]',
      '[[Target#Heading]]',
      '`[[Target]]`',
      '    [[Target]]',
      '```md\n[[Target]]\n```',
    ]) {
      expect(wikiLinkSyntax(doc).link).toBeNull()
    }
  })

  test('parses basic, aliased, Unicode, and optional extension targets', () => {
    expect(parseWikiLinkText('[[Target]]')).toEqual({ target: 'Target', display: undefined })
    expect(parseWikiLinkText('[[Target.md|Visible]]')).toEqual({ target: 'Target', display: 'Visible' })
    expect(parseWikiLinkText('[[عنوان.MD]]')).toEqual({ target: 'عنوان', display: undefined })
  })

  test('writes canonical links and removes redundant aliases', () => {
    expect(canonicalWikiLink('Target')).toBe('[[Target]]')
    expect(canonicalWikiLink('Target', 'Target')).toBe('[[Target]]')
    expect(canonicalWikiLink('Safe target', 'Visible title')).toBe('[[Safe target|Visible title]]')
  })

  test('preserves the resolved title when filename policy changes the stem', () => {
    expect(canonicalResolvedWikiLink('CON note', 'CON')).toBe('[[CON note|CON]]')
    expect(canonicalResolvedWikiLink('A-B- C-', 'A/B: C?')).toBe('[[A-B- C-|A/B: C?]]')
    expect(canonicalResolvedWikiLink('Target (2)', 'Target', 'Custom')).toBe('[[Target (2)|Custom]]')
  })

  test('rejects stale editor content after a canonical flush', () => {
    const state = markdownState('Self [[Old]]')
    expect(validateWikiLinkOccurrence(
      state,
      { from: 5, to: 12, target: 'Old' },
      'Self [[New]]',
    )).toBe(false)
  })

  test('requires the mapped range to remain parsed as a wiki link', () => {
    const state = markdownState('`[[Old]]`')
    expect(validateWikiLinkOccurrence(
      state,
      { from: 1, to: 8, target: 'Old' },
      '`[[Old]]`',
    )).toBe(false)
  })
})
