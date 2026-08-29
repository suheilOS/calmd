use crate::{
    links::{NoteReference, extract_links, normalize_key},
    text_normalization::{find_folded_literal, fold_literal_search, strip_literal_search_marks},
    unlinked_mentions::{UnlinkedMention, excerpt, first_occurrence},
};
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
const SCHEMA_VERSION: i64 = 4;
const APPLICATION_ID: i64 = 0x4341_4c4d;
const MAX_QUERY_CHARACTERS: usize = 120;
const MAX_EXCERPT_CHARACTERS: usize = 240;
const EXACT_EXCERPT_SOURCE_CHARACTERS: i64 = 480;
const RESULT_LIMIT: i64 = 3;
const SUGGESTION_LIMIT: i64 = 8;

const UPSERT_NOTE: &str = "
    INSERT INTO notes (
        key, normalized_key, search_key, title, normalized_title, body,
        search_title, search_body, revision, modified_at_ms
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(key) DO UPDATE SET
        normalized_key = excluded.normalized_key,
        search_key = excluded.search_key,
        title = excluded.title,
        normalized_title = excluded.normalized_title,
        body = excluded.body,
        search_title = excluded.search_title,
        search_body = excluded.search_body,
        revision = excluded.revision,
        modified_at_ms = excluded.modified_at_ms
    WHERE notes.normalized_key <> excluded.normalized_key
       OR notes.title <> excluded.title
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
        self.mutate(|connection| replace_note(connection, previous_key, note))
    }

    pub fn remove(&self, key: &str) -> Result<(), SearchError> {
        self.mutate(|connection| remove_note(connection, key))
    }

    pub fn random_key(&self, excluded_key: Option<&str>) -> Result<Option<String>, SearchError> {
        self.query(|connection| random_key_connection(connection, excluded_key))
    }

    pub fn backlinks(&self, key: &str) -> Result<Vec<NoteReference>, SearchError> {
        self.query(|connection| backlinks_connection(connection, key))
    }

    pub fn unlinked_mentions(&self, key: &str) -> Result<Vec<UnlinkedMention>, SearchError> {
        self.query(|connection| unlinked_mentions_connection(connection, key))
    }

    pub fn search(&self, query: &str) -> Result<SearchResponse, SearchError> {
        let canonical_query = canonicalize_query(query)?;
        if canonical_query.is_empty() {
            return Ok(SearchResponse::empty());
        }
        self.query(|connection| search_connection(connection, &canonical_query))
    }

    pub fn suggest_notes(&self, query: &str) -> Result<Vec<NoteReference>, SearchError> {
        let canonical_query = fold_literal_search(&canonicalize_query(query)?);
        self.query(|connection| suggest_notes_connection(connection, &canonical_query))
    }

    fn mutate<T>(
        &self,
        run: impl FnOnce(&mut Connection) -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let path = self.database_path()?;
        let mut inner = self.lock_inner()?;
        ensure_connection(path, &mut inner)?;
        let result = run(inner
            .connection
            .as_mut()
            .expect("connection was initialized"));
        if let Err(error) = &result {
            inner.dirty = true;
            if error.is_recoverable() {
                inner.connection.take();
            }
        }
        result
    }

    fn query<T>(
        &self,
        run: impl FnOnce(&Connection) -> Result<T, SearchError>,
    ) -> Result<T, SearchError> {
        let path = self.database_path()?;
        let mut inner = self.lock_inner()?;
        ensure_connection(path, &mut inner)?;
        let result = run(inner
            .connection
            .as_ref()
            .expect("connection was initialized"));
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
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| SearchError::sqlite("Could not enable index foreign keys", error))?;
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
                normalized_key TEXT NOT NULL,
                search_key TEXT NOT NULL,
                title TEXT NOT NULL,
                normalized_title TEXT NOT NULL,
                body TEXT NOT NULL,
                search_title TEXT NOT NULL,
                search_body TEXT NOT NULL,
                revision TEXT NOT NULL,
                modified_at_ms INTEGER NOT NULL
            );

            CREATE INDEX notes_normalized_title
            ON notes(normalized_title);

            CREATE INDEX notes_normalized_key
            ON notes(normalized_key);

            CREATE TABLE note_links (
                source_key TEXT NOT NULL,
                position INTEGER NOT NULL,
                target_normalized_key TEXT NOT NULL,
                PRIMARY KEY (source_key, position),
                FOREIGN KEY (source_key) REFERENCES notes(key) ON DELETE CASCADE
            );

            CREATE INDEX note_links_target
            ON note_links(target_normalized_key);

            CREATE VIRTUAL TABLE note_fts USING fts5(
                search_title,
                search_body,
                content='notes',
                content_rowid='id',
                tokenize='trigram case_sensitive 0 remove_diacritics 1'
            );

            CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
                INSERT INTO note_fts(rowid, search_title, search_body)
                VALUES (new.id, new.search_title, new.search_body);
            END;

            CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
                INSERT INTO note_fts(note_fts, rowid, search_title, search_body)
                VALUES ('delete', old.id, old.search_title, old.search_body);
            END;

            CREATE TRIGGER notes_au AFTER UPDATE OF search_title, search_body ON notes BEGIN
                INSERT INTO note_fts(note_fts, rowid, search_title, search_body)
                VALUES ('delete', old.id, old.search_title, old.search_body);
                INSERT INTO note_fts(rowid, search_title, search_body)
                VALUES (new.id, new.search_title, new.search_body);
            END;

            PRAGMA user_version = 4;
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
        "notes_normalized_key",
        "note_links",
        "note_links_target",
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

    let foreign_keys: i64 = connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .map_err(|error| SearchError::sqlite("Could not inspect index foreign keys", error))?;
    if foreign_keys != 1 {
        return Err(SearchError::new(
            SearchErrorKind::InvalidSchema,
            "Foreign keys are disabled.",
        ));
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

fn remove_note(connection: &mut Connection, key: &str) -> Result<(), SearchError> {
    let transaction = connection
        .transaction()
        .map_err(|error| SearchError::sqlite("Could not update the search index", error))?;
    transaction
        .execute("DELETE FROM notes WHERE key = ?1", [key])
        .map_err(|error| SearchError::sqlite("Could not remove a search entry", error))?;
    transaction
        .commit()
        .map_err(|error| SearchError::sqlite("Could not finish the search update", error))
}

fn random_key_connection(
    connection: &Connection,
    excluded_key: Option<&str>,
) -> Result<Option<String>, SearchError> {
    connection
        .query_row(
            "WITH eligible AS (
                 SELECT key
                 FROM notes
                 WHERE ?1 IS NULL OR key <> ?1
                 ORDER BY id
             )
             SELECT key
             FROM eligible
             LIMIT 1
             OFFSET (
                 COALESCE(
                     (random() & 9223372036854775807)
                     % (SELECT count(*) FROM eligible),
                     0
                 )
             )",
            [excluded_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| SearchError::sqlite("Could not select a random note", error))
}

fn upsert_note(connection: &Connection, note: &IndexedNote) -> Result<(), SearchError> {
    connection
        .execute(
            UPSERT_NOTE,
            params![
                note.key,
                normalize_key(&note.key),
                fold_literal_search(&normalize_key(&note.key)),
                note.title,
                normalize_title(&note.title),
                note.body,
                strip_literal_search_marks(&note.title),
                strip_literal_search_marks(&note.body),
                note.revision,
                note.modified_at_ms,
            ],
        )
        .map_err(|error| SearchError::sqlite("Could not index a note", error))?;
    connection
        .execute("DELETE FROM note_links WHERE source_key = ?1", [&note.key])
        .map_err(|error| SearchError::sqlite("Could not replace outgoing links", error))?;
    for link in extract_links(&note.body) {
        connection.execute(
            "INSERT INTO note_links(source_key, position, target_normalized_key) VALUES (?1, ?2, ?3)",
            params![note.key, link.from as i64, normalize_key(&link.target)],
        ).map_err(|error| SearchError::sqlite("Could not index an outgoing link", error))?;
    }
    Ok(())
}

fn backlinks_connection(
    connection: &Connection,
    key: &str,
) -> Result<Vec<NoteReference>, SearchError> {
    let normalized = normalize_key(key);
    let target_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM notes WHERE normalized_key = ?1",
            [&normalized],
            |row| row.get(0),
        )
        .map_err(|error| SearchError::sqlite("Could not resolve backlink target", error))?;
    if target_count != 1 {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare(
            "SELECT DISTINCT notes.key, notes.title FROM note_links
         JOIN notes ON notes.key = note_links.source_key
         WHERE note_links.target_normalized_key = ?1
         ORDER BY notes.normalized_title, notes.key",
        )
        .map_err(|error| SearchError::sqlite("Could not prepare backlinks", error))?;
    let rows = statement
        .query_map([normalized], |row| {
            Ok(NoteReference {
                key: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(|error| SearchError::sqlite("Could not query backlinks", error))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| SearchError::sqlite("Could not read backlinks", error))
}

fn unlinked_mentions_connection(
    connection: &Connection,
    key: &str,
) -> Result<Vec<UnlinkedMention>, SearchError> {
    let normalized_key = normalize_key(key);
    let target: Option<(String, String)> = connection
        .query_row(
            "SELECT key, title FROM notes
             WHERE normalized_key = ?1
               AND (SELECT count(*) FROM notes WHERE normalized_key = ?1) = 1",
            [&normalized_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| SearchError::sqlite("Could not resolve unlinked mention target", error))?;
    let Some((target_key, title)) = target else {
        return Ok(Vec::new());
    };
    let normalized_title = normalize_title(&title);
    let search_title = fold_literal_search(&title);
    let title_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM notes WHERE normalized_title = ?1",
            [&normalized_title],
            |row| row.get(0),
        )
        .map_err(|error| SearchError::sqlite("Could not resolve unlinked mention title", error))?;
    if title_count != 1 || search_title.is_empty() {
        return Ok(Vec::new());
    }

    let query = if search_title.chars().count() >= 3 {
        "SELECT notes.key, notes.title, notes.body
         FROM note_fts JOIN notes ON notes.id = note_fts.rowid
         WHERE note_fts MATCH ?1 AND notes.key <> ?2
         ORDER BY notes.normalized_title, notes.key"
    } else {
        "SELECT key, title, body FROM notes
         WHERE key <> ?2 ORDER BY normalized_title, key"
    };
    let expression = format!("search_body : \"{}\"", search_title.replace('"', "\"\""));
    let mut statement = connection
        .prepare(query)
        .map_err(|error| SearchError::sqlite("Could not prepare unlinked mentions", error))?;
    let rows = statement
        .query_map(params![expression, target_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| SearchError::sqlite("Could not query unlinked mentions", error))?;
    let mut mentions = Vec::new();
    for row in rows {
        let (key, source_title, body) =
            row.map_err(|error| SearchError::sqlite("Could not read an unlinked mention", error))?;
        if let Some(range) = first_occurrence(&body, &title) {
            let excerpt = excerpt(&body, range);
            mentions.push(UnlinkedMention {
                key,
                title: source_title,
                excerpt: excerpt.text,
                match_start: excerpt.match_start,
                match_end: excerpt.match_end,
            });
        }
    }
    Ok(mentions)
}

fn suggest_notes_connection(
    connection: &Connection,
    query: &str,
) -> Result<Vec<NoteReference>, SearchError> {
    let mut statement = connection
        .prepare(
            "SELECT key, title
             FROM notes
             WHERE ?1 = ''
                OR instr(normalized_title, ?1) > 0
                OR instr(search_key, ?1) > 0
             ORDER BY CASE
                        WHEN normalized_title = ?1 THEN 0
                        WHEN instr(normalized_title, ?1) = 1 THEN 1
                        WHEN instr(search_key, ?1) = 1 THEN 2
                        ELSE 3
                      END,
                      normalized_title,
                      key
             LIMIT ?2",
        )
        .map_err(|error| SearchError::sqlite("Could not prepare note suggestions", error))?;
    let rows = statement
        .query_map(params![query, SUGGESTION_LIMIT], |row| {
            Ok(NoteReference {
                key: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(|error| SearchError::sqlite("Could not suggest notes", error))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| SearchError::sqlite("Could not read note suggestions", error))
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
               AND (SELECT count(*) FROM notes WHERE normalized_title = ?1) = 1
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

    let search_query = strip_literal_search_marks(canonical_query);
    let Some(expression) = fts_expression(&search_query) else {
        return Ok(SearchResponse::empty());
    };
    let mut statement = connection
        .prepare(
            "SELECT notes.key,
                    notes.title,
                    notes.body,
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
            let body: String = row.get(2)?;
            let fallback_excerpt: String = row.get(3)?;
            Ok(SearchHit {
                key: row.get(0)?,
                title: row.get(1)?,
                excerpt: matching_excerpt(&body, canonical_query, &fallback_excerpt),
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
    fold_literal_search(&title.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn matching_excerpt(body: &str, query: &str, fallback: &str) -> String {
    let mut phrases = std::iter::once(query)
        .chain(query.split_whitespace())
        .filter(|phrase| phrase.chars().count() >= 3)
        .collect::<Vec<_>>();
    phrases.sort_by_key(|phrase| std::cmp::Reverse(phrase.chars().count()));
    for phrase in phrases {
        if let Some(occurrence) = find_folded_literal(body, phrase, |_| true) {
            return excerpt(body, occurrence).text;
        }
    }
    clean_excerpt(fallback)
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
#[path = "search_tests.rs"]
mod tests;
