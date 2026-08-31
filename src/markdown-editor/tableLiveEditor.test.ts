import { describe, expect, test } from 'bun:test'
import {
  parseMarkdownTable,
  serializeMarkdownTable,
  type MarkdownTable,
} from './tableLiveEditor'

describe('Markdown table model', () => {
  test('preserves blank cells, uneven rows, and alignment', () => {
    expect(parseMarkdownTable([
      '| Name | Value | Extra |',
      '| :--- | :---: | ---: |',
      '|  | Notes |',
      '| Calm |  |  |',
    ].join('\n'))).toEqual({
      header: ['Name', 'Value', 'Extra'],
      alignments: ['left', 'center', 'right'],
      rows: [
        ['', 'Notes', ''],
        ['Calm', '', ''],
      ],
    })
  })

  test('does not split escaped pipes', () => {
    expect(parseMarkdownTable(
      '| Name | Value |\n| --- | --- |\n| A \\| B | `x` |',
    )?.rows).toEqual([['A \\| B', '`x`']])
  })

  test('serializes canonical GFM and escapes new cell pipes', () => {
    const table: MarkdownTable = {
      header: ['Name', 'Value'],
      alignments: ['default', 'right'],
      rows: [['A | B', 'فقرة عربية']],
    }

    expect(serializeMarkdownTable(table)).toBe([
      '| Name | Value |',
      '| --- | ---: |',
      '| A \\| B | فقرة عربية |',
    ].join('\n'))
  })

  test('rejects a malformed delimiter row', () => {
    expect(parseMarkdownTable('| A | B |\n| nope | --- |')).toBeNull()
  })

  test('is stable after canonical serialization', () => {
    const parsed = parseMarkdownTable('A | B\n--- | :---:\none | two')
    if (!parsed) throw new Error('Table did not parse')

    expect(parseMarkdownTable(serializeMarkdownTable(parsed))).toEqual(parsed)
  })
})
