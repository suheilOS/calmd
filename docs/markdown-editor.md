# Markdown editor

The note body uses CodeMirror 6 as a plain-Markdown editor with one Live Preview presentation. It is loaded only when a note opens so the composer remains lightweight.

## Implementation structure

Editor-owned code is co-located under `src/markdown-editor/`. A framework-neutral document session owns the CodeMirror view, extensions, document synchronization, history isolation, view-state restoration, and cleanup behind `update`, `commands`, and `destroy`. `MarkdownEditor.tsx` is only the React 19 mount adapter and remains the direct lazy-loading entrypoint. The Note workspace continues to own persistence, navigation, previews, and user-facing errors.

## Supported Markdown

The editor parses CommonMark plus the GitHub Flavored Markdown extensions supplied by Lezer:

- Headings, emphasis, strong text, links, images, blockquotes, lists, thematic breaks, inline code, and fenced code blocks
- Tables
- Task lists
- Strikethrough
- Autolinks
- Syntax highlighting for recognized fenced-code language names
- The project's `==highlighted text==` inline extension

The document remains plain Markdown. Supported wiki links use `[[target]]` or `[[target|display text]]`; paths, headings, blocks, embeds, and links in code remain unsupported. Backlinks are derived from the rebuildable index and remain hidden in an on-demand popover until requested. Persistence is provided through the Tauri Markdown vault commands.

## Writing behavior

- The title begins as one line, grows vertically as it wraps, and remains a single logical line capped at 120 characters.
- Soft line wrapping and a 65-character measure keep the page prose-oriented.
- A descending semantic heading scale, tight heading leading, and full-size body text preserve hierarchy. Heading source appears in reserved margin space so revealing it does not move the heading text.
- Live Preview is the sole editing presentation. Inline syntax reveals only when a caret or completed selection touches its parsed span; structural prefixes reveal on their owning line. Carets activate inclusive boundaries, and a selection activates every syntax span it overlaps. Opaque Live Preview surfaces render in a background layer below CodeMirror's drawn selection so selections remain visible across code, inline code, and highlighted text.
- Pointer-drag selections freeze the pre-drag presentation until the gesture completes, preventing source delimiters from moving text under the pointer.
- Strong, emphasis, highlight, strikethrough, inline code, standard links, wiki links, escapes, ATX and Setext headings, blockquotes, fenced code, thematic breaks, lists, and tasks use the shared Live Preview policy. Malformed or incomplete Markdown remains literal source.
- Valid vault-relative PNG, JPEG, GIF, and WebP images render through Tauri's exact-file-scoped asset protocol. Image source returns on caret or selection contact; unavailable images retain an accessible alt-text fallback. Remote, absolute, traversal, SVG, and reference-style destinations remain literal source.
- Activating any part of a fenced code block reveals the entire source unit: opening fence, language identifier, content, and closing fence.
- Inactive list lines render source-backed bullets, numbers, or task checkboxes. Activating the line reveals the literal prefix. Clicking an inactive checkbox performs one undoable Markdown edit without entering source editing.
- Programming ligatures are disabled in the Markdown surface so punctuation remains literal, while normal kerning remains enabled.
- Long URLs and identifiers can wrap without widening the writing column.
- Wiki links use a Live Preview treatment: inactive plain links show their target, aliases show only their display text, and the complete source syntax reappears whenever a cursor or selection touches the link. Links to existing notes use the accent color; unresolved links use a lighter accent variant. Primary Ctrl-click on Linux/Windows or Cmd-click on macOS uses the existing flush-gated open-or-create navigation path.
- Standard Markdown links show only their label while inactive, while bare and autolinked HTTP(S) URLs remain visible. An ordinary click reveals editable source; primary Ctrl-click on Linux/Windows or Cmd-click on macOS opens absolute HTTP or HTTPS destinations.
- Holding that platform modifier while hovering a supported wiki link or backlink opens a delayed, bounded, read-only Markdown preview. Missing and ambiguous links show nothing. Preview requests cannot create or save notes, and self-links reflect the unsaved in-memory draft without flushing it.
- Markdown-aware Enter and Backspace continue or exit lists and blockquotes. Enter continues a blockquote once; pressing Enter again on that untouched empty quote line exits it.
- Cmd/Ctrl-B, Cmd/Ctrl-I, Cmd/Ctrl-`, Cmd/Ctrl-Shift-H, and Cmd/Ctrl-Shift-X semantically toggle bold, italic, inline code, highlight, and strikethrough markup. Commands operate across parsed blocks and multiple selections, preserve structural prefixes, and keep invalid boundary whitespace outside delimiters.
- Cmd/Ctrl-K creates or removes Markdown links. It edits existing destinations instead of nesting links and declines selections that cross block boundaries.
- Undo, redo, find, replace, multiple selections, bracket matching, bracket closing, and Tab indentation use CodeMirror's standard commands and keymaps.
- Each opened note has an isolated undo timeline. Note changes and canonical persistence reconciliation are not undoable user edits, and stale asynchronous link resolution cannot cross the editor-session seam.
- Selection and scroll position are remembered for up to 100 opened notes during the current app run, migrate with renames, and are discarded with deleted notes.
- Native spellcheck is enabled for prose by default and can be disabled from the editor context menu. The preference is stored in Tauri settings; autocorrect, autocapitalization, code, and link destinations remain excluded where the webview supports those attributes.
- The editor context menu exposes paragraph, heading, quote, list, task, and native image-picker actions. Pasted or picked images are validated and atomically imported into the vault-root `attachments/` directory, then inserted as portable standard Markdown. Asynchronous imports map their captured selections through intervening edits and cannot cross note sessions.
- The editor owns its document state while typing. React receives document changes through an update listener and only dispatches an external replacement when the incoming value actually differs.

## Benchmarks

iA Writer informs the restrained, full-page writing surface: no toolbar, gutter, preview split, or persistent controls. Obsidian informs Live Preview: plain Markdown remains the source of truth while inactive syntax recedes and active syntax remains directly editable. Calmd uses those precedents without reproducing either product's file-management or plugin features.
