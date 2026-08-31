import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { history, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { slashCommandCompletion } from './slashCommandCompletion'
import { renderSlashCommandIcon } from './slashCommandIcons'

beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
})

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

function completionResult(doc: string, position = doc.length): CompletionResult | null {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  const result = slashCommandCompletion(new CompletionContext(state, position, false))
  if (result instanceof Promise) throw new Error('Expected synchronous slash completions')
  return result
}

function option(result: CompletionResult, label: string) {
  const completion = result.options.find((candidate) => candidate.label === label)
  if (!completion) throw new Error(`Missing ${label} completion`)
  return completion
}

function applyCompletion(
  view: EditorView,
  result: CompletionResult,
  completion: Completion,
  to = view.state.doc.length,
) {
  if (typeof completion.apply !== 'function') throw new Error('Expected a completion function')
  completion.apply(view, completion, result.from, to)
}

describe('slashCommandCompletion', () => {
  test('opens at line start and after whitespace on a content line', () => {
    const result = completionResult('/')
    expect(result?.from).toBe(1)
    expect(result?.options.map(({ detail, label, type }) => ({ detail, label, type }))).toEqual([
      { detail: undefined, label: 'Insert callout', type: 'slash-callout' },
      { detail: undefined, label: 'Insert table', type: 'slash-table' },
      { detail: undefined, label: 'Insert code block', type: 'slash-code' },
      { detail: undefined, label: 'Insert horizontal rule', type: 'slash-rule' },
    ])
    expect(completionResult('Existing thought /tab')?.from).toBe(18)
    expect(completionResult('Existing thought/tab')).toBeNull()
    expect(completionResult('Existing /tab content')).toBeNull()
  })

  test('renders decorative command icons that inherit the option color', () => {
    const result = completionResult('/')
    if (!result) throw new Error('Expected slash completions')

    const icon = renderSlashCommandIcon(option(result, 'Insert callout'), document)
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('path')?.getAttribute('fill')).toBe('currentColor')
  })

  test('closes when the query contains a space', () => {
    expect(completionResult('/table ')).toBeNull()
    expect(completionResult('Thought /call out')).toBeNull()
  })

  test('does not open in protected Markdown or with multiple selections', () => {
    expect(completionResult('`/table`')).toBeNull()
    expect(completionResult('```\n/table')).toBeNull()

    const state = EditorState.create({
      doc: '/table',
      extensions: [markdown()],
      selection: { anchor: 0, head: 1 },
    })
    expect(slashCommandCompletion(new CompletionContext(state, 1, false))).toBeNull()
  })

  test('moves a table below existing line content and undoes it in one step', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({ doc: 'Existing thought /tab', extensions: [history(), markdown()], parent: host })
    views.push(view)
    const result = completionResult(view.state.doc.toString())
    if (!result) throw new Error('Expected slash completions')

    applyCompletion(view, result, option(result, 'Insert table'))

    expect(view.state.doc.toString()).toBe(
      'Existing thought\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n|  |  |\n\n',
    )
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Column 1')
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('Existing thought /tab')
  })

  test('inserts a callout in place on an otherwise empty line', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({ doc: '/', extensions: [markdown()], parent: host })
    views.push(view)
    const result = completionResult('/')
    if (!result) throw new Error('Expected slash completions')

    applyCompletion(view, result, option(result, 'Insert callout'))

    expect(view.state.doc.toString()).toBe('> [!note] Callout title\n> Callout content\n\n')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('Callout title')
  })

  test('uses an existing line break when separating the inserted block from following content', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const doc = '/table\nFollowing paragraph'
    const view = new EditorView({
      doc,
      extensions: [markdown()],
      parent: host,
      selection: { anchor: 6 },
    })
    views.push(view)
    const result = completionResult(doc, 6)
    if (!result) throw new Error('Expected slash completions')

    applyCompletion(view, result, option(result, 'Insert table'), 6)

    expect(view.state.doc.toString()).toEndWith('|  |  |\n\nFollowing paragraph')
  })

  test('replaces an otherwise empty Markdown structural prefix', () => {
    for (const doc of ['- /rule', '> /rule', '# /rule']) {
      const host = document.createElement('div')
      document.body.append(host)
      const view = new EditorView({ doc, extensions: [markdown()], parent: host })
      views.push(view)
      const result = completionResult(doc)
      if (!result) throw new Error(`Expected slash completions for ${doc}`)

      applyCompletion(view, result, option(result, 'Insert horizontal rule'))

      expect(view.state.doc.toString()).toBe('---\n\n')
    }
  })

  test('replaces indentation so an inserted block does not become indented code', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const view = new EditorView({ doc: '    /call', extensions: [markdown()], parent: host })
    views.push(view)
    const result = completionResult('    /call')
    if (!result) throw new Error('Expected slash completions')

    applyCompletion(view, result, option(result, 'Insert callout'))

    expect(view.state.doc.toString()).toStartWith('> [!note]')
  })
})
