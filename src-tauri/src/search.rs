use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;
use std::{
    collections::HashSet,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

const DATABASE_FILE: &str = "search-index.sqlite3";
const SCHEMA_VERSION: i64 = 1;
const APPLICATION_ID: i64 = 0x4341_4c4d;
const MAX_QUERY_CHARACTERS: usize = 120;
const MAX_EXCERPT_CHARACTERS: usize = 240;
const EXACT_EXCERPT_SOURCE_CHARACTERS: i64 = 480;
const RESULT_LIMIT: i64 = 3;

const UPSERT_NOTE: &str = "
    INSERT INTO notes (
        key, title, normalized_title, body, revision, modified_at_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    ON CONFLICT(key) DO UPDATE SET
        title = excluded.title,
        normalized_title = excluded.normalized_title,
        body = excluded.body,
        revision = excluded.revision,
        modified_at_ms = excluded.modified_at_ms
    WHERE notes.title <> excluded.title
       OR notes.normalized_title <> excluded.normalized_title
       OR notes.body <> excluded.body
       OR notes.revision <> excluded.revision
       OR notes.modified_at_ms <> excluded.modified_at_ms
";

#[derive(Debug, Clone)]
pub struct IndexedNote {
    pub key: String,
    pub title: String,
    pub body: String,
    pub revision: String,
    pub modified_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub key: String,
    pub title: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchHit>,
    pub has_exact_match: bool,
}

impl SearchResponse {
    fn empty() -> Self {
        Self {
            results: Vec::new(),
            has_exact_match: false,
        }
    }
}

#[derive(Debug)]
pub struct SearchError {
    kind: SearchErrorKind,
    message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SearchErrorKind {
    Corrupt,
    InvalidSchema,
    Unavailable,
    Other,
}

impl SearchError {
    fn new(kind: SearchErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    fn sqlite(context: &str, error: rusqlite::Error) -> Self {
        let kind = match &error {
            rusqlite::Error::SqliteFailure(details, _)
                if matches!(
                    details.code,
                    rusqlite::ffi::ErrorCode::DatabaseCorrupt
                        | rusqlite::ffi::ErrorCode::NotADatabase
                ) =>
            {
                SearchErrorKind::Corrupt
            }
            _ => SearchErrorKind::Other,
        };
        Self::new(kind, format!("{context}: {error}"))
    }

    pub fn is_recoverable(&self) -> bool {
        matches!(
            self.kind,
            SearchErrorKind::Corrupt | SearchErrorKind::InvalidSchema
        )
    }
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SearchError {}

struct SearchInner {
    connection: Option<Connection>,
    dirty: bool,
}

pub struct SearchState {
    database_path: Option<PathBuf>,
    unavailable_message: Option<String>,
    inner: Mutex<SearchInner>,
}

impl SearchState {
    pub fn available(app_data_dir: PathBuf) -> Self {
        Self {
            database_path: Some(app_data_dir.join(DATABASE_FILE)),
            unavailable_message: None,
            inner: Mutex::new(SearchInner {
                connection: None,
                dirty: true,
            }),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            database_path: None,
            unavailable_message: Some(message.into()),
            inner: Mutex::new(SearchInner {
                connection: None,
                dirty: true,
            }),
        }
    }

    pub fn needs_reconciliation(&self) -> bool {
        self.inner.lock().map(|inner| inner.dirty).unwrap_or(true)
    }

    pub fn mark_dirty(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.dirty = true;
        }
    }

    pub fn reconcile_best_effort(&self, vault: &Path, notes: &[IndexedNote]) {
        if let Err(error) = self.reconcile(vault, notes) {
            self.mark_dirty();
            log::warn!("Could not reconcile the derived search index: {error}");
        }
    }

    pub fn reconcile(&self, vault: &Path, notes: &[IndexedNote]) -> Result<(), SearchError> {
        let path = self.database_path()?;
        let mut inner = self.lock_inner()?;
        ensure_connection(path, &mut inner)?;

        let result = reconcile_connection(
            inner
                .connection
                .as_mut()
                .expect("connection was initialized"),
            vault,
            notes,
        );
        match result {
            Ok(()) => {
                inner.dirty = false;
                Ok(())
            }
            Err(error) if error.is_recoverable() => {
                rebuild_connection(path, &mut inner)?;
                reconcile_connection(
                    inner.connection.as_mut().expect("connection was rebuilt"),
                    vault,
                    notes,
                )?;
                inner.dirty = false;
                Ok(())
            }
            Err(error) => {
                inner.dirty = true;
                Err(error)
            }
        }
    }

    pub fn replace(
        &self,
        previous_key: Option<&str>,
        note: &IndexedNote,
    ) -> Result<(), SearchError> {
        let path = self.database_path()?;
        let mut inner = self.lock_inner()?;
        ensure_connection(path, &mut inner)?;
        let connection = inner
            .connection
            .as_mut()
            .expect("connection was initialized");
        let result = replace_note(connection, previous_key, note);
        if let Err(error) = &result {
            inner.dirty = true;
            if error.is_recoverable() {
                inner.connection.take();
            }
        }
        result
    }

    pub fn search(&self, query: &str) -> Result<SearchResponse, SearchError> {
        let canonical_query = canonicalize_query(query)?;
        if canonical_query.is_empty() {
            return Ok(SearchResponse::empty());
        }

        let path = self.database_path()?;
        let mut inner = self.lock_inner()?;
        ensure_connection(path, &mut inner)?;
        let result = search_connection(
            inner
                .connection
                .as_ref()
                .expect("connection was initialized"),
            &canonical_query,
        );
        if let Err(error) = &result {
            inner.dirty = true;
            if error.is_recoverable() {
                inner.connection.take();
            }
        }
        result
    }

    fn database_path(&self) -> Result<&Path, SearchError> {
        self.database_path.as_deref().ok_or_else(|| {
            SearchError::new(
                SearchErrorKind::Unavailable,
                self.unavailable_message
                    .as_deref()
                    .unwrap_or("Search storage is unavailable."),
            )
        })
    }

    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, SearchInner>, SearchError> {
        self.inner.lock().map_err(|_| {
            SearchError::new(
                SearchErrorKind::Unavailable,
                "The search index is unavailable.",
            )
        })
    }
}

fn ensure_connection(path: &Path, inner: &mut SearchInner) -> Result<(), SearchError> {
    if inner.connection.is_some() {
        return Ok(());
    }
    let (connection, rebuilt) = open_or_rebuild(path)?;
    inner.connection = Some(connection);
    inner.dirty |= rebuilt;
    Ok(())
}

fn open_or_rebuild(path: &Path) -> Result<(Connection, bool), SearchError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            SearchError::new(
                SearchErrorKind::Unavailable,
                format!("Could not create search storage: {error}"),
            )
        })?;
    }

    let existed = path.exists();
    let connection = open_connection(path)?;
    if !existed {
        initialize_schema(&connection)?;
        return Ok((connection, true));
    }

    match validate_schema(&connection) {
        Ok(()) => Ok((connection, false)),
        Err(error) if error.is_recoverable() => {
            drop(connection);
            remove_database_files(path)?;
            let replacement = open_connection(path)?;
            initialize_schema(&replacement)?;
            Ok((replacement, true))
        }
        Err(error) => Err(error),
    }
}

fn open_connection(path: &Path) -> Result<Connection, SearchError> {
    let connection = Connection::open(path)
        .map_err(|error| SearchError::sqlite("Could not open the search index", error))?;
    connection
        .busy_timeout(Duration::from_secs(2))
        .map_err(|error| SearchError::sqlite("Could not configure the search index", error))?;
    Ok(connection)
}

fn initialize_schema(connection: &Connection) -> Result<(), SearchError> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = DELETE;
            PRAGMA synchronous = NORMAL;
            PRAGMA application_id = 0x43414c4d;

            CREATE TABLE metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) WITHOUT ROWID;

            CREATE TABLE notes (
                id INTEGER PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                normalized_title TEXT NOT NULL,
                body TEXT NOT NULL,
                revision TEXT NOT NULL,
                modified_at_ms INTEGER NOT NULL
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

            CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
                INSERT INTO note_fts(rowid, title, body)
                VALUES (new.id, new.title, new.body);
            END;

            CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
                INSERT INTO note_fts(note_fts, rowid, title, body)
                VALUES ('delete', old.id, old.title, old.body);
            END;

            CREATE TRIGGER notes_au AFTER UPDATE OF title, body ON notes BEGIN
                INSERT INTO note_fts(note_fts, rowid, title, body)
                VALUES ('delete', old.id, old.title, old.body);
                INSERT INTO note_fts(rowid, title, body)
                VALUES (new.id, new.title, new.body);
            END;

            PRAGMA user_version = 1;
            ",
        )
        .map_err(|error| SearchError::sqlite("Could not initialize the search index", error))
}

fn validate_schema(connection: &Connection) -> Result<(), SearchError> {
    let application_id: i64 = connection
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .map_err(|error| SearchError::sqlite("Could not inspect the search index", error))?;
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| SearchError::sqlite("Could not inspect the search index", error))?;
    if application_id != APPLICATION_ID || version != SCHEMA_VERSION {
        return Err(SearchError::new(
            SearchErrorKind::InvalidSchema,
            "The search index schema is incompatible.",
        ));
    }

    for object in [
        "metadata",
        "notes",
        "notes_normalized_title",
        "note_fts",
        "notes_ai",
        "notes_ad",
        "notes_au",
    ] {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = ?1)",
                [object],
                |row| row.get(0),
            )
            .map_err(|error| SearchError::sqlite("Could not inspect the search index", error))?;
        if !exists {
            return Err(SearchError::new(
                SearchErrorKind::InvalidSchema,
                "The search index schema is incomplete.",
            ));
        }
    }

    let quick_check: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(|error| SearchError::sqlite("Could not verify the search index", error))?;
    if quick_check != "ok" {
        return Err(SearchError::new(
            SearchErrorKind::Corrupt,
            format!("The search index is corrupt: {quick_check}"),
        ));
    }

    connection
        .execute(
            "INSERT INTO note_fts(note_fts, rank) VALUES('integrity-check', 1)",
            [],
        )
        .map_err(|error| SearchError::sqlite("Could not verify the full-text index", error))?;
    Ok(())
}

fn rebuild_connection(path: &Path, inner: &mut SearchInner) -> Result<(), SearchError> {
    inner.connection.take();
    remove_database_files(path)?;
    let connection = open_connection(path)?;
    initialize_schema(&connection)?;
    inner.connection = Some(connection);
    inner.dirty = true;
    Ok(())
}

fn remove_database_files(path: &Path) -> Result<(), SearchError> {
    for suffix in ["", "-journal", "-wal", "-shm"] {
        let candidate = if suffix.is_empty() {
            path.to_path_buf()
        } else {
            let mut value: OsString = path.as_os_str().to_owned();
            value.push(suffix);
            PathBuf::from(value)
        };
        match fs::remove_file(&candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(SearchError::new(
                    SearchErrorKind::Other,
                    format!("Could not replace the search index: {error}"),
                ));
            }
        }
    }
    Ok(())
}

fn reconcile_connection(
    connection: &mut Connection,
    vault: &Path,
    notes: &[IndexedNote],
) -> Result<(), SearchError> {
    let vault = vault.to_str().ok_or_else(|| {
        SearchError::new(
            SearchErrorKind::Other,
            "The vault path cannot be represented in the search index.",
        )
    })?;
    let transaction = connection
        .transaction()
        .map_err(|error| SearchError::sqlite("Could not reconcile the search index", error))?;
    reconcile_transaction(&transaction, vault, notes)?;
    transaction
        .commit()
        .map_err(|error| SearchError::sqlite("Could not finish search reconciliation", error))
}

fn reconcile_transaction(
    transaction: &Transaction<'_>,
    vault: &str,
    notes: &[IndexedNote],
) -> Result<(), SearchError> {
    let indexed_vault: Option<String> = transaction
        .query_row(
            "SELECT value FROM metadata WHERE key = 'vault_path'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| SearchError::sqlite("Could not inspect indexed vault metadata", error))?;
    if indexed_vault
        .as_deref()
        .is_some_and(|stored| stored != vault)
    {
        transaction
            .execute("DELETE FROM notes", [])
            .map_err(|error| SearchError::sqlite("Could not reset the search index", error))?;
    }

    transaction
        .execute_batch(
            "
            CREATE TEMP TABLE IF NOT EXISTS scanned_keys (
                key TEXT PRIMARY KEY
            ) WITHOUT ROWID;
            DELETE FROM scanned_keys;
            ",
        )
        .map_err(|error| SearchError::sqlite("Could not prepare search reconciliation", error))?;

    for note in notes {
        upsert_note(transaction, note)?;
        transaction
            .execute("INSERT INTO scanned_keys(key) VALUES (?1)", [&note.key])
            .map_err(|error| SearchError::sqlite("Could not track an indexed note", error))?;
    }

    transaction
        .execute(
            "DELETE FROM notes WHERE key NOT IN (SELECT key FROM scanned_keys)",
            [],
        )
        .map_err(|error| SearchError::sqlite("Could not remove stale search entries", error))?;
    transaction
        .execute(
            "INSERT INTO metadata(key, value) VALUES('vault_path', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [vault],
        )
        .map_err(|error| SearchError::sqlite("Could not store indexed vault metadata", error))?;
    Ok(())
}

fn replace_note(
    connection: &mut Connection,
    previous_key: Option<&str>,
    note: &IndexedNote,
) -> Result<(), SearchError> {
    let transaction = connection
        .transaction()
        .map_err(|error| SearchError::sqlite("Could not update the search index", error))?;
    if let Some(previous_key) = previous_key.filter(|key| *key != note.key) {
        transaction
            .execute("DELETE FROM notes WHERE key = ?1", [previous_key])
            .map_err(|error| SearchError::sqlite("Could not replace a search entry", error))?;
    }
    upsert_note(&transaction, note)?;
    transaction
        .commit()
        .map_err(|error| SearchError::sqlite("Could not finish the search update", error))
}

fn upsert_note(connection: &Connection, note: &IndexedNote) -> Result<(), SearchError> {
    connection
        .execute(
            UPSERT_NOTE,
            params![
                note.key,
                note.title,
                normalize_title(&note.title),
                note.body,
                note.revision,
                note.modified_at_ms,
            ],
        )
        .map_err(|error| SearchError::sqlite("Could not index a note", error))?;
    Ok(())
}

fn search_connection(
    connection: &Connection,
    canonical_query: &str,
) -> Result<SearchResponse, SearchError> {
    let normalized_title = normalize_title(canonical_query);
    let exact = connection
        .query_row(
            "SELECT key, title, substr(body, 1, ?2)
             FROM notes
             WHERE normalized_title = ?1
             ORDER BY key COLLATE NOCASE, key
             LIMIT 1",
            params![normalized_title, EXACT_EXCERPT_SOURCE_CHARACTERS],
            |row| {
                let body: String = row.get(2)?;
                Ok(SearchHit {
                    key: row.get(0)?,
                    title: row.get(1)?,
                    excerpt: clean_excerpt(&body),
                })
            },
        )
        .optional()
        .map_err(|error| SearchError::sqlite("Could not search exact note titles", error))?;
    if let Some(exact) = exact {
        return Ok(SearchResponse {
            results: vec![exact],
            has_exact_match: true,
        });
    }

    let Some(expression) = fts_expression(canonical_query) else {
        return Ok(SearchResponse::empty());
    };
    let mut statement = connection
        .prepare(
            "SELECT notes.key,
                    notes.title,
                    snippet(note_fts, 1, '', '', ' … ', 96)
             FROM note_fts
             JOIN notes ON notes.id = note_fts.rowid
             WHERE note_fts MATCH ?1
             ORDER BY bm25(note_fts, 8.0, 1.0), notes.normalized_title, notes.key
             LIMIT ?2",
        )
        .map_err(|error| SearchError::sqlite("Could not prepare note search", error))?;
    let rows = statement
        .query_map(params![expression, RESULT_LIMIT], |row| {
            let excerpt: String = row.get(2)?;
            Ok(SearchHit {
                key: row.get(0)?,
                title: row.get(1)?,
                excerpt: clean_excerpt(&excerpt),
            })
        })
        .map_err(|error| SearchError::sqlite("Could not search notes", error))?;
    let mut results = Vec::new();
    for row in rows {
        results.push(
            row.map_err(|error| SearchError::sqlite("Could not read a search result", error))?,
        );
    }
    Ok(SearchResponse {
        results,
        has_exact_match: false,
    })
}

fn canonicalize_query(query: &str) -> Result<String, SearchError> {
    if query.chars().count() > MAX_QUERY_CHARACTERS {
        return Err(SearchError::new(
            SearchErrorKind::Other,
            "Search text is too long.",
        ));
    }
    Ok(query.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn normalize_title(title: &str) -> String {
    title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn fts_expression(query: &str) -> Option<String> {
    let mut seen = HashSet::new();
    let mut phrases = Vec::new();
    for phrase in std::iter::once(query).chain(query.split_whitespace()) {
        if phrase.chars().count() < 3 || !seen.insert(phrase) {
            continue;
        }
        phrases.push(format!("\"{}\"", phrase.replace('"', "\"\"")));
    }
    (!phrases.is_empty()).then(|| phrases.join(" OR "))
}

fn clean_excerpt(excerpt: &str) -> String {
    let cleaned = excerpt
        .replace("[[", "")
        .replace("]]", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut characters = cleaned.chars();
    let bounded = characters
        .by_ref()
        .take(MAX_EXCERPT_CHARACTERS.saturating_sub(1))
        .collect::<String>();
    if characters.next().is_some() {
        format!("{}…", bounded.trim_end())
    } else {
        bounded
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn note(key: &str, title: &str, body: &str, revision: &str) -> IndexedNote {
        IndexedNote {
            key: key.to_owned(),
            title: title.to_owned(),
            body: body.to_owned(),
            revision: revision.to_owned(),
            modified_at_ms: 1,
        }
    }

    fn state(root: &Path) -> SearchState {
        SearchState::available(root.to_path_buf())
    }

    #[test]
    fn reconciles_searches_updates_and_removes_notes() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let search = state(data.path());
        let original = note(
            "Water.md",
            "Pure Water",
            "A quiet purification process",
            "one",
        );
        let body_match = note(
            "Other.md",
            "Field notes",
            "Pure water appears in this body",
            "two",
        );
        search
            .reconcile(vault.path(), &[original.clone(), body_match])
            .unwrap();

        let response = search.search("pure wat").unwrap();
        assert_eq!(response.results[0].key, "Water.md");
        assert!(!response.has_exact_match);
        let body_search = search.search("purification").unwrap();
        assert!(body_search.results[0].excerpt.starts_with("A quiet"));
        assert!(body_search.results[0].excerpt.contains("purification"));
        let modified_at_ms: i64 = search
            .inner
            .lock()
            .unwrap()
            .connection
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT modified_at_ms FROM notes WHERE key = 'Water.md'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(modified_at_ms, 1);

        let updated = note("Water.md", "Pure Water", "Entirely revised", "three");
        search.reconcile(vault.path(), &[updated]).unwrap();
        assert!(search.search("purification").unwrap().results.is_empty());
        assert!(search.search("field notes").unwrap().results.is_empty());
    }

    #[test]
    fn body_excerpt_is_match_specific_concise_and_cleans_wiki_brackets() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let search = state(data.path());
        let opening = "unrelated opening material ".repeat(80);
        let body =
            format!("{opening}transition text [[distinctive phrase]] with useful nearby context");
        search
            .reconcile(vault.path(), &[note("Long.md", "Long note", &body, "one")])
            .unwrap();

        let response = search.search("distinctive phrase").unwrap();
        let excerpt = &response.results[0].excerpt;

        assert!(excerpt.contains("distinctive phrase"));
        assert!(excerpt.contains("useful nearby context"));
        assert!(!excerpt.starts_with("unrelated opening material"));
        assert!(excerpt.chars().count() <= MAX_EXCERPT_CHARACTERS);
        assert!(!excerpt.contains("[["));
        assert!(!excerpt.contains("]]"));
    }

    #[test]
    fn title_matches_rank_above_equivalent_body_only_matches() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let search = state(data.path());
        search
            .reconcile(
                vault.path(),
                &[
                    note("Body.md", "Field notes", "quiet signal", "one"),
                    note("Title.md", "Quiet signal", "unrelated body", "two"),
                ],
            )
            .unwrap();

        let response = search.search("quiet sig").unwrap();
        assert_eq!(response.results[0].key, "Title.md");
    }

    #[test]
    fn exact_titles_bypass_fts_minimum_and_return_one_bounded_result() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let search = state(data.path());
        search
            .reconcile(
                vault.path(),
                &[
                    note("Go.md", "Go", &"opening text ".repeat(100), "one"),
                    note("Other.md", "Other", "Go appears in the body", "two"),
                ],
            )
            .unwrap();

        let response = search.search("  GO ").unwrap();
        assert!(response.has_exact_match);
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].key, "Go.md");
        assert!(response.results[0].excerpt.chars().count() <= MAX_EXCERPT_CHARACTERS);
    }

    #[test]
    fn trigram_search_handles_unicode_diacritics_and_metacharacters() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let search = state(data.path());
        search
            .reconcile(
                vault.path(),
                &[
                    note("Japanese.md", "静かな考え", "検索できる本文", "one"),
                    note("Cafe.md", "Café notes", "C++ and quoted \"text\"", "two"),
                ],
            )
            .unwrap();

        assert_eq!(
            search.search("かな考").unwrap().results[0].key,
            "Japanese.md"
        );
        assert_eq!(search.search("cafe").unwrap().results[0].key, "Cafe.md");
        assert_eq!(search.search("C++").unwrap().results[0].key, "Cafe.md");
        assert_eq!(
            search.search("quoted \"text\"").unwrap().results[0].key,
            "Cafe.md"
        );
        assert!(search.search("\"").is_ok());
    }

    #[test]
    fn recreate_missing_or_invalid_database_without_touching_vault() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let markdown = vault.path().join("Knowledge.md");
        fs::write(&markdown, "# Knowledge\n\nIntact").unwrap();
        let indexed = note("Knowledge.md", "Knowledge", "Intact", "one");

        {
            let search = state(data.path());
            search
                .reconcile(vault.path(), std::slice::from_ref(&indexed))
                .unwrap();
        }
        fs::remove_file(data.path().join(DATABASE_FILE)).unwrap();
        {
            let search = state(data.path());
            search
                .reconcile(vault.path(), std::slice::from_ref(&indexed))
                .unwrap();
            assert_eq!(search.search("Knowledge").unwrap().results.len(), 1);
        }
        fs::write(data.path().join(DATABASE_FILE), b"not a database").unwrap();
        {
            let search = state(data.path());
            search.reconcile(vault.path(), &[indexed]).unwrap();
            assert_eq!(search.search("Intact").unwrap().results.len(), 1);
        }
        assert_eq!(
            fs::read_to_string(markdown).unwrap(),
            "# Knowledge\n\nIntact"
        );
        assert!(!vault.path().join(DATABASE_FILE).exists());
    }

    #[test]
    fn replace_removes_a_renamed_key_transactionally() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let search = state(data.path());
        let original = note("Old.md", "Old", "Original body", "one");
        search.reconcile(vault.path(), &[original]).unwrap();

        let renamed = note("New.md", "New", "Replacement body", "two");
        search.replace(Some("Old.md"), &renamed).unwrap();

        assert!(search.search("Original").unwrap().results.is_empty());
        assert_eq!(
            search.search("Replacement").unwrap().results[0].key,
            "New.md"
        );
    }
}
