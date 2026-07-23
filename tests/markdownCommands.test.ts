import { describe, expect, test } from 'bun:test'
import { history, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { markdownHighlight } from '../src/markdownHighlight'
import { toggleLink, toggleMarkdown } from '../src/markdownCommands'

function runCommand(
  doc: string,
  command: StateCommand,
  anchor = 0,
  head = doc.length,
) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ extensions: [GFM, markdownHighlight] })],
  })

  const handled = command({
    state,
    dispatch: (transaction) => {
      state = transaction.state
    },
  })

  return {
    doc: state.doc.toString(),
    handled,
    selection: state.selection.main,
  }
}

function runRanges(
  doc: string,
  command: StateCommand,
  ranges: Array<{ anchor: number; head: number }>,
) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(({ anchor, head }) => EditorSelection.range(anchor, head)),
    ),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ extensions: [GFM, markdownHighlight] }),
    ],
  })

  command({ state, dispatch: (transaction) => { state = transaction.state } })
  return { doc: state.doc.toString(), selection: state.selection }
}

describe('toggleMarkdown', () => {
  test('formats a paragraph while flattening existing spans of the same format', () => {
    const result = runCommand(
      'A thought with *one emphasized phrase* inside.',
      toggleMarkdown('*'),
    )

    expect(result.doc).toBe('*A thought with one emphasized phrase inside.*')
    expect(result.selection.from).toBe(1)
    expect(result.selection.to).toBe(result.doc.length - 1)
  })

  test.each([
    ['**', 'A **partly bold** paragraph.', '**A partly bold paragraph.**'],
    ['~~', 'A ~~partly struck~~ paragraph.', '~~A partly struck paragraph.~~'],
    ['==', 'A ==partly highlighted== paragraph.', '==A partly highlighted paragraph.=='],
  ] as const)('normalizes partial %s formatting across a paragraph', (delimiter, source, expected) => {
    expect(runCommand(source, toggleMarkdown(delimiter)).doc).toBe(expected)
  })

  test('removes formatting when the entire selection already has it', () => {
    const result = runCommand('*An emphasized thought.*', toggleMarkdown('*'))

    expect(result.doc).toBe('An emphasized thought.')
    expect(result.selection.from).toBe(0)
    expect(result.selection.to).toBe(result.doc.length)
  })

  test('formats each paragraph independently and normalizes mixed existing formatting', () => {
    const source = 'First has *one word* emphasized.\n\n*Second is already emphasized.*\n\nThird is plain.'
    const result = runCommand(source, toggleMarkdown('*'))

    expect(result.doc).toBe('*First has one word emphasized.*\n\n*Second is already emphasized.*\n\n*Third is plain.*')
  })

  test('removes formatting from every paragraph when all selected paragraphs have it', () => {
    const result = runCommand('*First paragraph.*\n\n*Second paragraph.*', toggleMarkdown('*'))

    expect(result.doc).toBe('First paragraph.\n\nSecond paragraph.')
  })

  test('removes formatting when all selected text is covered by separate target spans', () => {
    const result = runCommand('*one* *two*', toggleMarkdown('*'))

    expect(result.doc).toBe('one two')
  })

  test('removes formatting across a selection that starts and ends inside separate target spans', () => {
    const source = '*first* *second*'
    const result = runCommand(source, toggleMarkdown('*'), 1, source.length - 1)

    expect(result.doc).toBe('first second')
    expect(result.doc.slice(result.selection.from, result.selection.to)).toBe('first second')
  })

  test('keeps surrounding whitespace outside the delimiters', () => {
    const result = runCommand('  A whole paragraph.  ', toggleMarkdown('*'))

    expect(result.doc).toBe('  *A whole paragraph.*  ')
  })

  test('keeps Unicode non-breaking whitespace outside the delimiters', () => {
    const result = runCommand('\u00a0A thought.\u00a0', toggleMarkdown('*'))

    expect(result.doc).toBe('\u00a0*A thought.*\u00a0')
  })

  test('treats soft line breaks as one paragraph', () => {
    const result = runCommand('First line\nsecond line', toggleMarkdown('**'))

    expect(result.doc).toBe('**First line\nsecond line**')
  })

  test('preserves different nested formatting while flattening only the target format', () => {
    const result = runCommand('A **bold** word and *italic* word.', toggleMarkdown('*'))

    expect(result.doc).toBe('*A **bold** word and italic word.*')
  })

  test('preserves nested bold, link, and code syntax when removing an outer style', () => {
    const source = '*Text with **bold**, [a link](url), and `code`.*'
    const result = runCommand(source, toggleMarkdown('*'))

    expect(result.doc).toBe('Text with **bold**, [a link](url), and `code`.')
  })

  test('does not consume escaped literal delimiters', () => {
    const result = runCommand(String.raw`Use \*literal\* and *real emphasis*.`, toggleMarkdown('*'))

    expect(result.doc).toBe(String.raw`*Use \*literal\* and real emphasis.*`)
  })

  test('places the cursor between inserted delimiters for an empty selection', () => {
    const result = runCommand('Think', toggleMarkdown('**'), 5, 5)

    expect(result.doc).toBe('Think****')
    expect(result.selection.from).toBe(7)
    expect(result.selection.empty).toBe(true)
  })

  test('removes the containing format at a collapsed cursor', () => {
    const result = runCommand('A *small* thought.', toggleMarkdown('*'), 5, 5)

    expect(result.doc).toBe('A small thought.')
    expect(result.selection.from).toBe(4)
  })

  test('toggles off formatting when only the content inside adjacent delimiters is selected', () => {
    const result = runCommand('A *small* thought.', toggleMarkdown('*'), 3, 8)

    expect(result.doc).toBe('A small thought.')
    expect(result.selection.from).toBe(2)
    expect(result.selection.to).toBe(7)
  })

  test('removes formatting only from a partial selection inside a formatted span', () => {
    const result = runCommand('*one two three*', toggleMarkdown('*'), 5, 8)

    expect(result.doc).toBe('*one* two *three*')
    expect(result.doc.slice(result.selection.from, result.selection.to)).toBe('two')
  })

  test('formats inline content without consuming heading, quote, or list prefixes', () => {
    const result = runCommand('# Heading\n\n> Quote\n\n- Item', toggleMarkdown('*'))

    expect(result.doc).toBe('# *Heading*\n\n> *Quote*\n\n- *Item*')
  })

  test('preserves nested quote prefixes and setext heading underlines', () => {
    const source = '> > Nested quote\n\nSetext heading\n---'
    const result = runCommand(source, toggleMarkdown('**'))

    expect(result.doc).toBe('> > **Nested quote**\n\n**Setext heading**\n---')
  })

  test('leaves fenced code blocks untouched in a mixed block selection', () => {
    const result = runCommand('Paragraph\n\n```ts\nconst value = 1\n```', toggleMarkdown('**'))

    expect(result.doc).toBe('**Paragraph**\n\n```ts\nconst value = 1\n```')
  })

  test('leaves a fenced code block untouched when it is the entire selection', () => {
    const source = '```ts\nconst value = 1\n```'
    const result = runCommand(source, toggleMarkdown('**'))

    expect(result.doc).toBe(source)
  })

  test('does not apply prose formatting inside a URL or inline-code payload', () => {
    const link = 'Read [this](https://example.com)'
    const code = 'Use `const value = 1` here'
    const linked = runCommand(link, toggleMarkdown('*'), 12, 31)
    const coded = runCommand(code, toggleMarkdown('**'), 5, 20)

    expect(linked.doc).toBe(link)
    expect(coded.doc).toBe(code)
  })

  test('does not format a selection boundary that cuts through protected syntax', () => {
    const link = 'Read [this](https://example.com)'
    const code = 'Before `literal code` after'
    const linked = runCommand(link, toggleMarkdown('*'), 0, 18)
    const coded = runCommand(code, toggleMarkdown('**'), 0, 12)

    expect(linked.doc).toBe(link)
    expect(coded.doc).toBe(code)
  })

  test.each([
    ['# Heading', 1],
    ['- Item', 1],
  ])('does not insert formatting inside a structural prefix in %s', (source, cursor) => {
    expect(runCommand(source, toggleMarkdown('**'), cursor, cursor).doc).toBe(source)
  })

  test('formats table cells without consuming table delimiters', () => {
    const source = '| First | Second |\n| --- | --- |\n| Cell | Value |'
    const result = runCommand(source, toggleMarkdown('*'))

    expect(result.doc).toBe('| *First* | *Second* |\n| --- | --- |\n| *Cell* | *Value* |')
  })

  test('canonicalizes alternate markers when removing a fully formatted selection', () => {
    const italic = runCommand('_italic_', toggleMarkdown('*'))
    const bold = runCommand('__bold__', toggleMarkdown('**'))

    expect(italic.doc).toBe('italic')
    expect(bold.doc).toBe('bold')
  })

  test('uses a longer backtick fence when inline code contains backticks', () => {
    const result = runCommand('call `method` here', toggleMarkdown('`'))

    expect(result.doc).toBe('``call `method` here``')
  })

  test('adds and reverses protective padding for boundary backticks', () => {
    const applied = runCommand('`edge', toggleMarkdown('`'))
    const removed = runCommand(applied.doc, toggleMarkdown('`'))

    expect(applied.doc).toBe('`` `edge ``')
    expect(removed.doc).toBe('`edge')
  })

  test('creates separate inline-code spans across paragraph boundaries', () => {
    const result = runCommand('first line\n\nsecond line', toggleMarkdown('`'))

    expect(result.doc).toBe('`first line`\n\n`second line`')
  })

  test('applies formatting independently to multiple selections', () => {
    const result = runRanges('one and two', toggleMarkdown('**'), [
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
    ])

    expect(result.doc).toBe('**one** and **two**')
    expect(result.selection.ranges).toHaveLength(2)
  })

  test('handles multiple cursors inside the same formatted span without conflicting edits', () => {
    const result = runRanges('*one two*', toggleMarkdown('*'), [
      { anchor: 2, head: 2 },
      { anchor: 6, head: 6 },
    ])

    expect(result.doc).toBe('one two')
    expect(result.selection.ranges).toHaveLength(2)
  })

  test('applies a multi-block command as one undoable transaction', () => {
    const source = 'First\n\nSecond'
    let state = EditorState.create({
      doc: source,
      selection: EditorSelection.single(0, source.length),
      extensions: [history(), markdown({ extensions: [GFM, markdownHighlight] })],
    })
    const dispatch = (transaction: Transaction) => {
      state = transaction.state
    }

    toggleMarkdown('**')({ state, dispatch })
    expect(state.doc.toString()).toBe('**First**\n\n**Second**')

    undo({ state, dispatch })
    expect(state.doc.toString()).toBe(source)
  })

  test('preserves the direction of a reversed selection', () => {
    const result = runCommand('reverse me', toggleMarkdown('*'), 10, 0)

    expect(result.doc).toBe('*reverse me*')
    expect(result.selection.anchor).toBe(11)
    expect(result.selection.head).toBe(1)
  })

  test('does nothing to a whitespace-only selection', () => {
    const result = runCommand('   ', toggleMarkdown('*'))

    expect(result.doc).toBe('   ')
  })
})

describe('toggleLink', () => {
  test('creates a link and selects its destination', () => {
    const result = runCommand('Read this', toggleLink)

    expect(result.doc).toBe('[Read this](url)')
    expect(result.doc.slice(result.selection.from, result.selection.to)).toBe('url')
  })

  test('inserts a link template and selects its label at a collapsed cursor', () => {
    const result = runCommand('Read ', toggleLink, 5, 5)

    expect(result.doc).toBe('Read [text](url)')
    expect(result.doc.slice(result.selection.from, result.selection.to)).toBe('text')
  })

  test('unlinks a complete link while preserving a formatted label', () => {
    const result = runCommand('[Read **this**](https://example.com)', toggleLink)

    expect(result.doc).toBe('Read **this**')
    expect(result.selection.from).toBe(0)
    expect(result.selection.to).toBe(result.doc.length)
  })

  test('unlinks when the cursor is in an existing label', () => {
    const result = runCommand('A [linked note](url).', toggleLink, 6, 6)

    expect(result.doc).toBe('A linked note.')
    expect(result.selection.from).toBe(5)
  })

  test('selects the destination when the cursor is inside an existing URL', () => {
    const source = '[label](https://example.com)'
    const result = runCommand(source, toggleLink, 12, 12)

    expect(result.doc).toBe(source)
    expect(result.doc.slice(result.selection.from, result.selection.to)).toBe('https://example.com')
  })

  test('refuses to create a link across paragraphs', () => {
    const source = 'First paragraph\n\nSecond paragraph'
    const result = runCommand(source, toggleLink)

    expect(result.handled).toBe(false)
    expect(result.doc).toBe(source)
  })

  test('refuses to create a link around a selection containing an existing link', () => {
    const source = 'Read [this](url) now'
    const result = runCommand(source, toggleLink)

    expect(result.handled).toBe(false)
    expect(result.doc).toBe(source)
  })

  test('creates independent links for multiple selections', () => {
    const result = runRanges('one and two', toggleLink, [
      { anchor: 0, head: 3 },
      { anchor: 8, head: 11 },
    ])

    expect(result.doc).toBe('[one](url) and [two](url)')
  })
})
