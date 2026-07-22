# Derived SQLite + FTS5 index research

## Recommendation

Proceed with a rebuildable SQLite database in Tauri’s app-data directory, using:

- `rusqlite` with bundled SQLite
- A regular `notes` table for derived metadata
- An external-content FTS5 table indexing only `title` and `body`
- The FTS5 trigram tokenizer to preserve Calmd’s current substring-oriented, multilingual retrieval
- Transactional reconciliation on launch and window focus
- Immediate best-effort index updates after create, save, and rename
- Automatic recreation for missing, incompatible, or corrupt databases

## Current architecture impact

Today:

- `open_vault` scans and returns every Markdown note: `src-tauri/src/storage.rs:122`
- React stores the entire vault and searches synchronously: `src/App.tsx:35-62`
- Exact-title detection prevents accidental duplicate creation: `src/App.tsx:204-215`
- Focus triggers another complete scan into frontend memory: `src/App.tsx:85-92`
- Retrieval uses case-folded substring checks and returns three results: `src/notes.ts:28-51`

The next phase should remove the frontend `notes` collection while preserving exact-title behavior and the three-result composer presentation.

## Recommended storage design

Database path:

```text
app.path().app_data_dir()/search-index.sqlite3
```

With the current identifier, Tauri resolves app-data beneath the platform data directory plus `com.calmd.desktop`. This is the intended API behavior in [Tauri’s implementation](https://github.com/tauri-apps/tauri/blob/08acfb3fa04945a6a4f822d66c7556111d9385aa/crates/tauri/src/path/desktop.rs#L244-L250).

Suggested schema:

```sql
CREATE TABLE notes (
  id               INTEGER PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  body             TEXT NOT NULL,
  revision         TEXT NOT NULL,
  modified_at_ms   INTEGER NOT NULL
);

CREATE INDEX notes_normalized_title
ON notes(normalized_title);

CREATE VIRTUAL TABLE note_fts USING fts5(
  title,
  body,
  content='notes',
  content_rowid='id',
  tokenize='trigram case_sensitive 0 remove_diacritics 1'
);
```

Add standard insert, update, and delete triggers from `notes` into `note_fts`.

This design:

- Stores every required field in `notes`
- Tokenizes only meaningful searchable content
- Avoids FTS duplicating complete title and body values
- Allows ordinary constraints on `key`
- Supports `bm25()` and `snippet()`

SQLite documents the external-content pattern and required triggers in its [FTS5 external-content guidance](https://www.sqlite.org/fts5.html#external_content_tables).

Also store a schema version and canonical vault path, using `PRAGMA user_version` plus a small metadata table. A different vault path or unknown schema version should cause a clean rebuild.

## Tokenizer decision

### Recommend trigram

Calmd currently performs substring matching, not word-only matching. FTS5’s trigram tokenizer is explicitly designed for general substring retrieval and works better for:

- Partial words while typing
- Technical strings such as `C++`
- Japanese and other text without whitespace-delimited words
- Matches in the middle of a token

SQLite documents that trigram queries require at least three Unicode characters. This aligns with Calmd’s current filtering of terms shorter than three characters. See [SQLite’s trigram tokenizer documentation](https://www.sqlite.org/fts5.html#the_trigram_tokenizer).

A local prototype confirmed that a Japanese substring matched with trigram but not with `unicode61`.

Tradeoff: trigram indexes are larger than word-token indexes. That is acceptable for this local, derived phase and better preserves current retrieval semantics.

## Search contract

Suggested Rust command:

```ts
type SearchResponse = {
  results: SearchHit[]
  hasExactMatch: boolean
}

type SearchHit = {
  key: string
  title: string
  excerpt: string
}
```

Behavior:

1. Normalize the title query in Rust and check `normalized_title` first.
2. If exact, return only that note and `hasExactMatch: true`.
3. Otherwise run FTS and return at most three results.
4. Open a selected result through the existing `read_note` command.

An explicit exact-title query is necessary because BM25 ranking alone cannot guarantee the duplicate-prevention behavior currently provided by React.

Suggested FTS ordering:

```sql
SELECT
  notes.key,
  notes.title,
  snippet(note_fts, 1, '', '', ' … ', 32) AS excerpt
FROM note_fts(?, 'bm25(8.0, 1.0)')
JOIN notes ON notes.id = note_fts.rowid
ORDER BY rank, notes.normalized_title, notes.key
LIMIT 3;
```

FTS5 assigns numerically lower BM25 values to better matches and supports per-column weights, so `8.0` gives titles substantially more influence than bodies. See [BM25](https://www.sqlite.org/fts5.html#the_bm25_function) and [snippet](https://www.sqlite.org/fts5.html#the_snippet_function).

### Query safety

Never pass raw composer text directly as FTS query syntax.

Construct a bound FTS expression from quoted phrases:

- Escape embedded `"` by doubling it
- Include the complete query phrase
- Include whitespace-separated terms of at least three characters joined with `OR`
- Deduplicate terms
- Keep the backend query-length limit consistent with the composer’s 120-character limit

For example:

```text
"quiet process" OR "quiet" OR "process"
```

This rewards the full substring while still returning notes matching either term.

## Reconciliation lifecycle

### Launch and focus

A reconciliation should:

1. Lock vault mutation for the duration.
2. Scan all top-level regular `.md` files using the existing parsing rules.
3. Read content, calculate revision, and collect filesystem modification time.
4. Abort before changing SQLite if any required scan operation fails.
5. In one SQLite transaction:
   - Upsert every scanned note
   - Record all scanned keys in a temporary table
   - Delete index rows whose keys were not scanned
   - Update the stored canonical vault path
6. Commit atomically.

Deleting stale SQLite rows is necessary reconciliation, not a Markdown deletion feature. No vault file is removed.

Do not trust modification time alone to skip reading files. Filesystems can have coarse timestamps, and external tools can preserve timestamps. The revision hash should remain authoritative for content identity; modification time is indexed metadata.

### Create, save, and rename

Update the index immediately after successful filesystem mutation so returning to the composer does not show stale results.

Important failure rule:

> Once Markdown has been successfully written, an index failure must not turn that save into a reported note-save failure.

Instead:

- Return the successfully saved `Note`
- Mark the index dirty
- Log the index error
- Force a full reconciliation before the next search

A process crash between the Markdown write and index update is repaired by the next launch reconciliation.

All vault and index operations should use a consistent lock order—vault first, index second—to prevent an older rescan snapshot overwriting a newer save.

## Missing and corrupt database recovery

Recommended startup sequence:

1. Create the app-data directory.
2. Open or create the database.
3. Verify schema and application version.
4. Run `PRAGMA quick_check(1)`.
5. Run the FTS external-content integrity check:

```sql
INSERT INTO note_fts(note_fts, rank)
VALUES('integrity-check', 1);
```

Passing `rank = 1` makes FTS5 compare its index against the external content table. SQLite documents this at [FTS5 integrity-check](https://www.sqlite.org/fts5.html#the_integrity_check_command).

Recreate the database when:

- It is missing
- It is not an SQLite database
- SQLite reports database corruption
- The schema version is unsupported
- FTS integrity fails

Do **not** recreate it for permission errors, disk-full errors, lock contention, or generic I/O failures. Those should be surfaced without risking repeated deletion.

`rusqlite` exposes distinct `DatabaseCorrupt` and `NotADatabase` codes in its [error mapping](https://github.com/rusqlite/rusqlite/blob/4707a1fce4d1bdbc2c4fc7b35266c13e31643cd8/libsqlite3-sys/src/error.rs#L26-L55).

Close all connections before removing the database and any associated journal or WAL sidecars. Do not remove a journal before first allowing SQLite to attempt normal crash recovery.

## Rust dependency

Use the minimal bundled feature:

```toml
rusqlite = {
  version = "0.40",
  default-features = false,
  features = ["bundled"]
}
```

Bundling avoids relying on each platform’s system SQLite configuration. Rusqlite’s bundled build explicitly compiles SQLite with `SQLITE_ENABLE_FTS5` in [its build script](https://github.com/rusqlite/rusqlite/blob/4707a1fce4d1bdbc2c4fc7b35266c13e31643cd8/libsqlite3-sys/build.rs#L128-L137).

`bundled-full` is unnecessary and enables many unrelated features.

## Frontend integration

Replace the synchronous `useMemo` search with:

- A 100–150 ms debounce
- A monotonically increasing request ID
- Ignoring responses older than the latest request
- Immediate clearing for an empty query
- Rerunning the current query after a focus reconciliation
- An immediate authoritative search before composer submission, so Enter cannot create a duplicate while a debounced request is pending

Keep `ComposerScreen` visually unchanged. It should receive `SearchHit[]` and render the returned excerpt instead of deriving one from the complete note body.

An index or search failure should not set `vaultReady` to false. The vault and editor remain usable independently of SQLite.

Tauri recommends async commands for heavy work; rescans and SQLite work should run through its blocking executor rather than freezing the UI.

## Required validation

Automated Rust tests should cover:

1. Initial build from Markdown.
2. Incremental update after external content change.
3. External rename represented as old-row removal plus new-row insertion.
4. Stale index row pruning without deleting Markdown.
5. Missing database recreation.
6. Garbage or corrupt database recreation.
7. Exact Unicode title matching.
8. Quotes and FTS metacharacters never producing syntax errors.
9. Title matches ranking above equivalent body-only matches.
10. Japanese substring and accent-insensitive retrieval.
11. Excerpts centered near body matches.
12. Failed index updates not changing successful note-save results.
13. Database files never appearing inside the vault.

Completion test:

1. Create several real Markdown notes.
2. Launch Calmd and search through the composer.
3. Close Calmd.
4. Delete `search-index.sqlite3`.
5. Relaunch.
6. Confirm the same notes and excerpts are searchable.
7. Confirm every Markdown file is byte-for-byte intact.

## Not included

This design adds no embeddings, backlink discovery, watcher, nested-folder traversal, or Markdown deletion. The SQLite database will contain plaintext derived copies of note content in app data; encryption is outside this phase.
