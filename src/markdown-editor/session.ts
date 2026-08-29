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
  Decoration,
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
import {
  importAttachmentBytes,
  pickAttachment,
  readClipboardImageFile,
  resolveLocalImage,
} from '../images'
import { navigationPlatform, isPrimaryNavigationClick } from '../navigation'
import type { NotePreviewCandidate } from '../notePreview'
import { diffTextChanges } from '../threeWayTextMerge'
import {
  canonicalResolvedWikiLink,
  parseWikiLinkText,
  validateWikiLinkOccurrence,
  wikiLinkMarkdown,
} from '../wikiLinks'
import type {
  FormattingToolbarSnapshot,
  MarkdownEditorCommands,
  MarkdownEditorInput,
  MarkdownInlineFormat,
  WikiLinkActivation,
} from './contracts'
import { insertNewlineContinueBlockquote } from './markdownBlockquote'
import { setMarkdownBlock } from './markdownBlockCommands'
import {
  recallEditorViewState,
  rememberEditorViewState,
  renameEditorViewState,
} from './editorViewState'
import { markdownHighlight } from './markdownHighlight'
import { toggleInlineFormat } from './markdownCommands'
import {
  imagePaste,
  insertImportedImage,
  trackedImageInsertion,
} from './imageInsertion'
import { imageLivePreview } from './imageLivePreview'
import { livePreview } from './livePreview'
import { activateExternalLink as activateExternalUrl } from './externalLinks'
import { wikiLinkCompletion } from './wikiLinkCompletion'
import { selectionToolbar } from './selectionToolbar'

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
  onExternalLinkError: (error: unknown) => void,
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
      const position = view.posAtDOM(event.target as Node)
      return activateExternalUrl(
        view.state,
        position,
        event,
        onPreviewDismiss,
        openUrl,
        onExternalLinkError,
      )
    }

    activateWikiLink(view: EditorView, event: MouseEvent) {
      if (!isPrimaryNavigationClick(navigationPlatform(), event)) return false
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

const automaticDirectionLine = Decoration.line({ attributes: { dir: 'auto' } })

const markdownLineDirection = [
  EditorView.perLineTextDirection.of(true),
  EditorView.decorations.of((view) => {
    const lineStarts = new Set<number>()
    for (const range of view.visibleRanges) {
      let line = view.state.doc.lineAt(range.from)
      while (true) {
        lineStarts.add(line.from)
        if (line.to >= range.to || line.number === view.state.doc.lines) break
        line = view.state.doc.line(line.number + 1)
      }
    }
    return Decoration.set(
      [...lineStarts].map((from) => automaticDirectionLine.range(from)),
      true,
    )
  }),
]

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
    { key: 'Mod-b', run: toggleInlineFormat('bold') },
    { key: 'Mod-i', run: toggleInlineFormat('italic') },
    { key: 'Mod-Shift-h', run: toggleInlineFormat('highlight') },
    { key: 'Mod-k', run: toggleInlineFormat('link') },
    { key: 'Mod-`', run: toggleInlineFormat('code') },
    { key: 'Mod-Shift-x', run: toggleInlineFormat('strikethrough') },
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
  markdownLineDirection,
  placeholder('Start writing…'),
  editorTheme,
  markdownBackgroundLayer,
]

export type MarkdownEditorSession = {
  readonly commands: MarkdownEditorCommands
  update: (input: MarkdownEditorInput) => void
  destroy: () => void
}

export type MarkdownEditorSessionInput = MarkdownEditorInput & {
  onFormattingToolbarChange?: (snapshot: FormattingToolbarSnapshot | null) => void
  onFormattingToolbarFocusRequest?: () => void
}

class CodeMirrorDocumentSession implements MarkdownEditorSession {
  private input: MarkdownEditorInput
  private readonly editor: EditorView
  private readonly scrollElement: HTMLElement
  private currentSessionId: number
  private currentNoteKey: string
  private spellcheckEnabled: boolean
  private destroyed = false
  private readonly historyCompartment = new Compartment()
  private readonly contentAttributesCompartment = new Compartment()
  private readonly imageInsertionCompartment = new Compartment()
  private readonly imagePreviewCompartment = new Compartment()
  private readonly livePreviewCompartment = new Compartment()
  private readonly onFormattingToolbarChange: (
    snapshot: FormattingToolbarSnapshot | null,
  ) => void

  readonly commands: MarkdownEditorCommands = {
    applyBlock: (kind) => {
      setMarkdownBlock(kind)({
        state: this.editor.state,
        dispatch: (transaction) => this.editor.dispatch(transaction),
      })
      this.editor.focus()
    },
    focus: () => {
      this.editor.focus()
    },
    focusAtEnd: () => {
      this.editor.dispatch({ selection: { anchor: this.editor.state.doc.length } })
      this.editor.focus()
    },
    insertImage: () => {
      insertImportedImage(
        this.editor,
        pickAttachment(this.currentNoteKey),
        (error) => this.input.onImageError?.(error),
      )
    },
    toggleInline: (format: MarkdownInlineFormat) => {
      toggleInlineFormat(format)({
        state: this.editor.state,
        dispatch: (transaction) => this.editor.dispatch(transaction),
      })
      this.editor.focus()
    },
  }

  constructor(parent: HTMLElement, input: MarkdownEditorSessionInput) {
    this.input = input
    this.currentSessionId = input.editorSessionId
    this.currentNoteKey = input.noteKey
    this.spellcheckEnabled = input.spellcheckEnabled
    this.onFormattingToolbarChange = input.onFormattingToolbarChange ?? (() => {})

    const recalled = recallEditorViewState(input.noteKey, input.value.length)
    this.editor = new EditorView({
      doc: input.value,
      selection: recalled?.selection ?? { anchor: input.value.length },
      extensions: [
        editorExtensions,
        selectionToolbar({
          onChange: this.onFormattingToolbarChange,
          onFocusRequest: input.onFormattingToolbarFocusRequest ?? (() => {}),
        }),
        this.historyCompartment.of(history()),
        this.imageInsertionCompartment.of(this.imageInsertion(input.noteKey)),
        this.contentAttributesCompartment.of(
          editorContentAttributes(input.spellcheckEnabled),
        ),
        this.imagePreviewCompartment.of(this.imagePreview(input.noteKey)),
        this.livePreviewCompartment.of(this.livePreview()),
        autocompletion({
          activateOnTyping: true,
          icons: false,
          maxRenderedOptions: 8,
          override: [wikiLinkCompletion((query) => this.input.suggestWikiLinks(query))],
        }),
        linkInteraction(
          (activation) => this.input.onWikiLinkActivate(activation),
          (candidate) => this.input.onPreviewCandidateEnter(candidate),
          () => this.input.onPreviewCandidateLeave(),
          () => this.input.onPreviewDismiss(),
          (error) => this.input.onExternalLinkError?.(error),
        ),
        EditorView.updateListener.of((update) => {
          const isExternalSync = update.transactions.some((transaction) =>
            transaction.annotation(externalSync),
          )
          if (update.docChanged && !isExternalSync) {
            this.input.onChange(update.state.doc.toString())
          }
          if (update.selectionSet || update.docChanged) {
            rememberEditorViewState(
              this.currentNoteKey,
              update.state,
              this.scrollElement?.scrollTop ?? update.view.scrollDOM.scrollTop,
            )
          }
        }),
      ],
      parent,
    })

    this.scrollElement = this.editor.dom.closest<HTMLElement>('.app-scroll-container')
      ?? this.editor.scrollDOM
    if (recalled) this.scrollElement.scrollTop = recalled.scrollTop
    this.scrollElement.addEventListener('scroll', this.rememberScroll, { passive: true })
    this.editor.focus()
  }

  update(input: MarkdownEditorInput) {
    if (this.destroyed) return
    this.input = input

    const sessionChanged = this.currentSessionId !== input.editorSessionId
    const noteRenamed = !sessionChanged && this.currentNoteKey !== input.noteKey
    if (noteRenamed) {
      renameEditorViewState(this.currentNoteKey, input.noteKey)
      this.currentNoteKey = input.noteKey
      this.editor.dispatch({
        effects: this.imagePreviewCompartment.reconfigure(this.imagePreview(input.noteKey)),
      })
    }
    if (sessionChanged) {
      this.onFormattingToolbarChange(null)
      this.rememberScroll()
      this.currentSessionId = input.editorSessionId
      this.currentNoteKey = input.noteKey
      this.editor.dispatch({ effects: this.historyCompartment.reconfigure([]) })
    }

    const documentChanged = this.editor.state.doc.toString() !== input.value
    if (documentChanged || sessionChanged) {
      const recalled = sessionChanged
        ? recallEditorViewState(input.noteKey, input.value.length)
        : null
      const changes = documentChanged
        ? diffTextChanges(this.editor.state.doc.toString(), input.value)
        : []
      const resetHistory = documentChanged && changes === null && !sessionChanged
      this.editor.dispatch({
        annotations: [externalSync.of(true), Transaction.addToHistory.of(false)],
        changes: documentChanged
          ? changes ?? { from: 0, to: this.editor.state.doc.length, insert: input.value }
          : undefined,
        effects: sessionChanged || resetHistory
          ? [
              this.historyCompartment.reconfigure([]),
              this.historyCompartment.reconfigure(history()),
              ...(sessionChanged
                ? [
                    this.imageInsertionCompartment.reconfigure(
                      this.imageInsertion(input.noteKey),
                    ),
                    this.imagePreviewCompartment.reconfigure(
                      this.imagePreview(input.noteKey),
                    ),
                    this.livePreviewCompartment.reconfigure(this.livePreview()),
                  ]
                : []),
            ]
          : undefined,
        selection: sessionChanged ? recalled?.selection ?? { anchor: 0 } : undefined,
      })
      if (sessionChanged) this.restoreScroll(input.noteKey, recalled?.scrollTop ?? 0)
    }

    if (this.spellcheckEnabled !== input.spellcheckEnabled) {
      this.spellcheckEnabled = input.spellcheckEnabled
      this.editor.dispatch({
        effects: this.contentAttributesCompartment.reconfigure(
          editorContentAttributes(input.spellcheckEnabled),
        ),
      })
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.rememberScroll()
    this.scrollElement.removeEventListener('scroll', this.rememberScroll)
    this.editor.destroy()
  }

  private readonly rememberScroll = () => {
    rememberEditorViewState(
      this.currentNoteKey,
      this.editor.state,
      this.scrollElement.scrollTop,
    )
  }

  private imageInsertion(noteKey: string) {
    return [
      trackedImageInsertion,
      imagePaste(
        (file) => importAttachmentBytes(noteKey, file),
        readClipboardImageFile,
        (error) => this.input.onImageError?.(error),
      ),
    ]
  }

  private imagePreview(noteKey: string) {
    return imageLivePreview(
      (destination) => this.input.resolveImage?.(destination)
        ?? resolveLocalImage(noteKey, destination),
    )
  }

  private livePreview() {
    return livePreview((target) => this.input.resolveWikiLink(target))
  }

  private restoreScroll(noteKey: string, scrollTop: number) {
    this.editor.requestMeasure({
      read: () => null,
      write: () => {
        this.scrollElement.scrollTop = scrollTop
        rememberEditorViewState(noteKey, this.editor.state, scrollTop)
      },
    })
  }
}

/** Creates one CodeMirror document session with no React lifecycle dependency. */
export function createMarkdownEditorSession(
  parent: HTMLElement,
  input: MarkdownEditorSessionInput,
): MarkdownEditorSession {
  return new CodeMirrorDocumentSession(parent, input)
}
