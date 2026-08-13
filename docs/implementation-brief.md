# Product implementation brief

## Current phase: literal retrieval, Markdown editing, and internal linking

The interface reads and writes top-level Markdown notes in one user-selected vault through dedicated Rust commands. Markdown is the sole source of truth. A disposable schema-version-2 SQLite/FTS5 database in Tauri app data provides ranked literal retrieval and derived backlinks without placing system metadata in the vault.

### Completed

- Blank composer with no collection overview or recent-notes feed
- Ranked title and body retrieval through a rebuildable SQLite/FTS5 trigram index
- Literal match highlighting in composer result titles and excerpts
- Concise matching excerpts returned by Rust without loading the vault into frontend memory
- Exact-title matching that opens the existing note instead of creating a duplicate
- Keyboard and pointer navigation through retrieval results
- Named vault creation inside a user-selected parent directory, with the canonicalized child path persisted
- Rust create, read, save, rename, and link open-or-create commands using relative note keys
- Framework-independent Note persistence behind the Tauri commands, with filesystem behavior tested through its interface
- Framework-neutral Note editing sessions that own autosave sequencing, canonical save reconciliation, conflict state, and flush-before-return behavior
- Canonical `# Title` Markdown serialization and content-preserving external-file parsing
- Portable filename derivation with case-insensitive collision handling
- Atomic saves, recoverable journaled multi-file renames, incoming-link rewriting, and content-hash conflict detection
- Minimal conflict recovery by reloading the external version from disk
- Transactional launch and window-focus reconciliation without a filesystem watcher
- Best-effort index updates after create, save, and rename, with Markdown-write success independent of index availability
- Automatic recreation of missing, incompatible, or corrupt derived databases
- Minimal full-page editor with `[[target]]` and `[[target|display text]]` Live Preview links
- Conflict-safe modifier-click link navigation that resolves or creates targets and canonicalizes the clicked occurrence
- Application-owned Back, Forward, and Home navigation with save-gated transitions
- Focused random-note rediscovery from the reconciled index, with current-note exclusion when possible
- On-demand backlinks derived from unambiguous normalized filename identity
- Responsive light and dark presentation using a restrained three-level type scale

### Storage behavior

Calmd recognizes a note title only when a non-empty `# Title` is the first nonblank line, optionally preceded by a UTF-8 BOM. If that leading title is absent, the filename stem is shown as the title and the complete file remains the editable body. Calmd writes canonical files as `# Title\n\nBody` and canonicalizes edited titles by trimming surrounding whitespace and collapsing repeated internal whitespace.

Renames stage and sync the complete new file in the vault, verify the original revision and collision policy before mutation, hard-link the original to a temporary backup, and install the staged file without overwriting an existing destination. An installation failure restores the original path and removes the staged file. Case-only renames use the same path through a distinct temporary backup.

A filesystem cannot provide one portable atomic operation that simultaneously replaces file content and changes its name. There is therefore a brief interval between unlinking the original path and installing the new path. Calmd restores the original after ordinary errors, but a process or machine failure in that interval can leave the complete original in a `.calmd-backup-*.tmp` file. The strategy also requires same-filesystem hard-link support inside the vault. As with atomic save replacement, an external process can still race the final revision check. Cleanup failures are logged rather than reported as failed saves after the new note has already been committed.

The search database stores note keys, normalized filename identities, titles, bodies, revisions, filesystem modification times, and outgoing links under Tauri app data. Schema version 2 derives backlinks while FTS5 indexes titles and bodies with title-weighted BM25 ranking and trigram substring matching. Non-exact results use match-specific FTS5 snippets with a 96-token context window. Rust removes visible `[[...]]` brackets and bounds every excerpt at 240 Unicode characters before Tauri IPC. Exact-title results bypass FTS, read at most 480 body characters, and return one result with a bounded leading excerpt. Random rediscovery chooses a uniform row offset from the reconciled indexed notes, optionally excluding the active key, then reads the selected Markdown source before returning it. Launch and focus scans reconcile the complete top-level Markdown snapshot transactionally. Missing, incompatible, and corrupt databases are discarded and rebuilt. Index failures never roll back a successful Markdown write.

### Remaining limitations and deferred work

- Paths, headings, blocks, embeds, multiline wiki links, and wiki links inside code
- Ambiguous case-insensitive filename identities resolve to neither note
- Filesystem watching, deletion, nested folders, and multiple vaults
- Operating-system/browser history integration, persisted history, and cursor or scroll restoration

## Current experience

The app opens to a single composer. As the user types, it searches existing notes, shows relevant matches, and offers to create a new note. When the composer is empty, a quiet **Open a random note** action offers rediscovery without showing collection scale; it folds away while typing. While Calmd is focused, `Ctrl+N` safely flushes the active note and creates the first available visible title in the sequence `Untitled`, `Untitled 1`, `Untitled 2`, and so on. There is no sidebar, file tree, dashboard, graph, note count, or recent-notes feed.

## Current navigation

Knowledge is accessed through literal retrieval, inline `[[links]]`, backlinks, random rediscovery, and application-owned back and forward navigation. While Calmd is focused, `Alt+Home` returns Home through the same save-gated navigation flow as the title-bar control, and `Cmd/Ctrl+Alt+R` opens a random indexed note through the same save-gated note transition. The random action prefers a different note from the current one and leaves a one-note editor unchanged. The full collection is never shown by default.

## Current note storage

- Plain Markdown files in one vault folder
- No folders, tags, or user-defined properties
- SQLite indexes and system metadata in Tauri app data
- Markdown remains the source of truth

## Current search

Literal retrieval uses SQLite FTS5 trigram matching for title and body text, title-weighted BM25 ranking, exact-title precedence, bounded match-specific excerpts, and client-side highlighting of literal query matches.

## Current editor

- Full-page CodeMirror Markdown editor
- Automatic saving with conflict detection and reload recovery
- Live Preview treatment for supported wiki links
- Minimal formatting controls
- Backlinks hidden until requested
- No permanent secondary panels

## Current technology

- React + Vite
- Base UI
- Tauri 2 desktop shell
- Tailwind CSS
- CodeMirror
- Rust
- SQLite with FTS5

## Delivery history

1. **Completed:** Composer prototype with mock notes
2. **Completed:** Minimal note editor
3. **Superseded:** Prototype literal title and body retrieval over mock notes
4. **Superseded:** Prototype in-memory note creation and saving
5. **Completed:** On-demand backlinks, internal wiki links, and conflict-safe navigation
6. **Completed:** Tauri Markdown vault integration with atomic, conflict-safe saving and coordinated rename rewriting
7. **Completed:** Rebuildable schema-version-2 SQLite/FTS5 literal search, ranked excerpts, and backlink index
8. **Completed:** Save-gated random-note rediscovery with a focused-window `Cmd/Ctrl+Alt+R` shortcut

Semantic retrieval and embeddings were considered during planning, but current literal retrieval is effective, predictable, and lightweight for the intended workflow and better aligned with Calmd's minimal product philosophy. They are outside Calmd's current product direction and are not planned unless usage evidence shows repeated retrieval failures caused by differences in wording.

## Constraint

Every feature must pass one test:

> Does this help the user retrieve or develop the current thought without exposing the scale of the entire collection?
