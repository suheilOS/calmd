# Derived SQLite + FTS5 index

## Implemented design

Calmd uses a rebuildable SQLite database in Tauri's app-data directory at `search-index.sqlite3`, using:

- `rusqlite` with bundled SQLite and FTS5
- A regular `notes` table for derived note metadata
- An external-content FTS5 table indexing folded `search_title` and `search_body` fields
- The FTS5 trigram tokenizer with case folding and diacritic removal
- Explicit folding of Arabic harakat, Quranic annotation marks, and tatweel while preserving original result text
- A `note_links` table for outgoing wiki-link identities and on-demand backlinks
- Title-based unlinked mentions queried from the same derived note and FTS data
- Transactional reconciliation on launch and window focus
- Immediate best-effort index updates after create and save
- Full reconciliation after coordinated rename
- Automatic recreation for missing, incompatible, or corrupt databases

The SQLite database is derived state. It can be removed and rebuilt without changing Markdown files.

## Schema

The current schema is version 4. It stores the canonical vault path in `metadata`, does not enforce uniqueness on normalized filename or title identities, and intentionally permits case-colliding external files so links and exact-title lookup can resolve ambiguity safely.

```sql
CREATE TABLE notes (
  id               INTEGER PRIMARY KEY,
  key              TEXT NOT NULL UNIQUE,
  normalized_key   TEXT NOT NULL,
  search_key       TEXT NOT NULL,
  title            TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  body             TEXT NOT NULL,
  search_title     TEXT NOT NULL,
  search_body      TEXT NOT NULL,
  revision         TEXT NOT NULL,
  modified_at_ms   INTEGER NOT NULL
);

CREATE TABLE note_links (
  source_key            TEXT NOT NULL,
  position              INTEGER NOT NULL,
  target_normalized_key TEXT NOT NULL,
  PRIMARY KEY (source_key, position),
  FOREIGN KEY (source_key) REFERENCES notes(key) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE note_fts USING fts5(
  search_title,
  search_body,
  content='notes',
  content_rowid='id',
  tokenize='trigram case_sensitive 0 remove_diacritics 1'
);
```

Indexes support normalized-title, normalized-key, and backlink-target lookup. Triggers keep the external-content FTS table aligned with `notes`. Every connection enables foreign keys and uses a two-second busy timeout. Schema validation checks the application ID, user version, required tables, indexes, triggers, foreign keys, SQLite quick-check, and the FTS integrity check.

## Search contract

The Rust command returns:

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

1. Rust canonicalizes the query and checks normalized titles first.
2. An exact title returns only that note with `hasExactMatch: true`.
3. Otherwise FTS returns at most three results.
4. Title matches receive a higher BM25 weight than body matches.
5. Rust removes visible wiki-link brackets and bounds every excerpt at 240 Unicode characters.
6. Arabic search folding ignores harakat, Quranic annotation marks, and tatweel while excerpts retain the original Unicode text.
7. The frontend highlights literal query segments in result titles and excerpts using the same folding policy.
8. Selecting a result opens it through `read_note`; submitting an inexact thought uses the authoritative create-or-open command.

The FTS expression quotes the complete query and each whitespace-separated term of at least three characters. Embedded quotes are doubled. Raw composer text is never passed as FTS syntax, and the Rust query limit matches the 120-character composer limit.

Exact-title results bypass FTS and use at most 480 characters from the beginning of the body. Non-exact results use match-specific FTS5 snippets with a 96-token context window.

FTS5 assigns lower BM25 values to better matches. Title and body weights are `8.0` and `1.0`. The trigram tokenizer preserves substring retrieval for partial words, technical strings, Japanese text, and matches in the middle of tokens. Queries shorter than three characters contribute no FTS phrase, although exact titles still work.

## Reconciliation lifecycle

On launch and window focus, Rust scans all top-level regular `.md` files using the note parser. It reads the content, calculates the revision, records filesystem modification time, extracts outgoing links, and reconciles notes and links in one SQLite transaction. Stale index rows are removed; no Markdown file is deleted.

Each vault command holds the vault state lock before reading or mutating the index. Create and save update the changed note and its outgoing links after the Markdown write. Rename rewrites Markdown through the persistence transaction first, then scans the full vault. A successful Markdown write remains successful if its derived index update fails. The index is marked dirty and a later search or backlink request retries full reconciliation.

This sequencing lives in the Rust application layer rather than the Tauri command adapter. Note operations own Markdown-first mutation ordering, while Retrieval owns vault scanning, indexed-note conversion, dirty reconciliation, and recoverable rebuild-and-retry behavior. Tauri commands only acquire managed state, move blocking work off the async runtime, and delegate through those interfaces.

A new target can make existing broken-link rows resolve after reconciliation because rows store normalized target identity. An ambiguous normalized filename identity resolves to neither note. Deletion removes the Markdown source first and then removes the index row best-effort; foreign-key cascades remove links originating from the deleted note while links in other Markdown files remain untouched.

## Recovery

Calmd recreates the database when it is missing, not a database, corrupt, incompatible with the current schema, or fails SQLite or FTS integrity checks. It does not delete the database for permission errors, disk-full errors, lock contention, or generic I/O failures.

Connections close before the database and its `-journal`, `-wal`, and `-shm` sidecars are removed. The vault is never recreated or modified as part of index recovery. The next reconciliation rebuilds every derived row from Markdown.

## Backlinks and unlinked mentions

Backlinks resolve outgoing `note_links` against one unambiguous normalized filename identity and return each source note once. Unlinked mentions resolve the target by key and require one unambiguous normalized visible title. They search other note bodies for a case-insensitive literal title occurrence, exclude supported wiki-link and Markdown code ranges, enforce alphanumeric token boundaries, deduplicate by source note, and return one bounded excerpt with UTF-16 match offsets for frontend highlighting. Titles shorter than three Unicode characters bypass FTS candidate selection and scan indexed bodies directly.

Both queries remain on-demand and reconcile dirty derived state before reading. They do not create notes or modify Markdown.

## Frontend integration

The composer uses a 120 ms debounce, a monotonically increasing request ID, immediate clearing for an empty query, and reruns the current query after a focus reconciliation. Search and index failures do not make the vault unavailable. Tauri blocking commands keep rescans and SQLite work off the UI thread.

## Validation

Rust tests cover initial indexing, external content changes, stale-row pruning, deletion, missing and invalid database recreation, exact Unicode titles, quotes and FTS metacharacters, title ranking, Japanese, accent-insensitive, and Arabic-folded retrieval, bounded excerpts, title suggestions, backlink deduplication, unlinked-mention filtering, ambiguity, transactional replacement, and successful note persistence when the index is unavailable. TypeScript tests cover frontend search-match segmentation, including Arabic marks.

A manual rebuild check is:

1. Create several Markdown notes.
2. Launch Calmd and search through the composer.
3. Close Calmd and remove `search-index.sqlite3` from Tauri app data.
4. Relaunch and search again.
5. Confirm the same notes and excerpts are available.
6. Confirm every Markdown file is unchanged.

## Not included

This design intentionally stays with literal retrieval. Semantic retrieval and embeddings were considered but rejected because current FTS5 retrieval is effective, predictable, and lightweight for the intended workflow and better aligned with Calmd's minimal product philosophy. They are not planned unless usage evidence shows repeated retrieval failures caused by differences in wording. Current boundaries include filesystem watching, nested-folder traversal, multiple vaults, trash or restore, and encryption. SQLite stores plaintext derived copies of note content in app data; Markdown remains the source of truth.

Sources: [SQLite external-content FTS5 tables](https://www.sqlite.org/fts5.html#external_content_tables), [FTS5 trigram tokenizer](https://www.sqlite.org/fts5.html#the_trigram_tokenizer), [BM25](https://www.sqlite.org/fts5.html#the_bm25_function), [FTS5 snippets](https://www.sqlite.org/fts5.html#the_snippet_function), and [FTS5 integrity checks](https://www.sqlite.org/fts5.html#the_integrity_check_command).
