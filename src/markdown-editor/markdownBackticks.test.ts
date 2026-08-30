import { describe, expect, test } from 'bun:test'
import { backtickInsertionAt } from './markdownBackticks'

describe('Markdown backtick pairing', () => {
  test('builds a paired fence from three backticks on a blank line', () => {
    expect(backtickInsertionAt('', 0)).toBe('literal')
    expect(backtickInsertionAt('`', 1)).toBe('literal')
    expect(backtickInsertionAt('``', 2)).toBe('fence')
    expect(backtickInsertionAt('  ``', 4)).toBe('fence')
  })

  test('leaves inline code to CodeMirror standard pairing', () => {
    expect(backtickInsertionAt('some text', 4)).toBe('default')
    expect(backtickInsertionAt('some text', 9)).toBe('default')
    expect(backtickInsertionAt('word', 0)).toBe('default')
  })

  test('does not pair a fence between or next to letters', () => {
    expect(backtickInsertionAt('word', 2)).toBe('default')
    expect(backtickInsertionAt('a``b', 3)).toBe('default')
    expect(backtickInsertionAt('``word', 2)).toBe('default')
  })

  test('does not turn an indented code block into a fence', () => {
    expect(backtickInsertionAt('    ``', 6)).toBe('default')
    expect(backtickInsertionAt('\t``', 3)).toBe('default')
  })
})
