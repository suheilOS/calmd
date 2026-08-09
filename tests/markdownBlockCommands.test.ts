import { describe, expect, test } from 'bun:test'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  setMarkdownBlock,
  type MarkdownBlockKind,
} from '../src/markdownBlockCommands'

function apply(text: string, kind: MarkdownBlockKind, from = 0, to = text.length) {
  let state = EditorState.create({
    doc: text,
    selection: EditorSelection.range(from, to),
  })
  const changed = setMarkdownBlock(kind)({
    state,
    dispatch: (transaction) => { state = transaction.state },
  })
  return { changed, text: state.doc.toString() }
}

describe('setMarkdownBlock', () => {
  test('changes every selected line with one structural command', () => {
    expect(apply('one\ntwo', 'bullet')).toEqual({
      changed: true,
      text: '- one\n- two',
    })
  })

  test('replaces an existing structural prefix instead of nesting it', () => {
    expect(apply('> quoted', 'heading-2')).toEqual({
      changed: true,
      text: '## quoted',
    })
  })

  test('paragraph removes list and task prefixes while preserving indentation', () => {
    expect(apply('  - [x] complete', 'paragraph')).toEqual({
      changed: true,
      text: '  complete',
    })
  })

  test('starts numbering independently for disjoint selections', () => {
    let state = EditorState.create({
      doc: 'one\nskip\nthree',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(9),
      ]),
    })

    setMarkdownBlock('ordered')({
      state,
      dispatch: (transaction) => { state = transaction.state },
    })

    expect(state.doc.toString()).toBe('1. one\nskip\n1. three')
  })

  test('preserves the caret inside line content', () => {
    let state = EditorState.create({
      doc: 'hello world',
      selection: EditorSelection.cursor(6),
    })

    setMarkdownBlock('heading-2')({
      state,
      dispatch: (transaction) => { state = transaction.state },
    })

    expect(state.doc.toString()).toBe('## hello world')
    expect(state.selection.main.anchor).toBe(9)
  })

  test('numbers nested list levels independently', () => {
    const source = '- parent\n  - child\n  - sibling\n- next'
    const result = apply(source, 'ordered')

    expect(result.text).toBe('1. parent\n  1. child\n  2. sibling\n2. next')
  })
})
