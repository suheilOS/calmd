import { describe, expect, test } from 'bun:test'
import {
  canonicalResolvedWikiLink,
  canonicalWikiLink,
  parseWikiLinkText,
} from '../src/wikiLinks'

describe('wiki-link contract', () => {
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
})
