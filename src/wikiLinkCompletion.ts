import {
  pickedCompletion,
  type CompletionContext,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import { noteKeyStem, type NoteReference } from './notes'
import { canonicalResolvedWikiLink } from './wikiLinks'

function isCodePosition(context: CompletionContext) {
  let node = syntaxTree(context.state).resolveInner(context.pos, -1)
  while (node) {
    if (node.name === 'InlineCode' || node.name === 'FencedCode' || node.name === 'CodeBlock') {
      return true
    }
    node = node.parent!
  }
  return false
}

export function wikiLinkCompletion(
  suggest: (query: string) => Promise<NoteReference[]>,
): CompletionSource {
  return async (context) => {
    if (isCodePosition(context)) return null

    const line = context.state.doc.lineAt(context.pos)
    const beforeCursor = context.state.sliceDoc(line.from, context.pos)
    const openingIndex = beforeCursor.lastIndexOf('[[')
    if (openingIndex < 0) return null

    const query = beforeCursor.slice(openingIndex + 2)
    if (/[\][|\\/#^]/u.test(query)) return null

    context.addEventListener('abort', () => {}, { onDocChange: true })
    const notes = await suggest(query.trim()).catch(() => [])
    if (context.aborted) return null

    return {
      from: line.from + openingIndex + 2,
      filter: false,
      options: notes.map((note) => {
        const target = noteKeyStem(note.key)
        return {
          label: note.title,
          apply: (view, completion, from, to) => {
            const link = canonicalResolvedWikiLink(target, note.title).slice(2)
            view.dispatch({
              annotations: pickedCompletion.of(completion),
              changes: { from, to, insert: link },
              selection: { anchor: from + link.length },
            })
          },
        }
      }),
    }
  }
}
