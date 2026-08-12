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
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from '@codemirror/state'
import {
  Direction,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  layer,
  placeholder,
  RectangleMarker,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { GFM } from '@lezer/markdown'
import { openUrl } from '@tauri-apps/plugin-opener'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { insertNewlineContinueBlockquote } from './markdownBlockquote'
import { setMarkdownBlock, type MarkdownBlockKind } from './markdownBlockCommands'
import {
  recallEditorViewState,
  rememberEditorViewState,
  renameEditorViewState,
} from './editorViewState'
import { markdownHighlight } from './markdownHighlight'
import { toggleLink, toggleMarkdown } from './markdownCommands'
import { livePreview } from './livePreview'
import type { NoteReference } from './notes'
import { navigationPlatform, type NotePreviewCandidate } from './notePreview'
import { diffTextChanges } from './threeWayTextMerge'
import { wikiLinkCompletion } from './wikiLinkCompletion'
import {
  canonicalResolvedWikiLink,
  isWikiLinkNavigationClick,
  parseWikiLinkText,
  validateWikiLinkOccurrence,
  wikiLinkMarkdown,
} from './wikiLinks'

export type WikiLinkActivation = {
  target: string
  validateCurrentOccurrence: (authoritativeBody: string) => boolean
  applyCanonical: (canonicalTarget: string, resolvedTitle: string) => string | null
  finish: () => void
}

export type MarkdownEditorHandle = {
  applyBlock: (kind: MarkdownBlockKind) => void
  focusAtEnd: () => void
}

type MarkdownEditorProps = {
  editorSessionId: number
  noteKey: string
  value: string
  onChange: (value: string) => void
  onPreviewCandidateEnter: (candidate: NotePreviewCandidate) => void
  onPreviewCandidateLeave: () => void
  onPreviewDismiss: () => void
  onWikiLinkActivate: (activation: WikiLinkActivation) => void
  resolveWikiLink: (target: string) => Promise<boolean | null>
  spellcheckEnabled: boolean
  suggestWikiLinks: (query: string) => Promise<NoteReference[]>
}

const externalSync = Annotation.define<boolean>()

function editorContentAttributes(spellcheckEnabled: boolean) {
  return EditorView.contentAttributes.of({
    'aria-label': 'Note content',
    'aria-multiline': 'true',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: spellcheckEnabled ? 'true' : 'false',
  })
}

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

function linkInteraction(
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

    activateExternalLink(view: EditorView, event: MouseEvent) {
      if (!isWikiLinkNavigationClick(navigationPlatform(), event)) return false
      const position = view.posAtDOM(event.target as Node)
      let node = syntaxTree(view.state).resolveInner(position, -1)
      while (node.name !== 'Link' && node.parent) node = node.parent
      if (node.name !== 'Link') return false

      const cursor = node.cursor()
      let destination: string | null = null
      if (cursor.firstChild()) {
        do {
          if (cursor.name === 'URL') {
            destination = view.state.sliceDoc(cursor.from, cursor.to)
            break
          }
        } while (cursor.nextSibling())
      }
      if (!destination) return false

      let url: URL
      try {
        url = new URL(destination)
      } catch {
        return false
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

      event.preventDefault()
      onPreviewDismiss()
      void openUrl(url.href).catch(() => {})
      return true
    }

    activateWikiLink(view: EditorView, event: MouseEvent) {
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
      mousedown(event, view) {
        return this.activateWikiLink(view, event)
          || this.activateExternalLink(view, event)
      },
      pointerleave(event) { return this.pointerLeave(event) },
      pointermove(event, view) { return this.pointerMove(view, event) },
    },
  })
}

// Backgrounds must be rendered in a layer below CodeMirror's drawn selection.
// The layer is intentionally declared after drawSelection() so its z-index stays lower.
const markdownBackgroundLayer = layer({
  above: false,
  class: 'cm-markdown-background-layer',
  update(update) {
    return update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged
  },
  markers(view) {
    const scrollRect = view.scrollDOM.getBoundingClientRect()
    const baseLeft = view.textDirection === Direction.LTR
      ? scrollRect.left
      : scrollRect.right - view.scrollDOM.clientWidth * view.scaleX
    const baseTop = scrollRect.top
    const markerForRect = (className: string, rect: DOMRect) => new RectangleMarker(
      className,
      rect.left - baseLeft + view.scrollDOM.scrollLeft * view.scaleX,
      rect.top - baseTop + view.scrollDOM.scrollTop * view.scaleY,
      rect.width,
      rect.height,
    )
    const markers: RectangleMarker[] = []

    for (const line of view.dom.querySelectorAll<HTMLElement>('.cm-line.cm-fenced-code-line')) {
      const rect = line.getBoundingClientRect()
      const className = [
        'cm-fenced-code-background',
        line.classList.contains('cm-fenced-code-first-line')
          ? 'cm-fenced-code-background-first-line'
          : '',
        line.classList.contains('cm-fenced-code-last-line')
          ? 'cm-fenced-code-background-last-line'
          : '',
      ].filter(Boolean).join(' ')
      markers.push(markerForRect(className, rect))
    }

    for (const code of view.dom.querySelectorAll<HTMLElement>('.cm-monospace')) {
      if (code.closest('.cm-fenced-code-line')) continue
      for (const rect of code.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          markers.push(markerForRect('cm-monospace-background', rect))
        }
      }
    }

    for (const highlight of view.dom.querySelectorAll<HTMLElement>('.cm-highlight')) {
      if (highlight.closest('.cm-fenced-code-line')) continue
      for (const rect of highlight.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          markers.push(markerForRect('cm-highlight-background', rect))
        }
      }
    }

    return markers
  },
})

const editorExtensions = [
  highlightSpecialChars(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  highlightSelectionMatches(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  markdownHighlighting,
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
    ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      key: `Mod-Alt-${level}`,
      run: setMarkdownBlock(`heading-${level}`),
    })),
    { key: 'Mod-Shift-7', run: setMarkdownBlock('ordered') },
    { key: 'Mod-Shift-8', run: setMarkdownBlock('bullet') },
    { key: 'Mod-Shift-9', run: setMarkdownBlock('quote') },
    { key: 'Mod-Shift-l', run: setMarkdownBlock('task') },
    ...markdownKeymap,
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    indentWithTab,
  ]),
  EditorView.lineWrapping,
  placeholder('Start writing…'),
  editorTheme,
  markdownBackgroundLayer,
]

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({
  editorSessionId,
  noteKey,
  value,
  onChange,
  onPreviewCandidateEnter,
  onPreviewCandidateLeave,
  onPreviewDismiss,
  onWikiLinkActivate,
  resolveWikiLink,
  spellcheckEnabled,
  suggestWikiLinks,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView>(null)
  const initialValueRef = useRef(value)
  const initialNoteKeyRef = useRef(noteKey)
  const initialSpellcheckEnabledRef = useRef(spellcheckEnabled)
  const currentSessionIdRef = useRef(editorSessionId)
  const currentNoteKeyRef = useRef(noteKey)
  const scrollElementRef = useRef<HTMLElement | null>(null)
  const historyCompartmentRef = useRef(new Compartment())
  const contentAttributesCompartmentRef = useRef(new Compartment())
  const livePreviewCompartmentRef = useRef(new Compartment())

  useImperativeHandle(ref, () => ({
    applyBlock(kind) {
      const editor = editorRef.current
      if (!editor) return
      setMarkdownBlock(kind)({
        state: editor.state,
        dispatch: (transaction) => editor.dispatch(transaction),
      })
      editor.focus()
    },
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

    const recalled = recallEditorViewState(
      initialNoteKeyRef.current,
      initialValueRef.current.length,
    )
    const editor = new EditorView({
      doc: initialValueRef.current,
      selection: recalled?.selection ?? { anchor: initialValueRef.current.length },
      extensions: [
        editorExtensions,
        historyCompartmentRef.current.of(history()),
        contentAttributesCompartmentRef.current.of(
          editorContentAttributes(initialSpellcheckEnabledRef.current),
        ),
        livePreviewCompartmentRef.current.of(
          livePreview((target) => resolveWikiLinkRef.current(target)),
        ),
        autocompletion({
          activateOnTyping: true,
          icons: false,
          maxRenderedOptions: 8,
          override: [wikiLinkCompletion((query) => suggestWikiLinksRef.current(query))],
        }),
        linkInteraction(
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
          if (update.selectionSet || update.docChanged) {
            const scrollElement = scrollElementRef.current ?? update.view.scrollDOM
            rememberEditorViewState(
              currentNoteKeyRef.current,
              update.state,
              scrollElement.scrollTop,
            )
          }
        }),
      ],
      parent: containerRef.current,
    })

    editorRef.current = editor
    const scrollElement = editor.dom.closest<HTMLElement>('.app-scroll-container')
      ?? editor.scrollDOM
    scrollElementRef.current = scrollElement
    if (recalled) scrollElement.scrollTop = recalled.scrollTop
    const rememberScroll = () => rememberEditorViewState(
      currentNoteKeyRef.current,
      editor.state,
      scrollElement.scrollTop,
    )
    scrollElement.addEventListener('scroll', rememberScroll, { passive: true })
    editor.focus()

    return () => {
      rememberScroll()
      scrollElement.removeEventListener('scroll', rememberScroll)
      scrollElementRef.current = null
      editor.destroy()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const scrollElement = scrollElementRef.current ?? editor.scrollDOM

    const sessionChanged = currentSessionIdRef.current !== editorSessionId
    const noteRenamed = !sessionChanged && currentNoteKeyRef.current !== noteKey
    if (noteRenamed) {
      renameEditorViewState(currentNoteKeyRef.current, noteKey)
      currentNoteKeyRef.current = noteKey
    }
    if (sessionChanged) {
      rememberEditorViewState(
        currentNoteKeyRef.current,
        editor.state,
        scrollElement.scrollTop,
      )
      currentSessionIdRef.current = editorSessionId
      currentNoteKeyRef.current = noteKey
      editor.dispatch({
        effects: historyCompartmentRef.current.reconfigure([]),
      })
    }

    const documentChanged = editor.state.doc.toString() !== value
    if (documentChanged || sessionChanged) {
      const recalled = sessionChanged
        ? recallEditorViewState(noteKey, value.length)
        : null
      const changes = documentChanged
        ? diffTextChanges(editor.state.doc.toString(), value)
        : []
      const resetHistory = documentChanged && changes === null && !sessionChanged
      editor.dispatch({
        annotations: [
          externalSync.of(true),
          Transaction.addToHistory.of(false),
        ],
        changes: documentChanged
          ? changes ?? { from: 0, to: editor.state.doc.length, insert: value }
          : undefined,
        effects: sessionChanged || resetHistory
          ? [
              historyCompartmentRef.current.reconfigure([]),
              historyCompartmentRef.current.reconfigure(history()),
              ...(sessionChanged
                ? [livePreviewCompartmentRef.current.reconfigure(
                    livePreview((target) => resolveWikiLinkRef.current(target)),
                  )]
                : []),
            ]
          : undefined,
        selection: sessionChanged
          ? recalled?.selection ?? { anchor: 0 }
          : undefined,
      })
      if (sessionChanged) {
        const scrollTop = recalled?.scrollTop ?? 0
        editor.requestMeasure({
          read: () => null,
          write: () => {
            scrollElement.scrollTop = scrollTop
            rememberEditorViewState(noteKey, editor.state, scrollTop)
          },
        })
      }
    }
  }, [editorSessionId, noteKey, value])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.dispatch({
      effects: contentAttributesCompartmentRef.current.reconfigure(
        editorContentAttributes(spellcheckEnabled),
      ),
    })
  }, [spellcheckEnabled])

  return <div className="markdown-editor" ref={containerRef} />
})
