# Markdown editor

The note body uses CodeMirror 6 as a source-mode Markdown editor. It is loaded only when a note opens so the composer remains lightweight.

## Supported Markdown

The editor parses CommonMark plus the GitHub Flavored Markdown extensions supplied by Lezer:

- Headings, emphasis, strong text, links, images, blockquotes, lists, thematic breaks, inline code, and fenced code blocks
- Tables
- Task lists
- Strikethrough
- Autolinks
- Syntax highlighting for recognized fenced-code language names

The document remains plain Markdown. Supported wiki links use `[[target]]` or `[[target|display text]]`; paths, headings, blocks, embeds, and links in code remain unsupported. Backlink discovery remains outside the current application phase. Persistence is provided through the Tauri Markdown vault commands.

## Writing behavior

- The title begins as one line, grows vertically as it wraps, and remains a single logical line capped at 120 characters.
- Soft line wrapping and a 65-character measure keep the page prose-oriented.
- A descending semantic heading scale, tight heading leading, full-size body text, and higher-contrast source punctuation preserve hierarchy without turning source mode into a preview.
- A small amount of space above heading lines separates sections without disrupting the body-text rhythm.
- Complete heading and blockquote prefixes hang in the left gutter so their content and wrapped continuations share the body text axis. A blockquote's stored `>` marker is shown as a quiet `|` after its following space is typed; the source remains editable Markdown.
- Narrow editor layouts reserve enough source gutter to keep headings through level six visible without horizontal scrolling.
- Programming ligatures are disabled in the Markdown surface so punctuation remains literal, while normal kerning remains enabled.
- Long URLs and identifiers can wrap without widening the writing column.
- Wiki links use a Live Preview treatment: inactive plain links show their target, aliases show only their display text, and the complete source syntax reappears whenever a cursor or selection touches the link. Primary Ctrl-click on Linux/Windows or Cmd-click on macOS uses the existing flush-gated open-or-create navigation path.
- Markdown-aware Enter and Backspace continue or exit lists and blockquotes. Enter continues a blockquote once; pressing Enter again on that untouched empty quote line exits it.
- Cmd/Ctrl-B, Cmd/Ctrl-I, Cmd/Ctrl-`, and Cmd/Ctrl-Shift-X semantically toggle bold, italic, inline-code, and strikethrough markup. Commands normalize partial same-style spans, operate independently across parsed blocks and multiple selections, preserve structural prefixes, and keep invalid boundary whitespace outside delimiters.
- Cmd/Ctrl-K creates or removes Markdown links. It edits existing destinations instead of nesting links and declines selections that cross block boundaries.
- Undo, redo, find, replace, multiple selections, bracket matching, bracket closing, and Tab indentation use CodeMirror's standard commands and keymaps.
- Browser spellcheck and an accessible multiline label are set on the editable surface.
- The editor owns its document state while typing. React receives document changes through an update listener and only dispatches an external replacement when the incoming value actually differs.

## Benchmarks

iA Writer informs the restrained, full-page writing surface: no toolbar, gutter, preview split, or persistent controls. Obsidian informs source-mode interoperability: familiar Markdown continuation, search/history commands, GFM syntax, and fenced-code language highlighting. The prototype intentionally does not reproduce either product's file-management or plugin features.
