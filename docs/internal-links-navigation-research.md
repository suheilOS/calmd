# Internal links and navigation research

## Research conclusion

This is the right next phase before embeddings. The existing architecture already provides the important foundations: authoritative Rust persistence, conflict-safe flushing, a rebuildable SQLite index, CodeMirror, and an on-demand backlinks surface.

The phase should be treated as **one linked consistency feature**, not three independent UI additions. Link identity, rename propagation, navigation, and backlink derivation must share one format contract.

## 1. Current architecture fit

### Ready to reuse

- `NoteEditingSession.flush()` already serializes pending saves and blocks navigation on conflicts: `src/noteEditing.ts`
- `create_note` already performs authoritative exact-title open-or-create: `src-tauri/src/storage.rs`
- Search reconciliation already handles:
  - full vault scans
  - transactional derived-state replacement
  - immediate best-effort updates after writes
  - schema rebuilds
- CodeMirror already uses custom Lezer extensions, decorations, and view plugins: `src/MarkdownEditor.tsx`
- `Cmd/Ctrl + [` and the return button already share `onReturn`: `src/NoteEditor.tsx`
- The backlinks popover is isolated and can fetch only when requested without exposing collection scale.

### Gaps that matter

1. `create_note` accepts a **visible title**, while ADR 0001 says links target a **safe filename**.
2. `rename_note` only changes the current file; it cannot yet satisfy ADR 0001’s promise that incoming links update together.
3. `useNoteEditing.begin()` disposes the current session immediately. A note-to-note navigation API must flush before switching.
4. The current return action always closes the note and clears the composer; it has no note history.
5. Search’s schema is named and structured as search-only, but backlinks should live in the same derived database and reconciliation transaction.

## 2. ADR recommendation

### Supported syntax

Support only:

```md
[[target]]
[[target|display text]]
```

For this phase:

- `target` identifies a top-level Markdown filename stem.
- `.md` is accepted when reading but omitted in canonical links.
- Matching follows the existing case-insensitive filename collision policy.
- `display text` is optional and does not affect identity.
- Do not support paths, headings, blocks, embeds, nested links, or multiline links yet.
- Ignore link-like text inside inline code and fenced or indented code blocks.

Examples:

```md
[[Another note]]
[[Research- Q1|Research: Q1]]
[[CON note|CON]]
```

This preserves the existing ADR’s distinction:

- Identity: safe filename
- Presentation: visible title

### Canonical link generation

When Calmd inserts or rewrites a link:

```text
title == filename stem → [[stem]]
title != filename stem → [[stem|title]]
```

Users may manually write either supported form, but Calmd-generated links should always be canonical.

### Broken links

Recommended behavior:

- Typing a broken link does not create anything.
- It remains ordinary Markdown and is visually subdued.
- `Cmd/Ctrl + click` invokes an authoritative Rust link-opening command.
- If absent, create the note and return its actual collision-resolved key.
- If creation changes the target—because of unsafe characters or a numbered collision—the source link must be rewritten to the canonical target and saved.
- Invalid or ambiguous targets remain unchanged and show an error.
- Self-links do not add a duplicate history entry.

### Ambiguity

External tools can create `Foo.md` and `foo.md` on a case-sensitive filesystem even though Calmd would not. A case-insensitive target matching both must be treated as ambiguous rather than choosing one arbitrarily.

### Rename propagation

For an internal rename:

- Allocate the actual destination key first, including collision suffixes.
- Rewrite incoming links from the old key stem to the actual new key stem.
- Preserve custom display text.
- Update display text only when it exactly represented the old title.
- Rewrite self-links in the renamed note.
- If another source changed externally, abort before mutation where possible rather than silently overwriting it.

Example:

```md
[[Old]]
[[Old|Old]]
[[Old|Historical name]]
```

Renaming to `New title` becomes:

```md
[[New title]]
[[New title]]
[[New title|Historical name]]
```

The second link deliberately loses its redundant alias. Canonical links use an alias only when the visible text differs from the safe filename stem.

## 3. Authoritative link command

The existing `create_note(title)` operation cannot fully represent filename-targeted links and canonical source rewrites.

Keep its underlying `find_or_create` behavior, but expose a link-specific Rust command such as:

```ts
openNoteLink({
  target: string
}): Promise<{
  note: Note
  canonicalTarget: string
}>
```

Resolution order:

1. Validate and normalize the target.
2. Resolve it against actual note keys.
3. Reject ambiguity.
4. If missing, create using the target as the proposed visible title.
5. Return the actual key stem after filename sanitization and collision handling.

The current note must be flushed successfully **before** invoking an operation that may create a missing target. A conflict or failed save therefore leaves no newly created target behind.

Canonical source rewriting also needs an explicit concurrency rule. On modifier-click, the frontend must:

1. Capture the editing-session generation, original link text, and the clicked occurrence as a pending CodeMirror range that maps through subsequent transactions.
2. Flush the current session; abort before resolving or creating the target if the flush fails.
3. Confirm that the same parsed link still occupies the mapped occurrence in the same session, then invoke the Rust command.
4. After the command returns, reparse the current document rather than trusting the original offsets.
5. Rewrite only when the mapped occurrence is still a `WikiLink` with the captured original text and target.
6. Abort the rewrite and navigation if the session changed or that occurrence no longer matches.
7. If canonicalization changed the source, flush the rewrite successfully before switching notes.

This permits unrelated edits while resolution is in flight without applying a replacement to stale text. A target may still be created if the user changes the link after the preflight flush while the Rust command is running, but Calmd must never rewrite a different occurrence or navigate from a changed session.

Do not pass CodeMirror offsets to Rust: CodeMirror positions are UTF-16 offsets, while Rust string ranges are byte offsets.

## 4. Navigation recommendation

Use an **application-owned navigation stack** for this phase rather than `window.history`.

Example state:

```ts
type Location =
  | { type: 'composer'; thought: string }
  | { type: 'note'; key: string }
```

Flow:

```text
composer → A → B
stack: [composer, A, B]

Back from B:
flush B → read A → switch session

Back from A:
flush A → restore composer query
```

Why not the browser History API yet:

- `popstate` happens after the history position changes.
- An asynchronous flush or conflict cannot veto that traversal cleanly.
- Recovery would require moving forward again and suppressing a second `popstate`.
- Tauri currently has no browser forward/back controls to integrate.

An app-owned stack gives the required browser-style behavior with reliable save gating. Forward navigation, persisted history, cursor restoration, and scroll restoration can remain deferred.

### Required session API

Add a flush-without-close operation:

```ts
flush(): Promise<boolean>
```

Navigation should be:

1. Flush the current session.
2. Abort and remain on the current note if it fails.
3. Read or open the destination.
4. Replace the editing session.
5. Commit the history transition only after success.

Move `Cmd/Ctrl + [` handling to the navigation owner rather than keeping it as editor-specific “return home” logic.

History entries must be updated when a rename changes a key, including older occurrences of that key in cyclic navigation.

## 5. CodeMirror implementation

Prefer a custom Lezer Markdown extension over a document-wide regex.

Define nodes such as:

```text
WikiLink
WikiLinkMark
WikiLinkTarget
WikiLinkDisplay
```

A Lezer inline parser will naturally run only in Markdown inline content, avoiding false links in fenced and inline code. The current editor already passes custom extensions alongside GFM.

Then add a `ViewPlugin` that:

- Decorates visible `WikiLink` nodes.
- Recomputes after document, syntax-tree, or viewport changes.
- Handles `mousedown`.
- Requires exactly `Meta` or `Ctrl` plus primary click.
- Uses `view.posAtDOM()` and the syntax tree to locate the clicked link.
- Returns `false` for normal clicks so editing and cursor placement remain unchanged.

Do not replace links with atomic widgets. Keep literal source visible and editable.

CodeMirror’s official decoration example specifically demonstrates both view-plugin event handlers and `[[...]]` matching, although Calmd should use its syntax tree for Markdown correctness.

## 6. Backlink index

Extend the existing derived database rather than creating another database.

Add a normalized filename identity to the derived `notes` table and index it without a uniqueness constraint:

```sql
CREATE TABLE notes (
  id               INTEGER PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE,
  normalized_key   TEXT NOT NULL,
  title            TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  body             TEXT NOT NULL,
  revision         TEXT NOT NULL,
  modified_at_ms   INTEGER NOT NULL
);

CREATE INDEX notes_normalized_key
ON notes(normalized_key);

CREATE TABLE note_links (
  source_key            TEXT NOT NULL,
  position              INTEGER NOT NULL,
  target_normalized_key TEXT NOT NULL,
  PRIMARY KEY (source_key, position),
  FOREIGN KEY (source_key) REFERENCES notes(key) ON DELETE CASCADE
);

CREATE INDEX note_links_target
ON note_links(target_normalized_key);
```

`normalized_key` and `target_normalized_key` use the same case-folded canonical filename representation, including `.md`. They are intentionally not unique because an externally edited case-sensitive vault may contain both `Foo.md` and `foo.md`. `position` is a Rust-internal byte position used only to distinguish occurrences.

SQLite foreign-key enforcement is disabled by default for each connection. Calmd must execute:

```sql
PRAGMA foreign_keys = ON;
```

when opening every connection before relying on `ON DELETE CASCADE`. Schema validation should also verify that foreign-key enforcement is active. The alternative is to delete source link rows explicitly in every reconciliation and replacement path; enabling and validating foreign keys is preferable because it preserves the declared invariant.

A link target resolves only when exactly one row in `notes` has its `normalized_key`. Backlink queries must first require that the current note’s normalized key also has exactly one matching note, then return links with that normalized target. Thus `Foo.md` and `foo.md` cause `[[Foo]]` to resolve to neither note rather than returning the same backlinks for both.

Return each source note once:

```ts
type Backlink = {
  key: string
  title: string
}
```

No backlink count or complete-vault overview is necessary.

### Lifecycle

During reconciliation:

1. Parse each note body for supported links.
2. Upsert the note.
3. Replace that source note’s derived links.
4. Remove stale notes and links.
5. Commit everything in one SQLite transaction.

After create, save, or rename:

- Update search content and outgoing links in one best-effort derived-index transaction.
- A new target may resolve previously broken links without modifying their rows because rows store normalized target identity.
- A derived-index failure must not roll back successful Markdown writes.
- Opening backlinks should force reconciliation first when the shared dirty flag is set.

Bump `SCHEMA_VERSION` from 1 to 2 and rebuild. A data migration is unnecessary because all data is derived.

Internally, `SearchState` should eventually become `VaultIndexState` or `DerivedIndexState`. Renaming it during this phase is reasonable but not required for behavior.

## 7. Rename propagation is the largest risk

Updating one filename plus several source files is not portably atomic. The current single-note staged rename cannot simply be followed by best-effort source edits, because ADR 0001 promises links and filename update together.

Authoritative propagation must not depend on SQLite. The derived index may be stale, missing, corrupt, or unavailable, so every internal rename must scan and parse the Markdown vault itself to discover incoming links. `note_links` may support the backlinks UI but must never be the sole list of files mutated by a rename.

Recommended transaction approach:

1. Scan and parse the Markdown vault to identify every affected source file.
2. Capture revisions.
3. Construct every replacement in memory.
4. Stage and sync every resulting file.
5. Reverify all captured revisions and destination collisions.
6. Write and sync a recoverable operation journal.
7. Back up originals using the existing same-filesystem strategy.
8. Install all replacements.
9. Mark the journal committed and sync it only after every replacement is installed.
10. Remove backups and the journal.
11. Update the derived index only after the Markdown transaction commits.

### Crash-recovery decision

Preserve ADR 0001’s coordinated-update guarantee by adding a recoverable, vault-local operation journal rather than weakening the guarantee.

The temporary hidden journal should be ignored by normal note scans and record:

- an operation identifier and vault identity
- old and new note keys
- every original, staged, and backup path
- captured revisions
- whether installation has committed

The journal and relevant directory metadata must be synced before destructive steps where the platform supports it. On startup or focus, Calmd must recover a journal before normal reconciliation:

- Before the committed marker, restore all originals from backups and discard staged replacements.
- After the committed marker, preserve installed replacements and finish removing backups and staged files.
- If the journal is malformed or recovery cannot determine a safe state, stop vault mutation and surface a recovery error rather than guessing.

This journal is transient recovery metadata, not note identity or derived knowledge data. Keeping it beside the files allows recovery artifacts and the operation record to move together with the portable vault. Successful operations remove it.

Ordinary failures should still roll back immediately. The journal covers process or machine failure during the multi-file installation window. The ADR and implementation brief should document this recovery protocol before implementation.

## 8. Recommended delivery sequence

1. **Link ADR and shared fixtures**
   - Syntax, normalization, invalid cases, code exclusion, ambiguity, broken links, and rename behavior.
   - Use the same fixture corpus in Rust and TypeScript tests.

2. **Rust link parser and resolution**
   - Key normalization.
   - Link extraction.
   - Authoritative open-or-create link command.
   - Ambiguity handling.

3. **Flush-gated navigation stack**
   - Composer → A → B.
   - Back to A, then composer.
   - Rename-aware keys.
   - Reuse the button and `Cmd/Ctrl + [`.

4. **CodeMirror interaction**
   - Lezer extension.
   - Source-mode decoration.
   - Modifier-click only.
   - Canonical rewrite after missing-target creation.

5. **Derived backlink index**
   - Schema v2.
   - Reconciliation and incremental replacement.
   - On-demand command.

6. **Backlinks popover**
   - Fetch only when opened.
   - Deduplicate source notes.
   - Clicking a source uses the same flush-gated navigation path.

7. **Rename propagation**
   - This can be developed earlier, but completion should not be declared without it because it is already promised by ADR 0001.

## 9. Required tests

### Link contract

- Basic and aliased links.
- Redundant aliases are removed during canonical rewriting.
- Unicode targets.
- Optional `.md`.
- Empty, multiline, nested, path, heading, and embed rejection.
- Links ignored inside inline and fenced code.
- Case-insensitive resolution.
- Ambiguous external filenames.
- Unsafe-title and collision canonicalization.

### Navigation

- Composer → A → B → A → composer.
- Flush waits for an in-flight autosave.
- Failed save or conflict blocks navigation and creates no missing target.
- Failed destination read leaves history unchanged.
- Missing target creation rewrites and saves its canonical target.
- A concurrent edit to the clicked occurrence aborts canonical rewriting and navigation.
- Unrelated edits do not cause a stale occurrence to be rewritten.
- Renamed keys remain valid in history.
- Self-navigation does not push.

### Backlinks

- Multiple links from one source produce one popover item.
- Broken links become backlinks after target creation.
- `Foo.md` and `foo.md` make `[[Foo]]` resolve to neither note and return no backlinks for that target.
- Foreign-key cascades are active on every database connection.
- Save removes stale outgoing links.
- Rename updates source Markdown and backlinks.
- Rename propagation still succeeds when the derived database is unavailable.
- External edits reconcile on focus.
- Missing or corrupt schema v2 rebuilds.
- Index failure does not fail a Markdown save.
- Journal recovery rolls back every pre-commit crash checkpoint and finishes cleanup after every post-commit checkpoint.

## Completion test

1. Create note A.
2. Write `[[Another note]]`.
3. `Cmd/Ctrl + click` it.
4. Confirm the source flushes and the target opens or is created.
5. Press `Cmd/Ctrl + [` and return to A.
6. Press it again and return to the composer.
7. Open “Another note’s” backlinks popover.
8. Confirm A appears.
9. Open A from the popover through the same navigation path.
10. Rename “Another note” and verify A’s Markdown target updates.

## Sources

- [Obsidian: Create a link](https://obsidian.md/help/link-notes)
- [Obsidian: Aliases and `[[target|display]]`](https://obsidian.md/help/aliases)
- [CodeMirror: Decorations and event handlers](https://codemirror.net/examples/decoration/)
- [CodeMirror reference](https://codemirror.net/docs/ref/)
- [MDN: `history.pushState`](https://developer.mozilla.org/en-US/docs/Web/API/History/pushState)
- [MDN: `popstate`](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event)
- [SQLite: Foreign Key Support](https://www.sqlite.org/foreignkeys.html)
