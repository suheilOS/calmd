# Markdown formatting command research

Research date: 2026-07-22

## Executive recommendation

Formatting commands should operate on parsed inline content, not blindly add marker strings around the raw selection. Treat bold, italic, and strikethrough as **semantic set/unset operations**:

- If every eligible character in the selection already has the requested style, remove that style across the selection.
- Otherwise, apply it to every eligible character, merging or removing redundant same-style markers on the way.
- Split work at Markdown block boundaries. Never create one inline delimiter pair across a blank line or around block syntax such as `# `, `> `, or a list marker.
- Keep outer whitespace outside delimiters, because whitespace immediately inside an emphasis delimiter prevents it from opening or closing.
- Use CodeMirror's syntax tree to identify formatting spans and `changeByRange` to produce one atomic, multi-selection-safe transaction.

That gives the expected result for the motivating case:

```md
Before: A paragraph with one *important* word.
Select: the whole paragraph
Italic: _A paragraph with one important word._
```

The exact marker family is an implementation choice, but the result should contain one semantic italic span rather than ambiguous nested `*` runs.

## What the standards require

### Inline formatting belongs to a block

CommonMark first parses block structure and then parses inline structure inside each block. A paragraph contains inline content; a blank line ends the paragraph. Emphasis and strong emphasis may contain soft line breaks, but they cannot be continued through a separate paragraph. GFM states the same boundary explicitly for strikethrough: a new paragraph ends strikethrough parsing. Therefore a selection spanning several paragraphs must be formatted as one operation containing a separate inline edit for each block, while blank separators remain untouched.

Sources: [CommonMark blocks and inlines](https://spec.commonmark.org/0.31.2/#blocks-and-inlines), [CommonMark paragraphs](https://spec.commonmark.org/0.31.2/#paragraphs), [CommonMark emphasis examples 405 and 423](https://spec.commonmark.org/0.31.2/#example-405), [GFM strikethrough examples 491–493](https://github.github.com/gfm/#strikethrough-extension-).

### Emphasis markers are context-sensitive

`*` and `_` are not symmetric quote characters. Whether they open or close emphasis depends on the adjacent Unicode whitespace and punctuation. In particular, an opening delimiter cannot be followed by whitespace and a closing delimiter cannot be preceded by whitespace. Wrapping the literal selection ` hello ` as `* hello *` therefore does not create emphasis. A command must trim only the selection's outer whitespace for marker placement while preserving that whitespace in the document.

CommonMark also permits nesting, including emphasis inside emphasis and strong emphasis inside strong emphasis. That proves nested markup can be valid, but it does not make redundant same-style nesting a good editing result. A semantic toggle should normalize the union of same-style spans instead of creating increasingly complex delimiter runs.

Sources: [CommonMark delimiter-run rules](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis), [nested emphasis examples 406–426](https://spec.commonmark.org/0.31.2/#example-406), [empty emphasis examples 420–421](https://spec.commonmark.org/0.31.2/#example-420).

### Inline code is not ordinary wrapping

A code span is delimited by a run of one or more backticks. Its closing run must have the same length, and interior line endings are normalized to spaces. If both the first and last content characters are spaces and the content is not all spaces, one space is stripped from each side. Backslashes do not escape backticks inside a code span. Consequently the command must choose a delimiter run longer than any backtick run in the selected content and add protective interior spaces when the boundary content would otherwise collide with the delimiters or trigger normalization.

Because code spans normalize line endings and are inline constructs, an inline-code command must not wrap multiple paragraphs in a single pair. Apply it independently to each eligible inline block, or expose a separate code-block command for intentionally multiline code.

Source: [CommonMark code spans](https://spec.commonmark.org/0.31.2/#code-spans).

### Links have a distinct structure

An inline link is `[label](destination "optional title")`; the label and destination are different syntactic fields, not interchangeable wrapper markers. Link labels may contain inline formatting, but links may not contain other links. Code spans and autolinks bind more tightly than link brackets. Link creation and removal therefore need syntax-tree-aware behavior and cannot share the generic emphasis wrapper.

Source: [CommonMark links](https://spec.commonmark.org/0.31.2/#links).

### Strikethrough is a GFM extension

CommonMark itself has no strikethrough. GFM accepts matching runs of one or two tildes and rejects runs of three or more. Use the project's established `~~` spelling and apply the same whitespace/block-boundary precautions as emphasis.

Source: [GFM strikethrough](https://github.github.com/gfm/#strikethrough-extension-).

## Mature-editor precedents

### CodeMirror 6

CodeMirror models a selection as one or more non-overlapping ranges. Its reference manual says commands should usually apply to all ranges and provides `EditorState.changeByRange` specifically to merge per-range edits and updated selections into one transaction. The official document-change example demonstrates wrapping every selection in underscores with this API. This is the correct mechanical foundation, but the example is intentionally simple and does not solve Markdown parsing, whitespace, or nested-formatting semantics.

Sources: [CodeMirror state and selection reference](https://codemirror.net/docs/ref/#state.EditorState.changeByRange), [CodeMirror document-change example](https://codemirror.net/examples/change/), [CodeMirror selection example](https://codemirror.net/examples/selection/).

### VS Code's Markdown ecosystem

VS Code's built-in Markdown extension focuses on language support and preview; formatting toggles are commonly supplied by Markdown All in One. That extension is a useful mature source precedent: its bold, italic, code-span, and strikethrough commands share a wrapper function; it handles every VS Code selection; an empty cursor selects the word under the cursor when available, otherwise inserts an empty pair; a fully wrapped selection is unwrapped; and multiple edits are submitted together. It also has explicit cursor-placement logic and a special case that moves an emphasis cursor past an existing closing delimiter.

Its source also demonstrates the limit of a purely textual strategy: `isWrapped` only tests `startsWith`/`endsWith`, so a whole paragraph containing a partially formatted word is simply wrapped and may gain redundant or ambiguous same-marker nesting. Calmd should keep the interaction precedents—atomic edit, stable selection, repeated command toggles—but improve correctness with parsed semantic coverage.

Sources: [Markdown All in One commands and shortcuts](https://github.com/yzhang-gh/vscode-markdown#keyboard-shortcuts), [formatting command registration](https://github.com/yzhang-gh/vscode-markdown/blob/master/src/formatting.ts#L12-L66), [multi-selection wrapper implementation](https://github.com/yzhang-gh/vscode-markdown/blob/master/src/formatting.ts#L410-L553).

### Obsidian

Obsidian's official syntax reference uses `**` for bold, `*` for italic, `~~` for strikethrough, backticks for inline code, and `[label](url)` for external links. It explicitly shows nested italic inside bold and combined bold-italic, confirming that formatting commands must preserve other inline styles rather than flatten all markup. Obsidian also supports both Markdown links and wikilinks, but Calmd's current phase should keep its existing Markdown-link scope rather than introduce wikilinks.

Source: [Obsidian basic formatting syntax](https://obsidian.md/help/syntax).

## Recommended command contract

### Shared rules

1. **One atomic transaction.** Process every selection range through `changeByRange`; one undo restores the entire command.
2. **Preserve range direction and main selection.** After the edit, keep selected content selected without newly inserted markers. For a collapsed cursor, place the cursor inside a newly inserted pair or preserve its logical text position when markers are removed.
3. **Partition by parsed block.** For a range covering several paragraphs, headings, quotes, or list items, format each block's inline-content interval separately. Do not include block prefixes, blank lines, or trailing line-break characters in delimiters.
4. **Trim marker boundaries.** Leave leading/trailing Unicode whitespace outside each formatted interval. An interval containing only whitespace is a no-op.
5. **Semantic toggle.** Compute style coverage over eligible text. Full coverage means remove the target style; partial or zero coverage means apply it everywhere, coalescing adjacent spans and removing redundant nested spans of the same type.
6. **Preserve other syntax.** Do not delete bold while toggling italic, do not alter link destinations while formatting their labels, and do not treat literal marker characters inside code as formatting.
7. **Syntax-tree first.** Use Lezer nodes/ranges for recognized Markdown. Use conservative text inspection only for an empty insertion pair or malformed/in-progress markup around the cursor.

### Bold, italic, and strikethrough

| Input state | Command result |
| --- | --- |
| Non-empty plain selection | Apply the style to the non-whitespace content of every selected block |
| Selection fully covered by target style | Remove that style across the selection, preserving all other styles |
| Selection partly covered by target style | Apply style to the uncovered parts and normalize to the simplest valid equivalent |
| Whole paragraph with one same-style word | Produce one uniformly styled paragraph; remove the redundant inner same-style markers |
| Selection across blank lines | Create separate spans per paragraph/block; preserve blank lines exactly |
| Selection includes a heading/quote/list prefix | Format only inline content, never the structural prefix |
| Collapsed cursor inside a target-style span | Remove the containing target span while keeping the cursor at the same logical text offset |
| Collapsed cursor in plain text | Insert an empty marker pair and place the cursor between it; do not unexpectedly format an unselected word |
| Several selections | Apply the same semantic decision independently to each range in one transaction |

The collapsed-cursor recommendation intentionally favors predictable toolbar behavior over Markdown All in One's “format word under cursor” shortcut. It matches the visible-source editing model: no selection means prepare a typing span; a cursor already inside a span means toggle that active span off.

### Inline code

| Input state | Command result |
| --- | --- |
| Plain, single-block selection | Wrap with a backtick run longer than any run in the content |
| Selection already exactly one code span | Remove its delimiters and reverse only the editor-added protective padding |
| Selection contains formatting | Treat all interior Markdown markers literally, as the spec requires; do not attempt to preserve their rendered styles inside code |
| Multi-block selection | Create a separate code span for each non-empty inline block; never bridge blank lines |
| Collapsed cursor inside code span | Remove the containing code span |
| Collapsed cursor outside code | Insert `` `|` `` |

If preserving line breaks as code is desired later, that is a separate fenced-code-block command, not an edge case of inline code.

### Links

| Input state | Command result |
| --- | --- |
| Non-empty selection within one inline block | Create `[selected label](|)` and put the cursor in the destination while retaining enough selection state to return to the label if the UI supports it |
| Collapsed cursor outside a link | Insert `[|]()` or open the existing link-entry UI; the label is the first field |
| Cursor or selection inside an existing link label | Remove the whole link syntax and retain its label text; preserve inline formatting inside the label |
| Cursor inside an existing destination | Keep the link and select/edit the destination rather than nesting a link |
| Selection is an existing complete link | Unlink it, retaining the label |
| Selection spans blocks or several independent ranges | Do not manufacture one invalid/nonsensical link. Apply only when every range is a valid single-block label, otherwise leave unchanged and provide non-modal feedback |

Pasting a URL over selected text can be supported as a separate paste rule; it should not be conflated with the deterministic link-toggle command.

## Acceptance matrix

The implementation should have automated cases for at least:

- Plain, fully formatted, and partially formatted selections for every supported command.
- Whole-paragraph italic over `A *partly* formatted paragraph` and the equivalent bold/strike cases.
- The inverse: unformat a selected fully styled paragraph containing nested bold, italic, link, and code children.
- Selections with leading/trailing spaces, punctuation, Unicode non-breaking space, only whitespace, and reversed anchor/head direction.
- One paragraph containing a soft line break versus two paragraphs separated by a blank line.
- Headings, nested blockquotes, list items, and mixed blocks selected together; their structural markers must remain unchanged.
- Existing alternate marker spellings (`_`, `__`) and adjacent delimiter runs such as bold plus italic.
- Inline code containing one or more backticks, content beginning/ending in backticks, boundary spaces, and multiline input.
- Existing complete links, selection in a label, cursor in a destination, formatted link labels, and attempts to link across paragraphs.
- Multiple cursors and multiple non-empty selections, including selections on the same line; verify one-step undo and stable resulting selections.
- Repeating each command twice returns to the same semantic document, allowing harmless canonicalization of marker spelling.

## Deliberate non-goals

- Do not add wikilinks, backlink discovery, rich-text-only hidden markup, or a backend.
- Do not promise byte-for-byte restoration after a double toggle. Canonicalizing redundant or alternate Markdown into the project's preferred markers is acceptable; semantic content and unrelated formatting must be preserved.
- Do not use animation or transient layout for formatting commands. They are keyboard-heavy, high-frequency actions and should feel instantaneous.
