import { CompletionContext } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'bun:test'
import { wikiLinkCompletion } from '../src/wikiLinkCompletion'

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
})
