import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  HighlightStyle,
  indentOnInput,
  syntaxTree,
  syntaxHighlighting,
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import {
  commonmarkLanguage,
  markdown,
  markdownKeymap,
} from '@codemirror/lang-markdown'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Annotation, EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { GFM } from '@lezer/markdown'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { insertNewlineContinueBlockquote } from './markdownBlockquote'
import { markdownHighlight } from './markdownHighlight'
import { toggleLink, toggleMarkdown } from './markdownCommands'

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
}

const externalSync = Annotation.define<boolean>()

const markdownHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading1, class: 'cm-heading cm-heading-1' },
  { tag: tags.heading2, class: 'cm-heading cm-heading-2' },
  {
    tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    class: 'cm-heading cm-heading-3',
  },
  { tag: tags.strong, class: 'cm-strong' },
  { tag: tags.emphasis, class: 'cm-emphasis' },
  { tag: tags.strikethrough, class: 'cm-strikethrough' },
  { tag: tags.link, class: 'cm-link' },
  { tag: tags.url, class: 'cm-url' },
  { tag: tags.monospace, class: 'cm-monospace' },
  { tag: tags.quote, class: 'cm-quote' },
  { tag: tags.meta, class: 'cm-markup' },
], { scope: commonmarkLanguage }))

function hangingMarkdownMarkers(view: EditorView) {
  const decorations: Range<Decoration>[] = []
  const prefixes = new Map<number, { end: number; heading: boolean }>()

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
          const line = view.state.doc.lineAt(node.from)
          const prefix = prefixes.get(line.from)
          const gap = view.state.sliceDoc(prefix?.end ?? line.from, node.from)

          if (!/^\s*$/.test(gap)) return

          if (
            node.name === 'QuoteMark'
            && /[\t ]/.test(view.state.sliceDoc(node.to, node.to + 1))
          ) {
            decorations.push(Decoration.mark({
              class: 'cm-quote-marker',
            }).range(node.from, node.to))
          }

          prefixes.set(line.from, {
            end: node.to,
            heading: Boolean(prefix?.heading || node.name === 'HeaderMark'),
          })
        }
      },
    })
  }

  for (const [lineFrom, prefix] of prefixes) {
    const line = view.state.doc.lineAt(lineFrom)
    let prefixEnd = prefix.end

    while (prefixEnd < line.to && /[\t ]/.test(view.state.sliceDoc(prefixEnd, prefixEnd + 1))) {
      prefixEnd += 1
    }

    const prefixLength = prefixEnd - line.from
    decorations.push(Decoration.mark({
      class: 'cm-hanging-markdown-prefix',
    }).range(line.from, prefixEnd))
    decorations.push(Decoration.line({
      attributes: {
        class: prefix.heading
          ? 'cm-hanging-markdown-line cm-heading-line'
          : 'cm-hanging-markdown-line',
        style: `text-indent: -${prefixLength}ch`,
      },
    }).range(line.from))
  }

  return Decoration.set(decorations, true)
}

const hangingMarkdown = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = hangingMarkdownMarkers(view)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = hangingMarkdownMarkers(update.view)
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
})

function selectionTouchesRange(
  view: EditorView,
  range: { from: number; to: number },
) {
  return view.state.selection.ranges.some((selection) => selection.empty
    ? selection.from >= range.from && selection.from <= range.to
    : selection.from < range.to && selection.to > range.from)
}

function inlineMarkdownDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = []

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'EmphasisMark') {
        const format = node.node.parent
        if (format && !selectionTouchesRange(view, format)) {
          decorations.push(Decoration.replace({}).range(node.from, node.to))
        }
        return
      }

      if (node.name !== 'Highlight') return

      const marks: { from: number; to: number }[] = []
      const cursor = node.node.cursor()
      if (cursor.firstChild()) {
        do {
          if (cursor.name === 'HighlightMark') {
            marks.push({ from: cursor.from, to: cursor.to })
          }
        } while (cursor.nextSibling())
      }

      if (marks.length >= 2) {
        const first = marks[0]
        const last = marks[marks.length - 1]
        decorations.push(Decoration.mark({ class: 'cm-highlight' }).range(
          first.to,
          last.from,
        ))
        if (!selectionTouchesRange(view, node)) {
          decorations.push(Decoration.replace({}).range(first.from, first.to))
          decorations.push(Decoration.replace({}).range(last.from, last.to))
        }
      }
    },
  })

  return Decoration.set(decorations, true)
}

const inlineMarkdown = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = inlineMarkdownDecorations(view)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = inlineMarkdownDecorations(update.view)
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
})

const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--color-body)',
    fontSize: 'var(--text-base)',
    minHeight: '58vh',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontKerning: 'normal',
    fontVariantLigatures: 'none',
    lineHeight: '1.6',
    overflow: 'visible',
  },
  '.cm-content': {
    caretColor: 'var(--color-ink)',
    minHeight: '58vh',
    padding: '0',
  },
  '.cm-line': {
    overflowWrap: 'break-word',
    padding: '0',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ink)' },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--color-selection)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--color-selection)',
  },
  '.cm-content ::selection': {
    backgroundColor: 'var(--color-selection)',
    color: 'var(--color-selection-ink)',
  },
  '.cm-placeholder': { color: 'var(--color-placeholder)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--color-selection)',
    outline: '1px solid var(--color-faint)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--color-selection)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-ink)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--color-border)' },
  '.cm-textfield': {
    backgroundColor: 'var(--color-canvas)',
    border: '1px solid var(--color-border)',
    borderRadius: '0.25rem',
    color: 'var(--color-ink)',
    font: 'inherit',
    fontSize: '1rem',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--color-hover)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-ink)',
  },
})

const editorExtensions = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  highlightSelectionMatches(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  markdownHighlighting,
  hangingMarkdown,
  inlineMarkdown,
  markdown({
    addKeymap: false,
    base: commonmarkLanguage,
    codeLanguages: languages,
    extensions: [GFM, markdownHighlight],
  }),
  keymap.of([
    { key: 'Enter', run: insertNewlineContinueBlockquote },
    { key: 'Mod-b', run: toggleMarkdown('**') },
    { key: 'Mod-i', run: toggleMarkdown('*') },
    { key: 'Mod-Shift-h', run: toggleMarkdown('==') },
    { key: 'Mod-k', run: toggleLink },
    { key: 'Mod-`', run: toggleMarkdown('`') },
    { key: 'Mod-Shift-x', run: toggleMarkdown('~~') },
    ...markdownKeymap,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    indentWithTab,
  ]),
  EditorView.lineWrapping,
  EditorView.contentAttributes.of({
    'aria-label': 'Note content',
    'aria-multiline': 'true',
    spellcheck: 'true',
  }),
  placeholder('Start writing…'),
  editorTheme,
]

export function MarkdownEditor({ value, onChange }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView>(null)
  const initialValueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useLayoutEffect(() => {
    if (!containerRef.current) return

    const editor = new EditorView({
      doc: initialValueRef.current,
      selection: { anchor: initialValueRef.current.length },
      extensions: [
        editorExtensions,
        EditorView.updateListener.of((update) => {
          const isExternalSync = update.transactions.some((transaction) =>
            transaction.annotation(externalSync),
          )

          if (update.docChanged && !isExternalSync) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
      parent: containerRef.current,
    })

    editorRef.current = editor
    editor.focus()

    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.state.doc.toString() === value) return

    editor.dispatch({
      annotations: externalSync.of(true),
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    })
  }, [value])

  return <div className="markdown-editor" ref={containerRef} />
}
