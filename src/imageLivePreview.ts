import { syntaxTree } from '@codemirror/language'
import { StateEffect, type Range } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import type { DisplayImage } from './images'
import {
  classifyLocalImageDestination,
  parseInlineImageSyntax,
  type InlineImageSyntax,
} from './markdownImages'
import { selectionTouchesSourceRange } from './wikiLinks'

type ImageRange = InlineImageSyntax & {
  from: number
  to: number
  destination: string
  block: boolean
}

type Resolution =
  | { status: 'resolved'; image: DisplayImage }
  | { status: 'missing' }

const imageResolutionChanged = StateEffect.define<null>()

function imageChildren(node: SyntaxNode) {
  const children: { name: string; from: number; to: number }[] = []
  const cursor = node.cursor()
  if (cursor.firstChild()) {
    do {
      children.push({ name: cursor.name, from: cursor.from, to: cursor.to })
    } while (cursor.nextSibling())
  }
  return children
}

function parsedImage(view: EditorView, node: { from: number; to: number; node: SyntaxNode }) {
  const parsed = parseInlineImageSyntax(
    view.state.sliceDoc(node.from, node.to),
    imageChildren(node.node),
    node.from,
  )
  if (!parsed) return null
  const local = classifyLocalImageDestination(parsed.destination)
  if (!local) return null
  const line = view.state.doc.lineAt(node.from)
  const before = view.state.sliceDoc(line.from, node.from)
  const after = view.state.sliceDoc(node.to, line.to)
  return {
    ...parsed,
    from: node.from,
    to: node.to,
    destination: local.destination,
    block: before.trim().length === 0 && after.trim().length === 0,
  } satisfies ImageRange
}

function visibleImages(view: EditorView) {
  const images: ImageRange[] = []
  for (const visible of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'Image') return
        const image = parsedImage(view, node)
        if (image) images.push(image)
      },
    })
  }
  return images
}

function imageIsActive(view: EditorView, image: ImageRange) {
  return view.state.selection.ranges.some((selection) =>
    selectionTouchesSourceRange(selection, image),
  )
}

function widthKey(image: DisplayImage, availableWidth: number) {
  return `${image.revision}:${Math.round(availableWidth)}`
}

class ImageWidget extends WidgetType {
  private readonly range: ImageRange
  private readonly resolution: Resolution
  private readonly availableWidth: number
  private readonly settledHeights: Map<string, number>

  constructor(
    range: ImageRange,
    resolution: Resolution,
    availableWidth: number,
    settledHeights: Map<string, number>,
  ) {
    super()
    this.range = range
    this.resolution = resolution
    this.availableWidth = availableWidth
    this.settledHeights = settledHeights
  }

  get estimatedHeight() {
    if (this.resolution.status !== 'resolved') return 32
    const key = widthKey(this.resolution.image, this.availableWidth)
    const cached = this.settledHeights.get(key)
    if (cached !== undefined) return cached
    const width = Math.min(this.availableWidth, this.resolution.image.width)
    return width * this.resolution.image.height / this.resolution.image.width
  }

  eq(other: ImageWidget) {
    if (
      this.range.from !== other.range.from
      || this.range.to !== other.range.to
      || this.range.alt !== other.range.alt
      || this.range.block !== other.range.block
      || this.resolution.status !== other.resolution.status
    ) return false
    return this.resolution.status === 'missing'
      || (other.resolution.status === 'resolved'
        && this.resolution.image.revision === other.resolution.image.revision
        && this.availableWidth === other.availableWidth)
  }

  toDOM(view: EditorView) {
    const document = view.dom.ownerDocument
    const wrapper = document.createElement('span')
    wrapper.className = this.range.block ? 'cm-image cm-image-block' : 'cm-image cm-image-inline'
    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dom.ownerDocument.defaultView?.setTimeout(() => {
        view.dispatch({ selection: { anchor: this.range.from, head: this.range.to } })
        view.focus()
      }, 0)
    })

    if (this.resolution.status === 'missing') {
      wrapper.classList.add('cm-image-unavailable')
      wrapper.setAttribute('role', 'img')
      wrapper.setAttribute('aria-label', this.range.alt
        ? `Image unavailable: ${this.range.alt}`
        : 'Image unavailable')
      wrapper.textContent = this.range.alt || 'Image unavailable'
      return wrapper
    }

    const resolvedImage = this.resolution.image
    const image = document.createElement('img')
    image.alt = this.range.alt
    image.decoding = 'async'
    image.draggable = false
    image.src = resolvedImage.assetUrl
    image.style.aspectRatio = `${resolvedImage.width} / ${resolvedImage.height}`
    const settled = () => {
      const height = wrapper.getBoundingClientRect().height
      if (height > 0) {
        this.settledHeights.set(
          widthKey(resolvedImage, this.availableWidth),
          height,
        )
      }
      view.requestMeasure()
    }
    image.addEventListener('load', settled, { once: true })
    image.addEventListener('error', () => {
      wrapper.classList.add('cm-image-unavailable')
      image.remove()
      wrapper.setAttribute('role', 'img')
      wrapper.setAttribute('aria-label', this.range.alt
        ? `Image unavailable: ${this.range.alt}`
        : 'Image unavailable')
      wrapper.textContent = this.range.alt || 'Image unavailable'
      view.requestMeasure()
    }, { once: true })
    wrapper.append(image)
    return wrapper
  }

  ignoreEvent() {
    return false
  }
}

function decorationsFor(
  view: EditorView,
  resolutions: ReadonlyMap<string, Resolution>,
  settledHeights: Map<string, number>,
) {
  const decorations: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  const availableWidth = view.contentDOM.clientWidth

  for (const image of visibleImages(view)) {
    const resolution = resolutions.get(image.destination)
    if (!resolution) continue
    const widget = new ImageWidget(
      image,
      resolution,
      availableWidth,
      settledHeights,
    )
    if (imageIsActive(view, image)) {
      decorations.push(Decoration.widget({ widget, side: 1 }).range(image.to))
      continue
    }
    const replacement = Decoration.replace({ widget }).range(image.from, image.to)
    decorations.push(replacement)
    atomic.push(replacement)
  }
  return {
    decorations: Decoration.set(decorations, true),
    atomic: Decoration.set(atomic, true),
  }
}

export function imageLivePreview(
  resolveImage: (destination: string) => Promise<DisplayImage>,
) {
  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet
    atomic: DecorationSet
    private active = true
    private readonly pending = new Set<string>()
    private readonly resolutions = new Map<string, Resolution>()
    private readonly settledHeights = new Map<string, number>()
    private wanted = new Set<string>()
    private readonly view: EditorView

    constructor(view: EditorView) {
      this.view = view
      const built = decorationsFor(view, this.resolutions, this.settledHeights)
      this.decorations = built.decorations
      this.atomic = built.atomic
      this.resolveVisible(view)
    }

    update(update: ViewUpdate) {
      const resolutionChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(imageResolutionChanged)),
      )
      if (update.docChanged || update.viewportChanged) this.resolveVisible(update.view)
      if (
        update.docChanged
        || update.viewportChanged
        || update.selectionSet
        || update.geometryChanged
        || resolutionChanged
      ) {
        const built = decorationsFor(
          update.view,
          this.resolutions,
          this.settledHeights,
        )
        this.decorations = built.decorations
        this.atomic = built.atomic
      }
    }

    destroy() {
      this.active = false
    }

    private resolveVisible(view: EditorView) {
      this.wanted = new Set(visibleImages(view).map((image) => image.destination))
      for (const destination of this.wanted) {
        if (this.pending.has(destination) || this.resolutions.has(destination)) continue
        this.pending.add(destination)
        void resolveImage(destination).then(
          (image) => this.finish(destination, { status: 'resolved', image }),
          () => this.finish(destination, { status: 'missing' }),
        )
      }
    }

    private finish(destination: string, resolution: Resolution) {
      if (!this.active) return
      this.pending.delete(destination)
      this.resolutions.set(destination, resolution)
      if (this.wanted.has(destination)) {
        this.view.dispatch({ effects: imageResolutionChanged.of(null) })
      }
    }
  }, {
    decorations: (value) => value.decorations,
  })

  return [
    plugin,
    EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? Decoration.none),
  ]
}
