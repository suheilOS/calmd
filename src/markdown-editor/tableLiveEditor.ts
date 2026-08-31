import { redo, undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import {
  StateEffect,
  StateField,
  type EditorState,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { marked } from 'marked'

export type TableAlignment = 'default' | 'left' | 'center' | 'right'

export type MarkdownTable = {
  readonly header: readonly string[]
  readonly alignments: readonly TableAlignment[]
  readonly rows: readonly (readonly string[])[]
}

type TableRange = { from: number; to: number }
type CellPosition = { row: number; column: number }
type TableFieldValue = {
  decorations: DecorationSet
  revealedFrom: number | null
}

const revealTableSource = StateEffect.define<number>()
const controllers = new WeakMap<HTMLElement, TableController>()

function isEscaped(source: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function splitTableRow(line: string) {
  let source = line.trim()
  if (source.startsWith('|')) source = source.slice(1)
  if (source.endsWith('|') && !isEscaped(source, source.length - 1)) {
    source = source.slice(0, -1)
  }

  const cells: string[] = []
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '|' || isEscaped(source, index)) continue
    cells.push(source.slice(start, index).trim())
    start = index + 1
  }
  cells.push(source.slice(start).trim())
  return cells
}

function parseAlignment(source: string): TableAlignment | null {
  const delimiter = source.trim()
  if (!/^:?-+:?$/u.test(delimiter)) return null
  const left = delimiter.startsWith(':')
  const right = delimiter.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return 'default'
}

function tableWidth(table: MarkdownTable) {
  let width = Math.max(1, table.header.length, table.alignments.length)
  for (const row of table.rows) width = Math.max(width, row.length)
  return width
}

function padRow(row: readonly string[], width: number) {
  return Array.from({ length: width }, (_, index) => row[index] ?? '')
}

export function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.split('\n')
  if (lines.length < 2) return null

  const header = splitTableRow(lines[0] ?? '')
  const delimiterCells = splitTableRow(lines[1] ?? '')
  if (header.length === 0 || delimiterCells.length === 0) return null

  const parsedAlignments = delimiterCells.map(parseAlignment)
  if (parsedAlignments.some((alignment) => alignment === null)) return null

  const bodyRows = lines.slice(2).map(splitTableRow)
  let width = Math.max(1, header.length, delimiterCells.length)
  for (const row of bodyRows) width = Math.max(width, row.length)
  const alignments = Array.from(
    { length: width },
    (_, index): TableAlignment => parsedAlignments[index] ?? 'default',
  )

  return {
    header: padRow(header, width),
    alignments,
    rows: bodyRows.map((row) => padRow(row, width)),
  }
}

function alignmentSource(alignment: TableAlignment) {
  switch (alignment) {
    case 'default': return '---'
    case 'left': return ':---'
    case 'center': return ':---:'
    case 'right': return '---:'
    default: {
      const exhaustive: never = alignment
      return exhaustive
    }
  }
}

function escapeCellPipes(source: string) {
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '|' && !isEscaped(source, index)) result += '\\'
    result += character
  }
  return result
}

export function serializeMarkdownTable(table: MarkdownTable) {
  const width = tableWidth(table)
  const serializeRow = (row: readonly string[]) => (
    `| ${padRow(row, width).map(escapeCellPipes).join(' | ')} |`
  )
  return [
    serializeRow(table.header),
    serializeRow(Array.from(
      { length: width },
      (_, index) => alignmentSource(table.alignments[index] ?? 'default'),
    )),
    ...table.rows.map(serializeRow),
  ].join('\n')
}

function copyTable(table: MarkdownTable): MarkdownTable {
  return {
    header: [...table.header],
    alignments: [...table.alignments],
    rows: table.rows.map((row) => [...row]),
  }
}

function updateCell(
  table: MarkdownTable,
  position: CellPosition,
  source: string,
): MarkdownTable {
  const next = copyTable(table)
  if (position.row === 0) {
    const header = [...next.header]
    header[position.column] = source
    return { ...next, header }
  }
  const rows = next.rows.map((row) => [...row])
  const bodyRow = rows[position.row - 1]
  if (!bodyRow) return table
  bodyRow[position.column] = source
  return { ...next, rows }
}

function appendRow(table: MarkdownTable): MarkdownTable {
  const width = tableWidth(table)
  return {
    ...copyTable(table),
    rows: [...table.rows.map((row) => [...row]), Array.from({ length: width }, () => '')],
  }
}

function appendColumn(table: MarkdownTable): MarkdownTable {
  return {
    header: [...table.header, ''],
    alignments: [...table.alignments, 'default'],
    rows: table.rows.map((row) => [...row, '']),
  }
}

function findTableRange(state: EditorState, approximateFrom: number): TableRange | null {
  const tree = syntaxTree(state)
  const positions = [
    Math.min(approximateFrom, state.doc.length),
    Math.max(0, approximateFrom - 1),
  ]
  for (const position of positions) {
    let node: SyntaxNode | null = tree.resolveInner(position, 1)
    while (node) {
      if (node.name === 'Table') return { from: node.from, to: node.to }
      node = node.parent
    }
  }
  return null
}

function appendSanitizedInline(
  target: HTMLElement,
  source: string,
  document: Document,
) {
  const template = document.createElement('template')
  template.innerHTML = marked.parseInline(source, { async: false })

  const appendNode = (parent: Node, node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent ?? ''))
      return
    }
    if (!(node instanceof Element)) return

    const tag = node.tagName.toLowerCase()
    const allowedTag = tag === 'strong'
      || tag === 'em'
      || tag === 'del'
      || tag === 'code'
      || tag === 'br'
    if (allowedTag) {
      const safe = document.createElement(tag)
      for (const child of node.childNodes) appendNode(safe, child)
      parent.appendChild(safe)
      return
    }
    if (tag === 'a') {
      const label = document.createElement('span')
      label.className = 'cm-table-cell-link'
      for (const child of node.childNodes) appendNode(label, child)
      parent.appendChild(label)
      return
    }
    if (tag === 'p') {
      for (const child of node.childNodes) appendNode(parent, child)
      return
    }

    parent.appendChild(document.createTextNode(node.textContent ?? ''))
  }

  for (const node of template.content.childNodes) appendNode(target, node)
}

function cellLabel(position: CellPosition) {
  return position.row === 0
    ? `Table header, column ${position.column + 1}`
    : `Table row ${position.row}, column ${position.column + 1}`
}

class TableController {
  private active: CellPosition | null = null
  private composing = false
  private model: MarkdownTable
  private range: TableRange
  private root: HTMLElement | null = null
  private readonly view: EditorView

  constructor(view: EditorView, range: TableRange, model: MarkdownTable) {
    this.view = view
    this.range = range
    this.model = model
  }

  mount(root: HTMLElement) {
    this.root = root
    controllers.set(root, this)
    this.render()
  }

  sync(range: TableRange, model: MarkdownTable) {
    this.range = range
    this.model = model
    if (!this.root) return

    const cells = this.root.querySelectorAll<HTMLElement>('[data-table-cell]')
    const expected = (model.rows.length + 1) * tableWidth(model)
    if (cells.length !== expected) {
      this.render()
      this.focusActive()
      return
    }

    for (const cell of cells) {
      const position = this.positionFromCell(cell)
      if (!position) continue
      this.applyAlignment(cell, position.column)
      const source = this.cellSource(position)
      const input = cell.querySelector<HTMLInputElement>('.cm-table-cell-input')
      if (input) {
        if (!this.composing && input.value !== source) {
          const start = input.selectionStart ?? source.length
          const end = input.selectionEnd ?? start
          input.value = source
          input.setSelectionRange(Math.min(start, source.length), Math.min(end, source.length))
        }
        continue
      }
      const content = cell.querySelector<HTMLElement>('.cm-table-cell-content')
      if (content) {
        content.replaceChildren()
        appendSanitizedInline(content, source, this.view.dom.ownerDocument)
      }
    }
  }

  revealSource() {
    const range = findTableRange(this.view.state, this.range.from) ?? this.range
    this.view.dispatch({
      effects: revealTableSource.of(range.from),
      selection: { anchor: range.from },
    })
    this.view.focus()
  }

  addRow() {
    const next = appendRow(this.model)
    const target = { row: next.rows.length, column: 0 }
    this.commitStructure(next, target)
  }

  addColumn() {
    const next = appendColumn(this.model)
    const target = { row: 0, column: tableWidth(next) - 1 }
    this.commitStructure(next, target)
  }

  private render() {
    if (!this.root) return
    const document = this.view.dom.ownerDocument
    this.root.replaceChildren()

    const scroller = document.createElement('div')
    scroller.className = 'cm-table-editor-scroller'
    const table = document.createElement('table')
    table.className = 'cm-table-preview cm-table-live-editor'

    const head = table.createTHead()
    const headerRow = head.insertRow()
    this.model.header.forEach((_source, column) => {
      const cell = document.createElement('th')
      cell.scope = 'col'
      this.populateCell(cell, { row: 0, column })
      headerRow.append(cell)
    })

    const body = table.createTBody()
    this.model.rows.forEach((_row, rowIndex) => {
      const row = body.insertRow()
      for (let column = 0; column < tableWidth(this.model); column += 1) {
        const cell = row.insertCell()
        this.populateCell(cell, { row: rowIndex + 1, column })
      }
    })
    scroller.append(table)

    const controls = document.createElement('div')
    controls.className = 'cm-table-editor-controls'
    controls.append(
      this.controlButton('Add table row', '+ row', () => this.addRow()),
      this.controlButton('Add table column', '+ column', () => this.addColumn()),
      this.controlButton('Edit table Markdown', 'source', () => this.revealSource()),
    )

    this.root.append(scroller, controls)
    this.root.tabIndex = 0
    this.root.setAttribute('aria-label', 'Editable Markdown table')
    this.root.addEventListener('focus', this.handleRootFocus)
  }

  private controlButton(label: string, text: string, activate: () => void) {
    const button = this.view.dom.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = 'cm-table-editor-control'
    button.setAttribute('aria-label', label)
    button.textContent = text
    button.addEventListener('mousedown', (event) => event.stopPropagation())
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      activate()
    })
    return button
  }

  private populateCell(cell: HTMLTableCellElement, position: CellPosition) {
    cell.dataset.tableCell = `${position.row}:${position.column}`
    cell.dir = 'auto'
    this.applyAlignment(cell, position.column)
    if (this.active?.row === position.row && this.active.column === position.column) {
      const input = this.view.dom.ownerDocument.createElement('input')
      input.type = 'text'
      input.className = 'cm-table-cell-input'
      input.value = this.cellSource(position)
      input.dir = 'auto'
      input.spellcheck = this.view.contentDOM.spellcheck
      input.tabIndex = -1
      input.setAttribute('aria-label', cellLabel(position))
      input.addEventListener('input', this.handleInput)
      input.addEventListener('keydown', this.handleKeyDown)
      input.addEventListener('compositionstart', () => { this.composing = true })
      input.addEventListener('compositionend', this.handleCompositionEnd)
      cell.append(input)
      return
    }

    const content = this.view.dom.ownerDocument.createElement('div')
    content.className = 'cm-table-cell-content'
    appendSanitizedInline(content, this.cellSource(position), this.view.dom.ownerDocument)
    cell.append(content)
    cell.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      this.activate(position)
    })
  }

  private applyAlignment(cell: HTMLElement, column: number) {
    const alignment = this.model.alignments[column] ?? 'default'
    cell.dataset.alignment = alignment
  }

  private activate(position: CellPosition) {
    this.active = position
    this.render()
    this.focusActive()
  }

  private focusActive() {
    const input = this.root?.querySelector<HTMLInputElement>('.cm-table-cell-input')
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  private navigate(delta: number) {
    if (!this.active) return
    const width = tableWidth(this.model)
    const cellCount = (this.model.rows.length + 1) * width
    const current = this.active.row * width + this.active.column
    let target = current + delta
    if (target >= cellCount) {
      const next = appendRow(this.model)
      this.commitStructure(next, { row: next.rows.length, column: 0 })
      return
    }
    if (target < 0) {
      this.active = null
      this.render()
      this.view.dispatch({ selection: { anchor: this.range.from } })
      this.view.focus()
      return
    }
    target = Math.min(target, cellCount - 1)
    this.activate({ row: Math.floor(target / width), column: target % width })
  }

  private moveDown() {
    if (!this.active) return
    const nextRow = this.active.row + 1
    if (nextRow > this.model.rows.length) {
      const next = appendRow(this.model)
      this.commitStructure(next, { row: next.rows.length, column: this.active.column })
      return
    }
    this.activate({ row: nextRow, column: this.active.column })
  }

  private commitCell(source: string) {
    if (!this.active) return
    this.model = updateCell(this.model, this.active, source)
    this.dispatchModel('input.type')
  }

  private commitStructure(model: MarkdownTable, target: CellPosition) {
    this.model = model
    this.active = target
    this.render()
    this.focusActive()
    this.dispatchModel('input')
  }

  private dispatchModel(userEvent: string) {
    const range = findTableRange(this.view.state, this.range.from) ?? this.range
    this.range = range
    this.view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
        insert: serializeMarkdownTable(this.model),
      },
      userEvent,
    })
  }

  private cellSource(position: CellPosition) {
    return position.row === 0
      ? this.model.header[position.column] ?? ''
      : this.model.rows[position.row - 1]?.[position.column] ?? ''
  }

  private positionFromCell(cell: HTMLElement): CellPosition | null {
    const parts = cell.dataset.tableCell?.split(':')
    if (!parts || parts.length !== 2) return null
    const row = Number(parts[0])
    const column = Number(parts[1])
    if (!Number.isInteger(row) || !Number.isInteger(column)) return null
    return { row, column }
  }

  private readonly handleRootFocus = (event: FocusEvent) => {
    if (event.target !== this.root || this.active) return
    this.activate({ row: 0, column: 0 })
  }

  private readonly handleInput = (event: Event) => {
    if (this.composing || !(event.currentTarget instanceof HTMLInputElement)) return
    this.commitCell(event.currentTarget.value)
  }

  private readonly handleCompositionEnd = (event: CompositionEvent) => {
    this.composing = false
    if (event.currentTarget instanceof HTMLInputElement) {
      this.commitCell(event.currentTarget.value)
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    const primary = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (primary && !event.altKey && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo(this.view)
      else undo(this.view)
      return
    }
    if (primary && !event.altKey && key === 'y') {
      event.preventDefault()
      redo(this.view)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      this.navigate(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.moveDown()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.active = null
      this.render()
      this.view.dispatch({ selection: { anchor: this.range.to } })
      this.view.focus()
    }
  }
}

class TableEditorWidget extends WidgetType {
  private readonly model: MarkdownTable
  private readonly range: TableRange

  constructor(range: TableRange, model: MarkdownTable) {
    super()
    this.range = range
    this.model = model
  }

  toDOM(view: EditorView) {
    const root = view.dom.ownerDocument.createElement('div')
    root.className = 'cm-table-editor'
    new TableController(view, this.range, this.model).mount(root)
    return root
  }

  updateDOM(dom: HTMLElement) {
    const controller = controllers.get(dom)
    if (!controller) return false
    controller.sync(this.range, this.model)
    return true
  }

  get estimatedHeight() {
    return 120 + this.model.rows.length * 42
  }
}

function tableDecorations(state: EditorState, revealedFrom: number | null) {
  const decorations: Range<Decoration>[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return
      if (revealedFrom !== null && node.from <= revealedFrom && revealedFrom <= node.to) {
        return false
      }
      const model = parseMarkdownTable(state.sliceDoc(node.from, node.to))
      if (!model) return false
      decorations.push(Decoration.replace({
        block: true,
        widget: new TableEditorWidget({ from: node.from, to: node.to }, model),
      }).range(node.from, node.to))
      return false
    },
  })
  return Decoration.set(decorations, true)
}

function selectionInsideRevealedTable(state: EditorState, revealedFrom: number) {
  const range = findTableRange(state, revealedFrom)
  if (!range) return false
  return state.selection.ranges.some((selection) => (
    range.from <= selection.from && selection.to <= range.to
  ))
}

const tableField = StateField.define<TableFieldValue>({
  create(state) {
    return { decorations: tableDecorations(state, null), revealedFrom: null }
  },
  update(value, transaction) {
    let revealedFrom = transaction.docChanged && value.revealedFrom !== null
      ? transaction.changes.mapPos(value.revealedFrom, 1)
      : value.revealedFrom
    for (const effect of transaction.effects) {
      if (effect.is(revealTableSource)) revealedFrom = effect.value
    }
    if (
      revealedFrom !== null
      && transaction.selection
      && !selectionInsideRevealedTable(transaction.state, revealedFrom)
    ) {
      revealedFrom = null
    }

    const treeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
    const rebuild = transaction.docChanged
      || (revealedFrom !== null && transaction.selection !== undefined)
      || treeChanged
      || revealedFrom !== value.revealedFrom
    return rebuild
      ? { decorations: tableDecorations(transaction.state, revealedFrom), revealedFrom }
      : value
  },
  provide: (field) => EditorView.decorations.from(
    field,
    (value) => value.decorations,
  ),
})

export const tableLiveEditor = tableField
