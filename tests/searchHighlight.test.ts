import { describe, expect, test } from 'bun:test'
import { segmentSearchMatches } from '../src/searchHighlight'

describe('segmentSearchMatches', () => {
  test('matches search terms without changing their case', () => {
    expect(segmentSearchMatches('Quiet WATER purification', 'water quiet')).toEqual([
      { kind: 'match', text: 'Quiet' },
      { kind: 'text', text: ' ' },
      { kind: 'match', text: 'WATER' },
      { kind: 'text', text: ' purification' },
    ])
  })

  test('prefers the complete phrase over its individual terms', () => {
    expect(segmentSearchMatches('A distinctive phrase nearby', 'distinctive phrase')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'match', text: 'distinctive phrase' },
      { kind: 'text', text: ' nearby' },
    ])
  })

  test('treats regular expression characters as literal text', () => {
    expect(segmentSearchMatches('Notes about C++ and quoted "text"', 'C++')).toEqual([
      { kind: 'text', text: 'Notes about ' },
      { kind: 'match', text: 'C++' },
      { kind: 'text', text: ' and quoted "text"' },
    ])
  })

  test('highlights a short exact-title query', () => {
    expect(segmentSearchMatches('Go', 'go')).toEqual([
      { kind: 'match', text: 'Go' },
    ])
  })

  test('ignores Arabic harakat and keeps them in the highlighted text', () => {
    expect(segmentSearchMatches('عن التَّأملُ والإِصدار 6', 'التأمل الإصدار')).toEqual([
      { kind: 'text', text: 'عن ' },
      { kind: 'match', text: 'التَّأملُ' },
      { kind: 'text', text: ' و' },
      { kind: 'match', text: 'الإِصدار' },
      { kind: 'text', text: ' 6' },
    ])
    expect(segmentSearchMatches('ن\u08D3ص\u{10EFC}', 'نص')).toEqual([
      { kind: 'match', text: 'ن\u08D3ص\u{10EFC}' },
    ])
  })
})
