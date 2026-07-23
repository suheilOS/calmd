import { describe, expect, test } from 'bun:test'
import { canonicalWikiLink, parseWikiLinkText } from '../src/wikiLinks'

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
})
