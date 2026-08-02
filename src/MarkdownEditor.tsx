import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
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
import { Annotation, EditorState, StateEffect, type Range } from '@codemirror/state'
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
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { insertNewlineContinueBlockquote } from './markdownBlockquote'
import { markdownHighlight } from './markdownHighlight'
import { toggleLink, toggleMarkdown } from './markdownCommands'
import type { NoteReference } from './notes'
import { navigationPlatform, type NotePreviewCandidate } from './notePreview'
import { wikiLinkCompletion } from './wikiLinkCompletion'
import {
  canonicalResolvedWikiLink,
  isWikiLinkNavigationClick,
  parseWikiLinkText,
  selectionTouchesSourceRange,
  validateWikiLinkOccurrence,
  wikiLinkHiddenSyntaxRanges,
  wikiLinkMarkdown,
} from './wikiLinks'

export type WikiLinkActivation = {
  target: string
  validateCurrentOccurrence: (authoritativeBody: string) => boolean
  applyCanonical: (canonicalTarget: string, resolvedTitle: string) => string | null
  finish: () => void
}

export type MarkdownEditorHandle = {
  focusAtEnd: () => void
}

type MarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  onPreviewCandidateEnter: (candidate: NotePreviewCandidate) => void
  onPreviewCandidateLeave: () => void
  onPreviewDismiss: () => void
  onWikiLinkActivate: (activation: WikiLinkActivation) => void
  resolveWikiLink: (target: string) => Promise<boolean | null>
  suggestWikiLinks: (query: string) => Promise<NoteReference[]>
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
  const prefixes = new Map<number, { end: number; heading: boolean; quote: boolean }>()

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

          const isQuote = node.name === 'QuoteMark'
          const isSpacedQuote = isQuote
            && /[\t ]/.test(view.state.sliceDoc(node.to, node.to + 1))

          if (isQuote && !isSpacedQuote) return

          if (isSpacedQuote) {
            decorations.push(Decoration.mark({
              class: 'cm-quote-marker',
            }).range(node.from, node.to))
          }

          prefixes.set(line.from, {
            end: node.to,
            heading: Boolean(prefix?.heading || node.name === 'HeaderMark'),
            quote: Boolean(prefix?.quote || isSpacedQuote),
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
        class: [
          'cm-hanging-markdown-line',
          prefix.heading && 'cm-heading-line',
          prefix.quote && 'cm-quote-line',
        ].filter(Boolean).join(' '),
        style: `--markdown-prefix-width: ${prefixLength}ch`,
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
  return view.state.selection.ranges.some((selection) =>
    selectionTouchesSourceRange(selection, range),
  )
}

function inlineMarkdownDecorations(
  view: EditorView,
  resolvedTargets: ReadonlyMap<string, boolean | null>,
) {
  const decorations: Range<Decoration>[] = []

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === 'WikiLink') {
        const parsed = parseWikiLinkText(view.state.sliceDoc(node.from, node.to))
        const missing = parsed && resolvedTargets.get(parsed.target) === false
        decorations.push(Decoration.mark({
          class: missing ? 'cm-wiki-link cm-wiki-link-missing' : 'cm-wiki-link',
        }).range(node.from, node.to))

        const children: { name: string; from: number; to: number }[] = []
        const cursor = node.node.cursor()
        if (cursor.firstChild()) {
          do {
            children.push({ name: cursor.name, from: cursor.from, to: cursor.to })
          } while (cursor.nextSibling())
        }

        for (const range of wikiLinkHiddenSyntaxRanges(
          node,
          children,
          view.state.selection.ranges,
        )) {
          decorations.push(Decoration.replace({}).range(range.from, range.to))
        }
        return
      }

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

const wikiLinkResolutionChanged = StateEffect.define<null>()

function wikiLinkTargets(view: EditorView) {
  const targets = new Set<string>()
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name !== 'WikiLink') return
      const parsed = parseWikiLinkText(view.state.sliceDoc(node.from, node.to))
      if (parsed) targets.add(parsed.target)
    },
  })
  return targets
}

function inlineMarkdown(
  resolveWikiLink: (target: string) => Promise<boolean | null>,
) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    resolvedTargets = new Map<string, boolean | null>()
    pendingTargets = new Set<string>()

    constructor(view: EditorView) {
      this.decorations = inlineMarkdownDecorations(view, this.resolvedTargets)
      this.resolveTargets(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.resolveTargets(update.view)
      const resolutionChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(wikiLinkResolutionChanged)),
      )
      if (update.docChanged || update.viewportChanged || update.selectionSet || resolutionChanged) {
        this.decorations = inlineMarkdownDecorations(update.view, this.resolvedTargets)
      }
    }

    resolveTargets(view: EditorView) {
      for (const target of wikiLinkTargets(view)) {
        if (this.resolvedTargets.has(target) || this.pendingTargets.has(target)) continue
        this.pendingTargets.add(target)
        void resolveWikiLink(target).then(
          (exists) => this.finishTarget(view, target, exists),
          () => this.finishTarget(view, target, null),
        )
      }
    }

    finishTarget(view: EditorView, target: string, exists: boolean | null) {
      this.pendingTargets.delete(target)
      this.resolvedTargets.set(target, exists)
      if (view.dom.isConnected) view.dispatch({ effects: wikiLinkResolutionChanged.of(null) })
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  })
}

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
  '.cm-panels.cm-panels-top': { borderBottom: '0.5px solid var(--color-divider)' },
  '.cm-textfield': {
    backgroundColor: 'var(--color-canvas)',
    border: '0.5px solid var(--color-border)',
    borderRadius: '0.625rem',
    color: 'var(--color-ink)',
    font: 'inherit',
    fontSize: '1rem',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--color-hover)',
    border: '0.5px solid var(--color-border)',
    borderRadius: '0.625rem',
    color: 'var(--color-ink)',
  },
})

function wikiLinkInteraction(
  onActivate: (activation: WikiLinkActivation) => void,
  onPreviewCandidateEnter: (candidate: NotePreviewCandidate) => void,
  onPreviewCandidateLeave: () => void,
  onPreviewDismiss: () => void,
) {
  return ViewPlugin.fromClass(class {
    active = new Set<{ from: number; to: number; original: string; target: string }>()
    hoveredCandidateId: string | null = null
    hoveredAnchor: Element | null = null

    clearHoveredCandidate() {
      if (this.hoveredCandidateId === null) return
      this.hoveredCandidateId = null
      this.hoveredAnchor = null
      onPreviewCandidateLeave()
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        for (const occurrence of this.active) {
          occurrence.from = update.changes.mapPos(occurrence.from, 1)
          occurrence.to = update.changes.mapPos(occurrence.to, -1)
        }
      }
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.clearHoveredCandidate()
      }
    }

    pointerMove(view: EditorView, event: PointerEvent) {
      if (event.pointerType !== 'mouse') return false
      const eventElement = event.target instanceof Element
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null
      const hoveredElement = eventElement?.closest('.cm-wiki-link') ?? null
      if (!hoveredElement || !view.dom.contains(hoveredElement)) {
        this.clearHoveredCandidate()
        return false
      }
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (position === null) {
        this.clearHoveredCandidate()
        return false
      }
      let node = syntaxTree(view.state).resolveInner(position, -1)
      while (node.name !== 'WikiLink' && node.parent) node = node.parent
      if (node.name !== 'WikiLink') {
        this.clearHoveredCandidate()
        return false
      }
      const original = view.state.sliceDoc(node.from, node.to)
      const parsed = parseWikiLinkText(original)
      if (!parsed) {
        this.clearHoveredCandidate()
        return false
      }

      const id = `wiki-link:${node.from}:${node.to}:${original}`
      if (this.hoveredCandidateId === id && this.hoveredAnchor === hoveredElement) return false
      this.hoveredCandidateId = id
      this.hoveredAnchor = hoveredElement
      onPreviewCandidateEnter({
        source: 'wiki-link',
        id,
        target: parsed.target,
        anchor: hoveredElement,
      })
      return false
    }

    pointerLeave(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return false
      this.clearHoveredCandidate()
      return false
    }

    activate(view: EditorView, event: MouseEvent) {
      if (!isWikiLinkNavigationClick(navigationPlatform(), event)) return false
      const position = view.posAtDOM(event.target as Node)
      let node = syntaxTree(view.state).resolveInner(position, -1)
      while (node.name !== 'WikiLink' && node.parent) node = node.parent
      if (node.name !== 'WikiLink') return false
      const original = view.state.sliceDoc(node.from, node.to)
      const parsed = parseWikiLinkText(original)
      if (!parsed) return false
      onPreviewDismiss()
      event.preventDefault()
      const occurrence = { from: node.from, to: node.to, original, target: parsed.target }
      this.active.add(occurrence)
      const validateCurrentOccurrence = (authoritativeBody: string) => (
        this.active.has(occurrence)
        && validateWikiLinkOccurrence(view.state, occurrence, authoritativeBody)
      )
      onActivate({
        target: parsed.target,
        validateCurrentOccurrence,
        applyCanonical: (canonicalTarget, resolvedTitle) => {
          if (!validateCurrentOccurrence(view.state.doc.toString())) return null
          const replacement = canonicalResolvedWikiLink(
            canonicalTarget,
            resolvedTitle,
            parsed.display,
          )
          if (replacement !== occurrence.original) view.dispatch({ changes: { from: occurrence.from, to: occurrence.to, insert: replacement } })
          return view.state.doc.toString()
        },
        finish: () => this.active.delete(occurrence),
      })
      return true
    }
  }, {
    eventHandlers: {
      mousedown(event, view) { return this.activate(view, event) },
      pointerleave(event) { return this.pointerLeave(event) },
      pointermove(event, view) { return this.pointerMove(view, event) },
    },
  })
}

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
  markdown({
    addKeymap: false,
    base: commonmarkLanguage,
    codeLanguages: languages,
    extensions: [GFM, markdownHighlight, wikiLinkMarkdown],
  }),
  keymap.of([
    ...completionKeymap,
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
    spellcheck: 'false',
  }),
  placeholder('Start writing…'),
  editorTheme,
]

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  value,
  onChange,
  onPreviewCandidateEnter,
  onPreviewCandidateLeave,
  onPreviewDismiss,
  onWikiLinkActivate,
  resolveWikiLink,
  suggestWikiLinks,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView>(null)
  const initialValueRef = useRef(value)

  useImperativeHandle(ref, () => ({
    focusAtEnd() {
      const editor = editorRef.current
      if (!editor) return
      editor.dispatch({ selection: { anchor: editor.state.doc.length } })
      editor.focus()
    },
  }), [])
  const onChangeRef = useRef(onChange)
  const onPreviewCandidateEnterRef = useRef(onPreviewCandidateEnter)
  const onPreviewCandidateLeaveRef = useRef(onPreviewCandidateLeave)
  const onPreviewDismissRef = useRef(onPreviewDismiss)
  const onWikiLinkActivateRef = useRef(onWikiLinkActivate)
  const resolveWikiLinkRef = useRef(resolveWikiLink)
  const suggestWikiLinksRef = useRef(suggestWikiLinks)

  useEffect(() => {
    onChangeRef.current = onChange
    onPreviewCandidateEnterRef.current = onPreviewCandidateEnter
    onPreviewCandidateLeaveRef.current = onPreviewCandidateLeave
    onPreviewDismissRef.current = onPreviewDismiss
    onWikiLinkActivateRef.current = onWikiLinkActivate
    resolveWikiLinkRef.current = resolveWikiLink
    suggestWikiLinksRef.current = suggestWikiLinks
  }, [
    onChange,
    onPreviewCandidateEnter,
    onPreviewCandidateLeave,
    onPreviewDismiss,
    onWikiLinkActivate,
    resolveWikiLink,
    suggestWikiLinks,
  ])

  useLayoutEffect(() => {
    if (!containerRef.current) return

    const editor = new EditorView({
      doc: initialValueRef.current,
      selection: { anchor: initialValueRef.current.length },
      extensions: [
        editorExtensions,
        inlineMarkdown((target) => resolveWikiLinkRef.current(target)),
        autocompletion({
          activateOnTyping: true,
          icons: false,
          maxRenderedOptions: 8,
          override: [wikiLinkCompletion((query) => suggestWikiLinksRef.current(query))],
        }),
        wikiLinkInteraction(
          (activation) => onWikiLinkActivateRef.current(activation),
          (candidate) => onPreviewCandidateEnterRef.current(candidate),
          () => onPreviewCandidateLeaveRef.current(),
          () => onPreviewDismissRef.current(),
        ),
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
})
