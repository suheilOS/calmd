import { forceParsing, syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import {
  Decoration,
  type DecorationSet,
  Direction,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import {
  parseWikiLinkText,
  selectionTouchesSourceRange,
  wikiLinkHiddenSyntaxRanges,
} from '../wikiLinks'
import { tableLiveEditor } from './tableLiveEditor'

type SourceRange = { from: number; to: number }

type DelimiterRule = {
  mark: string
  parents: readonly string[]
}

const delimiterRules: readonly DelimiterRule[] = [
  { mark: 'EmphasisMark', parents: ['Emphasis', 'StrongEmphasis'] },
  { mark: 'StrikethroughMark', parents: ['Strikethrough'] },
  { mark: 'CodeMark', parents: ['InlineCode'] },
]

const reconcileAfterDrag = StateEffect.define<null>()

class ThematicBreakWidget extends WidgetType {
  toDOM(view: EditorView) {
    const rule = view.dom.ownerDocument.createElement('span')
    rule.className = 'cm-thematic-break'
    rule.setAttribute('aria-hidden', 'true')
    return rule
  }

  eq() {
    return true
  }
}

class ListMarkerWidget extends WidgetType {
  private readonly label: string

  constructor(label: string) {
    super()
    this.label = label
  }

  toDOM(view: EditorView) {
    const marker = view.dom.ownerDocument.createElement('span')
    marker.className = 'cm-list-marker'
    marker.dir = 'ltr'
    marker.textContent = this.label
    marker.style.width = `${Math.max(1, this.label.length)}ch`
    marker.setAttribute('aria-hidden', 'true')
    return marker
  }

  eq(other: ListMarkerWidget) {
    return this.label === other.label
  }
}

class CalloutPreviewWidget extends WidgetType {
  private readonly body: string
  private readonly from: number
  private readonly title: string

  constructor(from: number, title: string, body: string) {
    super()
    this.body = body
    this.from = from
    this.title = title
  }

  toDOM(view: EditorView) {
    const callout = view.dom.ownerDocument.createElement('aside')
    callout.className = 'cm-callout-preview'
    callout.dir = 'auto'
    callout.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    })
    const title = view.dom.ownerDocument.createElement('div')
    title.className = 'cm-callout-title'
    title.dir = 'auto'
    title.textContent = this.title
    callout.append(title)
    if (this.body) {
      const body = view.dom.ownerDocument.createElement('div')
      body.className = 'cm-callout-body'
      for (const text of this.body.split('\n')) {
        const line = view.dom.ownerDocument.createElement('div')
        line.className = 'cm-callout-body-line'
        line.dir = 'auto'
        line.textContent = text
        body.append(line)
      }
      callout.append(body)
    }
    return callout
  }

  eq(other: CalloutPreviewWidget) {
    return this.from === other.from && this.title === other.title && this.body === other.body
  }
}

class TaskMarkerWidget extends WidgetType {
  private readonly from: number
  private readonly to: number
  private readonly checked: boolean

  constructor(
    from: number,
    to: number,
    checked: boolean,
  ) {
    super()
    this.from = from
    this.to = to
    this.checked = checked
  }

  toDOM(view: EditorView) {
    const document = view.dom.ownerDocument
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-task-marker'
    wrapper.dir = 'ltr'
    wrapper.style.width = '1.15em'
    const checkbox = document.createElement('input')
    checkbox.className = 'cm-task-checkbox'
    checkbox.type = 'checkbox'
    checkbox.checked = this.checked
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task incomplete' : 'Mark task complete')
    checkbox.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
    })
    checkbox.addEventListener('click', (event) => {
      event.stopPropagation()
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: this.checked ? '[ ]' : '[x]',
        },
        userEvent: 'input',
      })
      view.focus()
    })
    wrapper.append(checkbox)
    return wrapper
  }

  eq(other: TaskMarkerWidget) {
    return this.from === other.from
      && this.to === other.to
      && this.checked === other.checked
  }
}

function selectionsTouch(view: EditorView, range: SourceRange) {
  return view.state.selection.ranges.some((selection) =>
    selectionTouchesSourceRange(selection, range),
  )
}

function owningLineIsActive(view: EditorView, position: number) {
  const line = view.state.doc.lineAt(position)
  return selectionsTouch(view, { from: line.from, to: line.to })
}

function childRanges(node: { node: SyntaxNode }) {
  const children: { name: string; from: number; to: number; node: SyntaxNode }[] = []
  const cursor = node.node.cursor()
  if (cursor.firstChild()) {
    do {
      children.push({ name: cursor.name, from: cursor.from, to: cursor.to, node: cursor.node })
    } while (cursor.nextSibling())
  }
  return children
}

function calloutContent(state: EditorState, blockquote: SyntaxNode) {
  const lines = state.sliceDoc(blockquote.from, blockquote.to).split('\n')
  const first = lines[0]?.match(/^\s*>\s*\[!([\w-]+)\][+-]?(?:\s+(.*))?$/u)
  if (!first) return null
  const type = first[1]
  const title = first[2]?.trim() || `${type[0]?.toUpperCase() ?? ''}${type.slice(1)}`
  const body = lines.slice(1)
    .map((line) => line.replace(/^\s*>\s?/u, ''))
    .join('\n')
    .trim()
  return { body, title }
}

function blockPreviewDecorations(state: EditorState) {
  const decorations: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter(node) {
      const active = state.selection.ranges.some((selection) =>
        selectionTouchesSourceRange(selection, node),
      )
      if (active) return

      if (node.name === 'Blockquote') {
        const callout = calloutContent(state, node.node)
        if (callout) {
          decorations.push(Decoration.replace({
            block: true,
            widget: new CalloutPreviewWidget(node.from, callout.title, callout.body),
          }).range(node.from, node.to))
          return false
        }
      }
    },
  })
  return Decoration.set(decorations, true)
}

const blockPreviewField = StateField.define<DecorationSet>({
  create: blockPreviewDecorations,
  update(decorations, transaction) {
    const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    return transaction.docChanged || transaction.selection || treeChanged
      ? blockPreviewDecorations(transaction.state)
      : decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})

function headingLevel(name: string) {
  const match = name.match(/^ATXHeading([1-6])$/)
  return match?.[1] ?? null
}

function decorationRanges(view: EditorView) {
  const ranges = [
    ...view.visibleRanges,
    ...view.state.selection.ranges.map((selection) => {
      const first = view.state.doc.lineAt(selection.from)
      const last = view.state.doc.lineAt(selection.to)
      return { from: first.from, to: last.to }
    }),
  ].sort((left, right) => left.from - right.from || left.to - right.to)

  const merged: SourceRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

function parseTarget(view: EditorView) {
  const relevantEnd = decorationRanges(view).at(-1)?.to ?? 0
  return Math.min(view.state.doc.length, relevantEnd + 2_000)
}

function livePreviewDecorations(
  view: EditorView,
  resolvedTargets: ReadonlyMap<string, boolean | null>,
) {
  const decorations: Range<Decoration>[] = []
  const bidiIsolates: Range<Decoration>[] = []
  const ranges = decorationRanges(view)

  for (const visible of ranges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter: (node) => {
        const parent = node.node.parent

        if (node.name === 'WikiLink') {
          const parsed = parseWikiLinkText(view.state.sliceDoc(node.from, node.to))
          const missing = parsed && resolvedTargets.get(parsed.target) === false
          const link = Decoration.mark({
            attributes: { dir: 'auto' },
            bidiIsolate: null,
            class: missing ? 'cm-wiki-link cm-wiki-link-missing' : 'cm-wiki-link',
          }).range(node.from, node.to)
          decorations.push(link)
          bidiIsolates.push(link)
          for (const range of wikiLinkHiddenSyntaxRanges(
            node,
            childRanges(node),
            view.state.selection.ranges,
          )) {
            decorations.push(Decoration.replace({}).range(range.from, range.to))
          }
          return
        }

        const delimiterRule = delimiterRules.find((rule) =>
          rule.mark === node.name && parent && rule.parents.includes(parent.name),
        )
        if (delimiterRule && parent && !selectionsTouch(view, parent)) {
          decorations.push(Decoration.replace({}).range(node.from, node.to))
          return
        }

        if (node.name === 'InlineCode' || node.name === 'URL') {
          const codeOrUrl = Decoration.mark({
            attributes: {
              dir: 'ltr',
              spellcheck: 'false',
            },
            bidiIsolate: Direction.LTR,
            class: node.name === 'InlineCode' ? 'cm-inline-code' : 'cm-url',
          }).range(node.from, node.to)
          decorations.push(codeOrUrl)
          bidiIsolates.push(codeOrUrl)
        }

        if (node.name === 'Highlight') {
          const marks = childRanges(node).filter((child) => child.name === 'HighlightMark')
          if (marks.length >= 2) {
            const first = marks[0]
            const last = marks[marks.length - 1]
            decorations.push(Decoration.mark({ class: 'cm-highlight' }).range(
              first.to,
              last.from,
            ))
            if (!selectionsTouch(view, node)) {
              decorations.push(Decoration.replace({}).range(first.from, first.to))
              decorations.push(Decoration.replace({}).range(last.from, last.to))
            }
          }
          return
        }

        if (node.name === 'Link') {
          const link = Decoration.mark({
            attributes: { dir: 'auto' },
            bidiIsolate: null,
            class: 'cm-link',
          }).range(node.from, node.to)
          decorations.push(link)
          bidiIsolates.push(link)
          if (selectionsTouch(view, node)) return
          const marks = childRanges(node).filter((child) => child.name === 'LinkMark')
          if (marks.length >= 4) {
            decorations.push(Decoration.replace({}).range(marks[0].from, marks[0].to))
            decorations.push(Decoration.replace({}).range(
              marks[1].from,
              marks[marks.length - 1].to,
            ))
          }
          return
        }

        if (node.name === 'Escape' && !selectionsTouch(view, node)) {
          decorations.push(Decoration.replace({}).range(node.from, node.from + 1))
          return
        }

        if (node.name === 'HeaderMark') {
          const heading = parent
          if (!heading) return
          const level = headingLevel(heading.name)
          if (level) {
            decorations.push(Decoration.line({
              class: `cm-heading-line cm-heading-line-${level}`,
            }).range(view.state.doc.lineAt(node.from).from))
          }
          const active = level
            ? owningLineIsActive(view, node.from)
            : selectionsTouch(view, heading)
          if (!active) {
            let prefixEnd = node.to
            const line = view.state.doc.lineAt(node.from)
            while (
              prefixEnd < line.to
              && /[\t ]/.test(view.state.sliceDoc(prefixEnd, prefixEnd + 1))
            ) {
              prefixEnd += 1
            }
            decorations.push(Decoration.replace({}).range(node.from, prefixEnd))
          } else if (level) {
            let prefixEnd = node.to
            const line = view.state.doc.lineAt(node.from)
            while (
              prefixEnd < line.to
              && /[\t ]/.test(view.state.sliceDoc(prefixEnd, prefixEnd + 1))
            ) {
              prefixEnd += 1
            }
            decorations.push(Decoration.mark({
              class: `cm-heading-source cm-heading-source-${level}`,
            }).range(node.from, prefixEnd))
          }
          return
        }

        if (node.name === 'Blockquote') {
          const lines = new Set<number>()
          for (const range of ranges) {
            const from = Math.max(node.from, range.from)
            const to = Math.min(node.to, range.to)
            if (from > to) continue
            const firstLine = view.state.doc.lineAt(from).number
            const lastLine = view.state.doc.lineAt(Math.max(from, to - 1)).number
            for (let number = firstLine; number <= lastLine; number += 1) {
              lines.add(number)
            }
          }
          for (const number of lines) {
            decorations.push(Decoration.line({ class: 'cm-quote-line' }).range(
              view.state.doc.line(number).from,
            ))
          }
          return
        }

        if (node.name === 'QuoteMark') {
          const spaced = /[\t ]/.test(view.state.sliceDoc(node.to, node.to + 1))
          if (spaced) {
            decorations.push(Decoration.line({ class: 'cm-quote-prefix-line' }).range(
              view.state.doc.lineAt(node.from).from,
            ))
          }
          if (spaced && !owningLineIsActive(view, node.from)) {
            decorations.push(Decoration.mark({ class: 'cm-quote-marker' }).range(
              node.from,
              node.to,
            ))
          }
          return
        }

        if (node.name === 'ListItem' && !owningLineIsActive(view, node.from)) {
          const children = childRanges(node)
          const listMark = children.find((child) => child.name === 'ListMark')
          const task = children.find((child) => child.name === 'Task')
          if (listMark && task) {
            const taskMarker = childRanges({ node: task.node })
              .find((child) => child.name === 'TaskMarker')
            if (taskMarker) {
              const checked = /[xX]/.test(view.state.sliceDoc(taskMarker.from, taskMarker.to))
              decorations.push(Decoration.replace({
                widget: new TaskMarkerWidget(
                  taskMarker.from,
                  taskMarker.to,
                  checked,
                ),
              }).range(listMark.from, taskMarker.to))
              return false
            }
          }
        }

        if (node.name === 'ListMark') {
          if (owningLineIsActive(view, node.from)) return
          const source = view.state.sliceDoc(node.from, node.to)
          decorations.push(Decoration.replace({
            widget: new ListMarkerWidget(/^\d/.test(source) ? source : '•'),
          }).range(node.from, node.to))
          return
        }

        if (node.name === 'FencedCode') {
          const active = selectionsTouch(view, node)
          const lines = new Set<number>()
          const firstCodeLine = view.state.doc.lineAt(node.from).number
          const lastCodeLine = view.state.doc.lineAt(Math.max(node.from, node.to - 1)).number
          for (const range of ranges) {
            const from = Math.max(node.from, range.from)
            const to = Math.min(node.to, range.to)
            if (from > to) continue
            const firstLine = view.state.doc.lineAt(from).number
            const lastLine = view.state.doc.lineAt(Math.max(from, to - 1)).number
            for (let number = firstLine; number <= lastLine; number += 1) {
              lines.add(view.state.doc.line(number).from)
            }
          }
          for (const from of lines) {
            const lineNumber = view.state.doc.lineAt(from).number
            decorations.push(Decoration.line({
              attributes: { spellcheck: 'false' },
              class: [
                'cm-fenced-code-line',
                lineNumber === firstCodeLine ? 'cm-fenced-code-first-line' : '',
                lineNumber === lastCodeLine ? 'cm-fenced-code-last-line' : '',
              ].filter(Boolean).join(' '),
            }).range(from))
          }
          if (!active) {
            for (const child of childRanges(node)) {
              if (child.name === 'CodeMark') {
                decorations.push(Decoration.replace({}).range(child.from, child.to))
                continue
              }
              if (child.name === 'CodeInfo') {
                const info = view.state.sliceDoc(child.from, child.to)
                const language = /^\S+/.exec(info)?.[0]
                if (!language) {
                  decorations.push(Decoration.replace({}).range(child.from, child.to))
                  continue
                }
                const languageEnd = child.from + language.length
                decorations.push(Decoration.mark({
                  class: 'cm-code-language',
                }).range(child.from, languageEnd))
                if (languageEnd < child.to) {
                  decorations.push(Decoration.replace({}).range(languageEnd, child.to))
                }
              }
            }
          }
          return
        }

        if (node.name === 'HorizontalRule' && !owningLineIsActive(view, node.from)) {
          decorations.push(Decoration.replace({
            widget: new ThematicBreakWidget(),
          }).range(node.from, node.to))
        }
      },
    })
  }

  return {
    bidiIsolates: Decoration.set(bidiIsolates, true),
    decorations: Decoration.set(decorations, true),
  }
}

function wikiLinkTargets(view: EditorView) {
  const targets = new Set<string>()
  for (const range of decorationRanges(view)) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (node.name !== 'WikiLink') return
        const parsed = parseWikiLinkText(view.state.sliceDoc(node.from, node.to))
        if (parsed) targets.add(parsed.target)
      },
    })
  }
  return targets
}

/** Calmd's complete source-visibility policy for the Markdown editing surface. */
export function livePreview(
  resolveWikiLink: (target: string) => Promise<boolean | null>,
) {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    bidiIsolates: DecorationSet = Decoration.none
    private active = true
    private dragging = false
    private parseFrame: number | null = null
    private parseIdle: number | null = null
    private readonly pendingTargets = new Set<string>()
    private readonly resolvedTargets = new Map<string, boolean | null>()
    private wantedTargets = new Set<string>()
    private readonly view: EditorView
    private readonly window: Window

    constructor(view: EditorView) {
      this.view = view
      this.window = view.dom.ownerDocument.defaultView ?? window
      this.rebuildDecorations(view)
      view.dom.addEventListener('pointerdown', this.startDrag)
      this.window.addEventListener('pointerup', this.finishDrag)
      this.window.addEventListener('pointercancel', this.finishDrag)
      this.window.addEventListener('blur', this.finishDrag)
      this.resolveTargets(view)
      this.scheduleParse(view)
      this.scheduleFullParse(view)
    }

    update(update: ViewUpdate) {
      const resolutionChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(wikiLinkResolutionChanged)),
      )
      const dragFinished = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(reconcileAfterDrag)),
      )
      const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
      if (update.docChanged || update.viewportChanged || treeChanged) {
        this.resolveTargets(update.view)
      }
      if (update.docChanged) this.scheduleFullParse(update.view)

      if (
        update.docChanged
        || update.viewportChanged
        || resolutionChanged
        || treeChanged
        || dragFinished
        || (update.selectionSet && !this.dragging)
      ) {
        this.rebuildDecorations(update.view)
      }
      if (
        update.docChanged
        || update.viewportChanged
        || treeChanged
        || dragFinished
        || (update.selectionSet && !this.dragging)
      ) {
        this.scheduleParse(update.view)
      }
    }

    destroy() {
      this.active = false
      this.view.dom.removeEventListener('pointerdown', this.startDrag)
      this.window.removeEventListener('pointerup', this.finishDrag)
      this.window.removeEventListener('pointercancel', this.finishDrag)
      this.window.removeEventListener('blur', this.finishDrag)
      if (this.parseFrame !== null) this.window.cancelAnimationFrame(this.parseFrame)
      if (this.parseIdle !== null) this.window.clearTimeout(this.parseIdle)
      this.view.dom.classList.remove('cm-live-preview-pending')
    }

    private readonly startDrag = (event: Event) => {
      if (event instanceof PointerEvent && event.button === 0) this.dragging = true
    }

    private readonly finishDrag = () => {
      if (!this.dragging || !this.active) return
      this.dragging = false
      this.view.dispatch({ effects: reconcileAfterDrag.of(null) })
    }

    private rebuildDecorations(view: EditorView) {
      const built = livePreviewDecorations(view, this.resolvedTargets)
      this.decorations = built.decorations
      this.bidiIsolates = built.bidiIsolates
    }

    private scheduleParse(view: EditorView) {
      const target = parseTarget(view)
      if (this.parseFrame !== null) {
        if (!syntaxTreeAvailable(view.state, target)) {
          view.dom.classList.add('cm-live-preview-pending')
        }
        return
      }
      if (!syntaxTreeAvailable(view.state, target)) {
        view.dom.classList.add('cm-live-preview-pending')
      }
      this.parseFrame = this.window.requestAnimationFrame(() => {
        this.parseFrame = null
        if (!this.active) return
        forceParsing(view, target, 50)
        const latestTarget = parseTarget(view)
        if (syntaxTreeAvailable(view.state, latestTarget)) {
          view.dom.classList.remove('cm-live-preview-pending')
        } else {
          view.dom.classList.add('cm-live-preview-pending')
          this.scheduleParse(view)
        }
      })
    }

    private scheduleFullParse(view: EditorView) {
      if (this.parseIdle !== null) this.window.clearTimeout(this.parseIdle)
      this.parseIdle = this.window.setTimeout(() => {
        this.parseIdle = null
        if (!this.active || syntaxTreeAvailable(view.state, view.state.doc.length)) return
        forceParsing(view, view.state.doc.length, 25)
        if (!syntaxTreeAvailable(view.state, view.state.doc.length)) {
          this.scheduleFullParse(view)
        }
      }, 250)
    }

    private resolveTargets(view: EditorView) {
      this.wantedTargets = wikiLinkTargets(view)
      for (const target of this.wantedTargets) {
        if (this.resolvedTargets.has(target) || this.pendingTargets.has(target)) continue
        this.pendingTargets.add(target)
        void resolveWikiLink(target).then(
          (exists) => this.finishTarget(target, exists),
          () => this.finishTarget(target, null),
        )
      }
    }

    private finishTarget(target: string, exists: boolean | null) {
      if (!this.active) return
      this.pendingTargets.delete(target)
      this.resolvedTargets.set(target, exists)
      if (this.wantedTargets.has(target)) {
        this.view.dispatch({ effects: wikiLinkResolutionChanged.of(null) })
      }
    }
  }, {
    decorations: (plugin) => plugin.decorations,
  })

  return [
    tableLiveEditor,
    blockPreviewField,
    plugin,
    EditorView.bidiIsolatedRanges.of((view) =>
      view.plugin(plugin)?.bidiIsolates ?? Decoration.none,
    ),
  ]
}

const wikiLinkResolutionChanged = StateEffect.define<null>()
