# Internal links and navigation research

## Research conclusion

The linked-consistency design described here is implemented. Link identity, rename propagation, navigation, and backlink derivation share one format contract instead of behaving as separate UI features. Markdown remains authoritative; the SQLite index is derived and rebuildable.

## Current link contract

Calmd supports only:

```md
[[target]]
[[target|display text]]
```

Targets identify top-level Markdown filename stems. Matching is case-insensitive, and `.md` is accepted when reading. Calmd-generated links omit the extension. Paths, headings, blocks, embeds, nested links, multiline links, and links in inline, fenced, or indented code are ignored. A case-insensitive target with more than one matching filename is ambiguous and does not resolve.

A missing target is created only after the source note flushes successfully. Rust returns the actual collision-resolved filename stem. The editor rewrites the clicked occurrence when canonicalization changes it, then flushes that rewrite before opening the destination. Custom display text is preserved. A display value that exactly matches the previous title follows a rename to the new title.

## Current navigation flow

`NoteNavigation` in `src/noteNavigation.ts` owns an application history containing composer and note locations. Transitions begin with a generation token and are committed only after the current editing session flushes and the destination reads successfully.

The current flow is:

1. Flush the current note, if one is open.
2. Read or resolve the destination.
3. Check that the transition generation is still current.
4. Commit the history entry and replace the editing session.

Back and Forward move through note locations and saved composer thoughts. Home adds a blank composer location, so returning Home is reversible. New destinations truncate forward history. Renames update every historical occurrence of the old key. Self-navigation does not add a duplicate note entry.

The navigation owner also handles backlinks, modifier-click wiki links, and the title-bar controls. A conflict or failed save leaves the current note open and prevents a destination from being created or opened.

## Current editor integration

CodeMirror uses a small Lezer inline extension in `src/wikiLinks.ts`. It recognizes supported wiki links only in Markdown inline content and leaves code blocks and inline code alone. `src/MarkdownEditor.tsx` decorates inactive links as Live Preview text and restores the source syntax when the cursor or a selection touches a link.

A primary Ctrl-click on Linux and Windows, or Cmd-click on macOS, captures the link's document range. CodeMirror changes map that range while the asynchronous operation runs. Before applying a canonical replacement, the editor checks the range, original text, target, and authoritative body. Rust receives link targets, never CodeMirror UTF-16 offsets.

## Current derived index

The schema-version-2 SQLite database stores normalized filename identities and outgoing links beside the title, body, revision, and modification time used for literal retrieval. FTS5 indexes titles and bodies. `note_links` supports on-demand backlinks, and foreign keys remove link rows with their source notes.

Reconciliation scans the vault directly, parses links from every top-level Markdown note, and replaces note and link rows in one transaction. Create and save update one note best-effort. Rename triggers a full rescan because rename propagation cannot depend on derived state. A dirty or recoverable index is reconciled before search or backlink reads. Index failures do not roll back a successful Markdown write.

Backlink resolution requires one unambiguous target filename identity and returns each source note once. Broken links become backlinks after the target exists and the index reconciles. Ambiguous case-folded filenames return no backlinks.

## Current coordinated rename

`NotePersistence::rename_with_links` scans Markdown files rather than querying SQLite. It captures revisions, rewrites incoming links and self-links, serializes the renamed note, and installs all changes through `.calmd-operation.json`.

Ordinary failures restore the original files. If the process stops before the journal is marked committed, startup recovery restores backups and removes staged files. If it stops after commit, recovery keeps the installed files and finishes cleanup. Malformed or unsafe recovery data blocks mutation. The derived index is reconciled after a successful operation.

The complete original file remains recoverable because the rename strategy uses same-filesystem hard-link backups. A filesystem cannot atomically replace a file and change its name in one portable operation, so the journal covers the multi-file installation window.

## Remaining limitations

- Filesystem watching and deletion are not implemented.
- Only one selected vault and top-level Markdown files are supported.
- Browser or operating-system history, persisted history, cursor restoration, and scroll restoration are deferred.
- Paths, headings, blocks, embeds, multiline links, links in code, and ambiguous filename identities remain unsupported.
- Embeddings, semantic retrieval, and combined ranking remain outside the current phase.

## Validation

Rust and TypeScript tests cover link extraction, code exclusion, aliases, Unicode and `.md` targets, ambiguous filenames, unsafe-title canonicalization, flush-gated navigation, failed transitions, mapped concurrent edits, rename propagation, journal recovery, backlink deduplication, index rebuilds, and stale outgoing links.

The end-to-end check is:

1. Create note A.
2. Write `[[Another note]]`.
3. Ctrl-click or Cmd-click the link.
4. Confirm the source flushes and the target opens or is created.
5. Use Back to return to A, then Home to return to the composer.
6. Open the target's backlinks and confirm A appears.
7. Rename the target and verify A's Markdown link updates.

## Sources

- [Obsidian: Create a link](https://obsidian.md/help/link-notes)
- [Obsidian: Aliases and `[[target|display]]`](https://obsidian.md/help/aliases)
- [CodeMirror: Decorations and event handlers](https://codemirror.net/examples/decoration/)
- [CodeMirror reference](https://codemirror.net/docs/ref/)
- [MDN: `history.pushState`](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState)
- [MDN: `popstate`](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event)
- [SQLite: Foreign Key Support](https://www.sqlite.org/foreignkeys.html)
