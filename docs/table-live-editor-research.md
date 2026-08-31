# Editable table Live Preview research

## Decision

Keep CodeMirror and keep Markdown as the stored document. Replace the current read-only table preview with an interactive CodeMirror block widget that edits the table's source through outer-editor transactions.

Do not replace the note editor with ProseMirror, Tiptap, or another rich-text document model. That would put Markdown conversion on the persistence boundary and disturb the editor session, undo, wiki-link, image, spellcheck, and view-state work already built around CodeMirror.

For Calmd, a small table extension is a better fit than adopting `codemirror-markdown-tables` unchanged. That package proves the design and covers far more table behavior, but its implementation is large, uses Svelte internally, and owns formatting, selection, menus, clipboard behavior, drag interactions, and nested cell editors. Calmd needs a narrower interaction contract and must preserve its React and Base UI boundaries, Arabic behavior, link rules, persistence sequencing, and restrained interface.

## What exists now

The current implementation is a rendered preview, not a live table editor.

1. `@lezer/markdown` parses GFM `Table`, `TableHeader`, `TableRow`, and `TableCell` nodes because `session.ts` enables `GFM`.
2. `blockPreviewDecorations` in `src/markdown-editor/livePreview.ts` walks the syntax tree.
3. When no selection touches a table, a block `Decoration.replace` hides the complete Markdown range and mounts `TablePreviewWidget`.
4. The widget creates a semantic HTML `<table>`. It copies each cell to `textContent`, applies `dir="auto"`, and has no editable descendants.
5. Pressing the pointer on the table prevents the browser action, moves the outer CodeMirror selection to the start of the table, and focuses CodeMirror. The selection then touches the parsed `Table` node, so the widget disappears and the complete pipe-delimited Markdown returns.
6. The `/table` command inserts a fixed two-column, two-body-row Markdown template. Editing then happens in raw source.

This gives a clean resting view and leaves Markdown untouched, but it has important limits:

- A table cannot be edited cell by cell.
- Tab, Enter, arrows, and pointer placement cannot navigate cells.
- There are no row, column, alignment, reorder, or table clipboard operations.
- Inline Markdown in cells is shown literally because the widget assigns `textContent`.
- Alignment markers such as `:---:` are not represented in the preview.
- `tableRows` relies on Lezer `TableCell` children. Lezer does not emit a `TableCell` node for an empty cell. The inserted row `|  |  |` therefore produces a row with no `<td>` elements in the current preview.
- The widget equality check serializes all rows with `JSON.stringify` and includes the table's document position. It is adequate for a read-only preview, but it is not a stable identity for a focused editor whose source range moves.
- Clicking causes a large height and geometry change when the rendered table becomes raw Markdown.

The current mounted test confirms only that the inactive table renders and that selecting its source removes the widget. It does not cover dimensions, blank cells, alignment, inline formatting, keyboard use, editing, undo, IME, or external document replacement.

## Obsidian's interaction contract

Obsidian 1.5 introduced a table editor in Live Preview while continuing to save plain-text Markdown. Its public contract is the useful benchmark, even though Obsidian's implementation is proprietary.

Obsidian documents these behaviors:

- The table remains rendered while it is being edited.
- A pointer can place the caret in a cell.
- Tab moves to the next cell.
- Rows and columns can be added from controls at the table edges.
- Context menus, commands, and hotkeys expose table operations.
- Rows and columns can be created, edited, sorted, reordered, selected, copied, and pasted.
- Cell text supports inline formatting.
- Source mode remains available as an escape hatch.

The key distinction from Calmd's current behavior is focus ownership. Obsidian does not unfold the whole table merely because the caret enters it. Focus moves into an editor associated with a cell while the table remains a table.

## CodeMirror feasibility

CodeMirror supports this without changing the persisted document model.

A block `Decoration.replace` can continue to replace the parsed table range. Its widget can contain focusable controls or nested editors. Cell changes can serialize the table and dispatch one outer CodeMirror transaction replacing the current table source range. The outer `state.doc` therefore remains valid Markdown after every committed edit, and existing `onChange`, autosave, conflict handling, revisions, search, and note transitions continue to observe ordinary document transactions.

CodeMirror also provides the pieces needed for a stable implementation:

- `WidgetType.eq` and `updateDOM` can retain or reconcile widget DOM.
- `WidgetType.estimatedHeight` helps virtualization before a table is measured.
- `WidgetType.coordsAt` can map source positions to cell geometry.
- `EditorView.atomicRanges` can make outer cursor movement skip the replaced source range.
- Transaction annotations and `Transaction.userEvent` can distinguish cell typing from external replacement and allow history grouping.
- Changes and syntax nodes provide fresh source ranges after edits. A widget must not keep using the range captured when it was created.

Two open-source implementations confirm the approach:

- `codemirror-markdown-tables` replaces each table with an interactive widget, uses nested CodeMirror editors for cells, synchronizes edits into the root editor, integrates root undo and search, handles cell selections and clipboard operations, and tracks widget height. It is the strongest technical reference.
- `@atomic-editor/editor` uses a smaller full-table replacement widget with editable cell DOM. Its architecture notes call out the important invariants: Markdown remains in `state.doc`, widget DOM must survive per-keystroke source replacement, current table bounds must be resolved after edits, wide tables need contained horizontal scrolling, IME commits must wait for `compositionend`, and Tab past the final cell can append a row.

Joplin's CodeMirror table rendering is useful as a read-only rendering reference, but it does not provide the Obsidian-style editing contract by itself.

## Recommended design

### 1. Move tables into their own extension

Create `src/markdown-editor/tableLiveEditor.ts` and remove table handling from `TablePreviewWidget` and `blockPreviewDecorations`. Callouts can retain their current reveal-to-source behavior.

The table extension should own:

- parsing and serializing the GFM table model;
- the table decoration state field;
- widget/controller lifetime;
- cell focus and keyboard navigation;
- table edit transactions and history annotations;
- row, column, and alignment commands;
- table-specific clipboard behavior;
- outer-editor boundary behavior.

Keeping this separate prevents `livePreview.ts` from becoming the state manager for an embedded editor.

### 2. Use a lossless table model

Do not derive the model only from Lezer `TableCell` children. Use the `Table` node to locate the block, then scan each source line for separators while respecting escaped pipes. The model needs explicit variants rather than optional-field bags:

```ts
type TableAlignment = 'default' | 'left' | 'center' | 'right'

type TableCell = {
  source: string
}

type MarkdownTable = {
  header: readonly TableCell[]
  alignments: readonly TableAlignment[]
  rows: readonly (readonly TableCell[])[]
}
```

The parser must preserve:

- empty cells and empty rows;
- optional leading and trailing pipes;
- escaped pipes;
- inline Markdown source;
- left, center, and right delimiter alignment;
- Unicode, Arabic, and mixed-direction text;
- uneven imported rows, padded in the view without silently deleting source.

On the first user edit, the serializer may canonicalize spacing and outer pipes, as Obsidian does, but it must preserve cell content and alignment. This policy should be explicit because a one-character cell edit will replace the full table source range.

### 3. Keep one outer history

The outer CodeMirror document must own undo and redo. A cell editor should not create a competing persistent history.

Each cell commit should:

1. resolve the current `Table` range from current editor state;
2. update the table model;
3. serialize valid GFM Markdown;
4. dispatch one outer change over the table range;
5. annotate typing with `Transaction.userEvent.of('input.type')` so consecutive input can group naturally;
6. leave structural commands such as adding a row as separate undo steps.

Cmd/Ctrl-Z and redo from a focused cell must call the outer editor commands. Undo, redo, external canonical persistence updates, and note-session replacement must reconcile the visible table without losing or applying stale cell state.

A structure-only `WidgetType.eq` is not sufficient on its own. It keeps focus during local typing, but it can leave stale DOM after undo or an external replacement with the same row and column count. Use a table controller retained by the state field, or implement `updateDOM` with an edit-origin check. Local input can retain the existing focused DOM; outer undo, redo, and external updates must refresh it and restore a mapped cell selection where possible.

### 4. Use a focused nested CodeMirror cell editor

Use one small nested CodeMirror `EditorView` for the active cell, not one editor for every visible cell and not a permanently rich `contenteditable` tree.

Inactive cells should render safe inline Markdown DOM from parsed nodes. The first scope should cover strong, emphasis, strikethrough, highlight, inline code, standard links, and wiki-link labels. Unsupported or malformed content should remain literal text. Build DOM nodes with `textContent`; do not inject parser output through `innerHTML`.

When a cell receives focus:

- replace its inactive renderer with a nested single-line CodeMirror view;
- initialize it with that cell's exact Markdown source;
- reuse the relevant inline Live Preview policy so formatting remains rendered and delimiters reveal around the nested caret;
- use `dir="auto"` and per-line direction measurement;
- inherit the outer spellcheck setting;
- keep code and URL spans LTR;
- forward changes to the outer table transaction path;
- destroy or move the nested view when focus changes.

This costs more implementation work than a bare `contenteditable`, but it reuses CodeMirror's IME, bidi, selection, keymap, and input handling. Those are important for Calmd. A decorated `contenteditable` requires manual caret restoration whenever its DOM is rebuilt and is easy to break with Arabic composition, dead keys, rich paste, browser undo, and inline mark boundaries.

A narrow first release can show literal inline Markdown inside the active cell while rendering inactive cells. Full delimiter-sensitive cell Live Preview can follow without changing the table model or transaction design.

### 5. Define keyboard behavior before visual controls

Recommended initial behavior:

| Input | Result |
| --- | --- |
| Pointer press | Focus the chosen cell at the nearest text position |
| Tab | Move to the next cell |
| Shift-Tab | Move to the previous cell |
| Tab from the final cell | Append one body row and focus its first cell |
| Enter | Move to the cell below, appending a row when needed |
| Shift-Enter | Insert `<br>` only if multiline cell content is supported; otherwise do nothing |
| Arrow keys within text | Move the cell caret normally |
| Arrow at a cell boundary | Move to an adjacent cell only after the basic caret behavior is proven reliable |
| Escape | Return focus to the outer editor at the table boundary |
| Cmd/Ctrl-Z | Undo in the outer editor |
| Cmd/Ctrl-Shift-Z or platform redo | Redo in the outer editor |

Do not intercept ordinary arrows in the first release. Bidi text makes "start", "end", "left", and "right" different concepts, and browser visual movement should not be replaced with a naive string-offset rule.

### 6. Add restrained structural controls

Match Obsidian's useful operations without leaving controls permanently visible.

- Show small add-row and add-column controls only while the table or one of its cells has focus or hover.
- Use a Base UI menu, owned by `MarkdownEditor.tsx`, for row, column, and alignment actions. The widget can report an anchor element and cell coordinates to the React adapter rather than creating a second menu system directly in widget DOM.
- Start with insert row above/below, insert column before/after, delete row, delete column, and alignment.
- Add reorder, sort, rectangular cell selection, and table-aware multi-cell clipboard only after the editing core is stable.
- Keep at least one column. If deleting the last row or column would stop Lezer parsing the block as a table, require deleting the whole table instead.
- Include a local "Edit table source" action as a recovery path for imported or unsupported Markdown. It should reveal only that table until focus leaves or the user closes source editing.

### 7. Keep wide tables contained

Wrap the `<table>` in a block with `max-inline-size: 100%` and `overflow-x: auto`. Do not let a wide table expand the editor's 65-character writing measure or the application viewport.

Implement an estimated height and update it with `ResizeObserver`. This matters for tables outside the rendered viewport and for scroll restoration. Preserve logical borders and padding, while applying explicit physical left, center, or right text alignment when GFM alignment markers request it. Cells without explicit alignment should retain `dir="auto"` and start alignment.

### 8. Make the focus model accessible

The resting widget should remain a semantic `<table>` with `<thead>`, `<tbody>`, `<th scope="col">`, and `<td>`.

The active cell editor needs an accessible name such as "Table header, column 2" or "Table row 3, column 2". Structural controls need button names, keyboard access, visible focus, and adequate hit areas. Announce row or column insertion and deletion through a short-lived polite live region owned by the React adapter.

Do not make every inactive cell a tab stop. Tab should enter the active table editing flow, move through cells under the defined table keymap, and leave predictably with Escape or Shift-Tab from the first cell. Test this with a real browser or Tauri webview; DOM-only test environments do not reproduce contenteditable, IME, selection geometry, or screen-reader behavior.

## Delivery plan

### Phase 1: editable table core

- Add lossless parse and canonical serialize helpers.
- Preserve blank cells and alignment.
- Replace the read-only table widget with a persistent interactive block widget.
- Focus and edit one cell at a time.
- Add Tab, Shift-Tab, Enter, Escape, outer undo, and redo.
- Append a row from the final cell.
- Contain horizontal overflow.
- Add a temporary table-source escape hatch.

This phase solves the reported problem. Entering a table no longer exposes all raw Markdown.

### Phase 2: rendered cell content and controls

- Render supported inline Markdown in inactive cells.
- Apply the inline Live Preview reveal policy in the active cell.
- Add Base UI row, column, and alignment actions.
- Add accessible edge controls.
- Add table-aware paste of tabular text and Markdown.

### Phase 3: advanced table operations

Only add these after usage shows they are needed:

- rectangular multi-cell selection;
- copy and paste of selected cell matrices;
- row and column drag reorder;
- sorting;
- column resizing;
- multiline cell editing.

Obsidian supports these, but they are not required to stop exposing raw table Markdown during ordinary editing.

## Required tests

### Model tests

- optional outer pipes;
- blank header and body cells;
- blank rows from the current `/table` template;
- escaped pipes and backslashes;
- inline Markdown source;
- all four alignment values;
- uneven imported rows;
- Arabic, mixed Arabic and Latin, emoji, and combining marks;
- malformed delimiter rows rejected without changing source;
- parse, serialize, parse stability.

### Mounted CodeMirror tests

- clicking a cell keeps the rendered table mounted;
- typing updates outer `state.doc` and the existing `onChange` path;
- focus and caret survive each outer transaction;
- Tab and Shift-Tab navigate in both directions;
- Tab or Enter from the final cell appends one valid row in one undoable transaction;
- undo and redo work while a nested cell is focused;
- external replacement and persistence reconciliation update same-shaped tables;
- cell edits after text is inserted before the table target the mapped current range;
- switching note sessions cannot apply a stale cell edit to the next note;
- a distant table in a long note mounts after background parsing;
- wide tables do not widen the note or app viewport;
- source mode can be entered and exited without data loss;
- inactive links, wiki links, and inline formatting render safely.

### Real webview checks

- Arabic and Latin caret movement;
- IME composition and dead keys;
- native spellcheck;
- pointer placement within styled cell content;
- mouse and keyboard text selection;
- clipboard plain text, rich text, and Markdown;
- scroll restoration before and after table height changes;
- keyboard and screen-reader traversal on Linux, Windows, and macOS where available.

## Risks

- Replacing the complete table source for every character can make undo, selection mapping, and external reconciliation feel wrong unless transaction identity and widget reuse are designed first.
- Rebuilding editable DOM during IME composition drops composed input.
- A parser based only on Lezer cell nodes loses empty cells.
- A structure-only widget equality check preserves focus but can hide undo or external updates.
- Browser `contenteditable` behavior is not covered by the current Happy DOM mounted tests.
- Search matches inside a replaced table need a policy. At minimum, selecting a search result should focus the matching cell or reveal that table's source temporarily.
- Formatting a whole table on first edit creates a larger file diff. This is acceptable only if documented and covered by round-trip tests.
- A table widget that always remains rendered changes the current selection model. Formatting toolbar snapshots and outer selection commands must ignore nested cell selection unless table-cell formatting support is deliberately wired in.

## Sources

- [Obsidian 1.5 release notes](https://obsidian.md/changelog/2023-12-26-desktop-v1.5.3/)
- [Obsidian editing views and modes](https://help.obsidian.md/edit-and-read)
- [Obsidian advanced formatting syntax](https://help.obsidian.md/advanced-syntax)
- [CodeMirror decoration example](https://codemirror.net/examples/decoration/)
- [CodeMirror reference](https://codemirror.net/docs/ref/)
- [`codemirror-markdown-tables`](https://github.com/ckant/codemirror-markdown-tables)
- [`@atomic-editor/editor` architecture](https://github.com/kenforthewin/atomic-editor/blob/main/docs/architecture.md)
- [Joplin CodeMirror table renderer](https://github.com/laurent22/joplin/blob/4dbbf2c3/packages/editor/CodeMirror/extensions/rendering/renderTables.ts)
- [GFM table specification](https://github.github.com/gfm/#tables-extension-)
