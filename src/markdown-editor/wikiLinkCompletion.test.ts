import { CompletionContext } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'bun:test'
import { wikiLinkCompletion } from './wikiLinkCompletion'

function context(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  return new CompletionContext(state, pos, false)
}

describe('wikiLinkCompletion', () => {
  test('requests and presents note suggestions for an unfinished wiki link', async () => {
    const queries: string[] = []
    const source = wikiLinkCompletion(async (query) => {
      queries.push(query)
      return [{ key: 'Field-guide.md', title: 'Field guide' }]
    })

    const result = await source(context('See [[  field'))

    expect(queries).toEqual(['field'])
    expect(result?.from).toBe(6)
    expect(result?.options.map((option) => option.label)).toEqual(['Field guide'])
  })

  test('does not suggest inside code or after unsupported link syntax', async () => {
    const source = wikiLinkCompletion(async () => [
      { key: 'Thought.md', title: 'Thought' },
    ])

    expect(await source(context('`[[Tho`', 6))).toBeNull()
    expect(await source(context('[[Tho|'))).toBeNull()
    expect(await source(context('ordinary text'))).toBeNull()
  })

  test('replaces auto-inserted closing brackets when a note is selected', async () => {
    const state = EditorState.create({ doc: 'See [[field]]', extensions: [markdown()] })
    const source = wikiLinkCompletion(async () => [
      { key: 'Field-guide.md', title: 'Field guide' },
    ])
    const result = await source(new CompletionContext(state, 11, false))
    const completion = result?.options[0]

    if (!result || !completion || typeof completion.apply !== 'function') {
      throw new Error('Expected a wiki-link completion')
    }

    let nextState = state
    const view = {
      state,
      dispatch(spec: TransactionSpec) {
        nextState = state.update(spec).state
      },
    } as unknown as EditorView

    completion.apply(view, completion, result.from, 11)

    expect(nextState.doc.toString()).toBe('See [[Field-guide|Field guide]]')
    expect(nextState.selection.main.anchor).toBe(31)
  })
})
