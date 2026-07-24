# Markdown formatting command research

## Implemented contract

Calmd's formatting commands operate on CodeMirror's parsed Markdown ranges instead of blindly wrapping raw selections. The implementation lives in `src/markdownCommands.ts` and uses `EditorState.changeByRange` so a command is one undoable transaction across all selections.

The editor supports these commands:

- `Cmd/Ctrl-B` toggles `**bold**`.
- `Cmd/Ctrl-I` toggles `*italic*`.
- `Cmd/Ctrl-Shift-H` toggles `==highlight==` through the project's Markdown extension.
- `Cmd/Ctrl-Shift-X` toggles `~~strikethrough~~`.
- `Cmd/Ctrl-\`` toggles inline code with a delimiter run longer than any run in the selected text.
- `Cmd/Ctrl-K` creates, edits, or removes standard Markdown links.

Formatting commands partition selections across parsed inline blocks, preserve heading and list structure, keep boundary whitespace outside delimiters, and refuse selections that cross protected link or code syntax. Repeating a command toggles the selected style off while preserving unrelated styles where the parsed structure permits it.

A collapsed cursor inserts an empty formatting pair and places the cursor inside it. A collapsed cursor inside an existing format removes that format. The link command inserts a temporary `text` label and selects it when invoked with an empty cursor, then selects the destination after wrapping a non-empty selection.

## Markdown rules that shape the implementation

CommonMark parses block structure before inline structure. A blank line ends a paragraph, so a selection over multiple blocks receives separate edits rather than one delimiter pair. Emphasis delimiters depend on surrounding whitespace and punctuation. Code spans require matching backtick-run lengths and can normalize boundary spaces. Links have separate label and destination fields and cannot contain nested links. Strikethrough and the project's highlight syntax are extensions rather than CommonMark constructs.

These rules are why the commands use Lezer syntax trees for recognized Markdown and conservative text inspection only for in-progress or empty formatting pairs.

## Acceptance coverage

The command tests cover plain, fully formatted, and partially formatted selections; headings, quotes, lists, and tables; leading and trailing whitespace; Unicode whitespace; reversed selections; soft line breaks versus paragraph breaks; inline code containing backticks; existing links and destinations; multiple selections; and one-step undo behavior.

## Deliberate boundaries

The commands do not provide a rich-text document model, hidden storage markup, or a separate fenced-code formatting command. Wiki links and backlinks are implemented separately in the internal-linking phase and are documented in [ADR 0002](adr/0002-internal-links-and-navigation.md). The editor keeps the document as plain Markdown and disables browser spellcheck on the CodeMirror surface.

Sources: [CommonMark blocks and inlines](https://spec.commonmark.org/0.31.2/#commonmark), [CommonMark delimiter runs](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis), [CommonMark code spans](https://spec.commonmark.org/0.31.2/#code-spans), [CommonMark links](https://spec.commonmark.org/0.31.2/#links), [GFM strikethrough](https://github.github.com/gfm/#strikethrough-extension-), and [CodeMirror `changeByRange`](https://codemirror.net/docs/ref/#state.EditorState.changeByRange).
