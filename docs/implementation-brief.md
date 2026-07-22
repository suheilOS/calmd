# Product Implementation Brief

## Current phase: portable Markdown vault foundation

The interface now reads and writes top-level Markdown notes in one user-selected vault through dedicated Rust commands. Markdown is the source of truth; there is no database or derived index yet.

### Completed

- Blank composer with no collection overview or recent-notes feed
- Literal title and body retrieval over scanned Markdown notes
- Exact-title matching that opens the existing note instead of creating a duplicate
- Keyboard and pointer navigation through retrieval results
- Named vault creation inside a user-selected parent directory, with the canonicalized child path persisted
- Rust create, read, save, and rename commands using relative note keys
- Canonical `# Title` Markdown serialization and content-preserving external-file parsing
- Portable filename derivation with case-insensitive collision handling
- Atomic saves, staged transactional renames, and content-hash conflict detection
- Minimal conflict recovery by reloading the external version from disk
- Launch and window-focus vault rescans without a filesystem watcher
- Minimal full-page editor with return navigation
- On-demand backlinks popover with static empty-state content
- Responsive light and dark presentation using a restrained three-level type scale

### Storage behavior

Calmd recognizes a note title only when a non-empty `# Title` is the first nonblank line, optionally preceded by a UTF-8 BOM. If that leading title is absent, the filename stem is shown as the title and the complete file remains the editable body. Calmd writes canonical files as `# Title\n\nBody` and canonicalizes edited titles by trimming surrounding whitespace and collapsing repeated internal whitespace.

Renames stage and sync the complete new file in the vault, verify the original revision and collision policy before mutation, hard-link the original to a temporary backup, and install the staged file without overwriting an existing destination. An installation failure restores the original path and removes the staged file. Case-only renames use the same path through a distinct temporary backup.

A filesystem cannot provide one portable atomic operation that simultaneously replaces file content and changes its name. There is therefore a brief interval between unlinking the original path and installing the new path. Calmd restores the original after ordinary errors, but a process or machine failure in that interval can leave the complete original in a `.calmd-backup-*.tmp` file. The strategy also requires same-filesystem hard-link support inside the vault. As with atomic save replacement, an external process can still race the final revision check. Cleanup failures are logged rather than reported as failed saves after the new note has already been committed.

### Deferred

- SQLite, FTS5, embeddings, and combined ranking
- Inline `[[links]]` and backlink discovery
- Filesystem watching, deletion, nested folders, and multiple vaults
- Browser-history-backed navigation

## Target experience

The app opens to a single composer.

As the user types, it:

* Searches existing notes
* Shows relevant matches
* Offers to create a new note

There is no sidebar, file tree, dashboard, graph, note count, or recent-notes feed.

## Target navigation

Knowledge is accessed through:

* Search
* Inline `[[links]]`
* Backlinks
* Browser-style back navigation

The full collection is never shown by default.

## Target note storage

* Stored as plain Markdown files
* Kept in one vault folder
* No folders, tags, or user-defined properties
* SQLite stores indexes and system metadata
* Markdown remains the source of truth

## Target search

Use hybrid retrieval:

* SQLite FTS5 for exact text matching
* Embeddings for semantic similarity
* Combined ranking for final results

Results show the title and a short matching excerpt.

## Target editor

* Full-page Markdown editor
* Automatic saving
* Minimal formatting controls
* Backlinks hidden until requested
* No permanent secondary panels

## Target technology

* React + Vite
* Base UI
* Tauri 2 desktop shell
* Tailwind CSS
* CodeMirror
* Rust
* SQLite

## Delivery roadmap

1. **Completed:** Composer prototype with mock notes
2. **Completed:** Minimal note editor
3. **Prototype only:** Literal title and body retrieval over mock notes
4. **Prototype only:** In-memory note creation and saving
5. **UI placeholder only:** Backlinks popover; wiki links and backlink discovery remain deferred
6. **Completed:** Tauri Markdown vault integration with atomic, conflict-safe saving
7. **Deferred:** SQLite-derived indexing and semantic search

## Constraint

Every feature must pass one test:

> Does this help the user retrieve or develop the current thought without exposing the scale of the entire collection?

