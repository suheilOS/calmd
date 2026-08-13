use crate::{
    links::{NoteReference, key_stem},
    note_persistence::{
        LinkKeyResolution, LinkResolution, Note, NotePersistence, NotePreviewRead,
        PersistenceError, recover_operation,
    },
    search::{IndexedNote, SearchResponse, SearchState},
    unlinked_mentions::UnlinkedMention,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;
use url::Url;

const SETTINGS_FILE: &str = "settings.json";
const VAULT_PATH_KEY: &str = "vault_path";
const SUBSTACK_PUBLICATION_URL_KEY: &str = "substack_publication_url";
const EDITOR_SPELLCHECK_KEY: &str = "editor_spellcheck_enabled";
const MAX_FILENAME_BYTES: usize = 180;
const NOTE_PREVIEW_CHARACTER_LIMIT: usize = 4_000;

#[derive(Default)]
pub struct VaultState(Mutex<Option<PathBuf>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenNoteLinkResponse {
    note: Note,
    canonical_target: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePreview {
    key: String,
    title: String,
    excerpt: String,
    truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: String,
    message: String,
}

impl CommandError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    fn io(context: &str, error: impl std::fmt::Display) -> Self {
        Self::new("io", format!("{context}: {error}"))
    }
}

impl From<PersistenceError> for CommandError {
    fn from(error: PersistenceError) -> Self {
        Self::new(error.code, error.message)
    }
}

type CommandResult<T> = Result<T, CommandError>;

pub fn restore_vault(
    app: &AppHandle,
    state: &VaultState,
) -> Result<(), Box<dyn std::error::Error>> {
    let store = app.store(SETTINGS_FILE)?;
    let Some(path) = store
        .get(VAULT_PATH_KEY)
        .and_then(|value| value.as_str().map(PathBuf::from))
    else {
        return Ok(());
    };

    if let Ok(root) = canonical_vault(&path) {
        *state.0.lock().map_err(|_| "vault state is unavailable")? = Some(root);
    }

    Ok(())
}

#[tauri::command]
pub fn get_substack_publication_url(app: AppHandle) -> CommandResult<Option<String>> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| CommandError::io("Could not open settings", error))?;
    Ok(store
        .get(SUBSTACK_PUBLICATION_URL_KEY)
        .and_then(|value| value.as_str().map(str::to_owned)))
}

#[tauri::command]
pub fn set_substack_publication_url(url: String, app: AppHandle) -> CommandResult<String> {
    let url = normalize_substack_publication_url(&url)?;
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| CommandError::io("Could not open settings", error))?;
    store.set(
        SUBSTACK_PUBLICATION_URL_KEY,
        serde_json::Value::String(url.clone()),
    );
    store
        .save()
        .map_err(|error| CommandError::io("Could not save settings", error))?;
    Ok(url)
}

fn editor_spellcheck_from_value(value: Option<&serde_json::Value>) -> bool {
    value.and_then(serde_json::Value::as_bool).unwrap_or(true)
}

#[tauri::command]
pub fn get_editor_spellcheck(app: AppHandle) -> CommandResult<bool> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| CommandError::io("Could not open settings", error))?;
    Ok(editor_spellcheck_from_value(
        store.get(EDITOR_SPELLCHECK_KEY).as_ref(),
    ))
}

#[tauri::command]
pub fn set_editor_spellcheck(enabled: bool, app: AppHandle) -> CommandResult<bool> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| CommandError::io("Could not open settings", error))?;
    store.set(EDITOR_SPELLCHECK_KEY, serde_json::Value::Bool(enabled));
    store
        .save()
        .map_err(|error| CommandError::io("Could not save settings", error))?;
    Ok(enabled)
}

#[tauri::command]
pub async fn select_vault(
    name: String,
    app: AppHandle,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<bool> {
    validate_vault_name(&name)?;
    let selection = app
        .dialog()
        .file()
        .set_title("Choose where to create the vault")
        .blocking_pick_folder();

    let Some(FilePath::Path(path)) = selection else {
        return Ok(false);
    };

    let parent = canonical_vault(&path)?;
    let root = create_vault_directory(&parent, &name)?;
    let indexed_notes = match scan_indexed_vault(&root) {
        Ok(notes) => notes,
        Err(error) => {
            let _ = fs::remove_dir(&root);
            return Err(error);
        }
    };
    if let Err(error) = persist_vault(&app, &root) {
        let _ = fs::remove_dir(&root);
        return Err(error);
    }
    let mut guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    *guard = Some(root.clone());
    search.reconcile_best_effort(&root, &indexed_notes);
    Ok(true)
}

#[tauri::command]
pub async fn open_vault(app: AppHandle) -> CommandResult<bool> {
    tauri::async_runtime::spawn_blocking(move || open_vault_in(&app))
        .await
        .map_err(|error| CommandError::new("state", format!("Could not open the vault: {error}")))?
}

fn open_vault_in(app: &AppHandle) -> CommandResult<bool> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let Some(_) = guard.as_ref() else {
        return Ok(false);
    };
    let root = vault_root(&guard)?;
    recover_operation(&root)?;
    let notes = scan_indexed_vault(&root)?;
    search.reconcile_best_effort(&root, &notes);
    Ok(true)
}

fn reconcile_search_if_needed(search: &SearchState, root: &Path) -> CommandResult<()> {
    if search.needs_reconciliation() {
        search
            .reconcile(root, &scan_indexed_vault(root)?)
            .map_err(search_command_error)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn search_notes(query: String, app: AppHandle) -> CommandResult<SearchResponse> {
    tauri::async_runtime::spawn_blocking(move || search_notes_in(&app, &query))
        .await
        .map_err(|error| CommandError::new("search", format!("Could not search notes: {error}")))?
}

fn search_notes_in(app: &AppHandle, query: &str) -> CommandResult<SearchResponse> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;

    reconcile_search_if_needed(&search, &root)?;

    match search.search(query) {
        Ok(response) => Ok(response),
        Err(error) if error.is_recoverable() => {
            let notes = scan_indexed_vault(&root)?;
            search
                .reconcile(&root, &notes)
                .map_err(search_command_error)?;
            search.search(query).map_err(search_command_error)
        }
        Err(error) => Err(search_command_error(error)),
    }
}

#[tauri::command]
pub fn create_note(
    title: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<Note> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let note = NotePersistence::new(&root).find_or_create(&title)?;
    best_effort_index(&search, &root, None, &note);
    Ok(note)
}

#[tauri::command]
pub fn create_untitled_note(
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<Note> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let note = NotePersistence::new(&root).create_untitled()?;
    best_effort_index(&search, &root, None, &note);
    Ok(note)
}

fn note_preview(note: NotePreviewRead) -> NotePreview {
    NotePreview {
        key: note.key,
        title: note.title,
        excerpt: note.body,
        truncated: note.truncated,
    }
}

#[tauri::command]
pub fn open_note_link(
    target: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<OpenNoteLinkResponse> {
    let target = validate_link_target(&target)?;
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let persistence = NotePersistence::new(&root);
    let note = match persistence.resolve_link(&target)? {
        LinkResolution::Missing => persistence.create(&target)?,
        LinkResolution::Found(note) => note,
        LinkResolution::Ambiguous => {
            return Err(CommandError::new(
                "ambiguous_link",
                "More than one note matches this link.",
            ));
        }
    };
    best_effort_index(&search, &root, None, &note);
    Ok(OpenNoteLinkResponse {
        canonical_target: key_stem(&note.key).to_owned(),
        note,
    })
}

#[tauri::command]
pub fn resolve_note_preview(
    target: String,
    state: State<'_, VaultState>,
) -> CommandResult<Option<NotePreview>> {
    let target = validate_link_target(&target)?;
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let persistence = NotePersistence::new(&root);
    match persistence.resolve_link_key(&target)? {
        LinkKeyResolution::Found(key) => Ok(Some(note_preview(
            persistence.read_preview(&key, NOTE_PREVIEW_CHARACTER_LIMIT)?,
        ))),
        LinkKeyResolution::Missing | LinkKeyResolution::Ambiguous => Ok(None),
    }
}

#[tauri::command]
pub async fn suggest_notes(query: String, app: AppHandle) -> CommandResult<Vec<NoteReference>> {
    tauri::async_runtime::spawn_blocking(move || suggest_notes_in(&app, &query))
        .await
        .map_err(|error| CommandError::new("search", format!("Could not suggest notes: {error}")))?
}

#[tauri::command]
pub async fn open_random_note(
    excluded_key: Option<String>,
    app: AppHandle,
) -> CommandResult<Option<Note>> {
    tauri::async_runtime::spawn_blocking(move || open_random_note_in(&app, excluded_key.as_deref()))
        .await
        .map_err(|error| {
            CommandError::new("search", format!("Could not open a random note: {error}"))
        })?
}

fn open_random_note_in(app: &AppHandle, excluded_key: Option<&str>) -> CommandResult<Option<Note>> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    reconcile_search_if_needed(&search, &root)?;

    random_note_from_index(&root, &search, excluded_key)
}

fn random_note_from_index(
    root: &Path,
    search: &SearchState,
    excluded_key: Option<&str>,
) -> CommandResult<Option<Note>> {
    let key = match (
        search
            .random_key(excluded_key)
            .map_err(search_command_error)?,
        excluded_key.is_some(),
    ) {
        (None, true) => search.random_key(None).map_err(search_command_error)?,
        (key, _) => key,
    };
    let Some(key) = key else {
        return Ok(None);
    };

    NotePersistence::new(root)
        .read(&key)
        .map(Some)
        .map_err(Into::into)
}

fn suggest_notes_in(app: &AppHandle, query: &str) -> CommandResult<Vec<NoteReference>> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    reconcile_search_if_needed(&search, &root)?;
    search.suggest_notes(query).map_err(search_command_error)
}

#[tauri::command]
pub async fn get_backlinks(key: String, app: AppHandle) -> CommandResult<Vec<NoteReference>> {
    tauri::async_runtime::spawn_blocking(move || get_backlinks_in(&app, &key))
        .await
        .map_err(|error| {
            CommandError::new("search", format!("Could not load backlinks: {error}"))
        })?
}

fn get_backlinks_in(app: &AppHandle, key: &str) -> CommandResult<Vec<NoteReference>> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    reconcile_search_if_needed(&search, &root)?;
    search.backlinks(key).map_err(search_command_error)
}

#[tauri::command]
pub async fn get_unlinked_mentions(
    key: String,
    app: AppHandle,
) -> CommandResult<Vec<UnlinkedMention>> {
    tauri::async_runtime::spawn_blocking(move || get_unlinked_mentions_in(&app, &key))
        .await
        .map_err(|error| {
            CommandError::new(
                "search",
                format!("Could not load unlinked mentions: {error}"),
            )
        })?
}

fn get_unlinked_mentions_in(app: &AppHandle, key: &str) -> CommandResult<Vec<UnlinkedMention>> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    reconcile_search_if_needed(&search, &root)?;
    search.unlinked_mentions(key).map_err(search_command_error)
}

fn normalize_substack_publication_url(value: &str) -> CommandResult<String> {
    let value = value.trim().trim_end_matches('/');
    let parsed = Url::parse(value).map_err(|_| {
        CommandError::new(
            "invalid_substack_url",
            "Enter a valid HTTPS publication URL.",
        )
    })?;

    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || (parsed.path() != "" && parsed.path() != "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(CommandError::new(
            "invalid_substack_url",
            "Enter the base HTTPS URL of your publication, such as https://your-publication.substack.com.",
        ));
    }

    Ok(value.to_owned())
}

fn validate_link_target(target: &str) -> CommandResult<String> {
    let target = key_stem(target.trim());
    if target.is_empty()
        || target.contains(['\r', '\n', '/', '\\', '|', '#', '^'])
        || target.contains("[[")
        || target.contains("]]")
    {
        return Err(CommandError::new(
            "invalid_link",
            "This internal link target is invalid.",
        ));
    }
    Ok(target.to_owned())
}

#[tauri::command]
pub fn read_note(key: String, state: State<'_, VaultState>) -> CommandResult<Note> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    NotePersistence::new(&root).read(&key).map_err(Into::into)
}

#[tauri::command]
pub fn read_note_preview(key: String, state: State<'_, VaultState>) -> CommandResult<NotePreview> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let note = NotePersistence::new(&root).read_preview(&key, NOTE_PREVIEW_CHARACTER_LIMIT)?;
    Ok(note_preview(note))
}

#[tauri::command]
pub fn save_note(
    key: String,
    title: String,
    body: String,
    expected_revision: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<Note> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let note = NotePersistence::new(&root).save(&key, &title, &body, &expected_revision)?;
    best_effort_index(&search, &root, None, &note);
    Ok(note)
}

#[tauri::command]
pub fn delete_note(
    key: String,
    expected_revision: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<()> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    NotePersistence::new(&root).delete(&key, &expected_revision)?;
    if let Err(error) = search.remove(&key) {
        search.mark_dirty();
        log::warn!("The Markdown note was deleted, but its derived search entry is stale: {error}");
    }
    Ok(())
}

#[tauri::command]
pub fn rename_note(
    key: String,
    title: String,
    body: String,
    expected_revision: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> CommandResult<Note> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    let note =
        NotePersistence::new(&root).rename_with_links(&key, &title, &body, &expected_revision)?;
    match scan_indexed_vault(&root) {
        Ok(notes) => search.reconcile_best_effort(&root, &notes),
        Err(error) => {
            search.mark_dirty();
            log::warn!(
                "The rename succeeded, but its derived index is stale: {}",
                error.message
            );
        }
    }
    Ok(note)
}

fn scan_indexed_vault(root: &Path) -> CommandResult<Vec<IndexedNote>> {
    NotePersistence::new(root)
        .scan()?
        .iter()
        .map(|note| indexed_note(root, note))
        .collect()
}

fn indexed_note(root: &Path, note: &Note) -> CommandResult<IndexedNote> {
    let metadata = fs::metadata(root.join(&note.key))
        .map_err(|error| CommandError::io("Could not inspect a note modification time", error))?;
    let modified_at_ms = metadata
        .modified()
        .map_err(|error| CommandError::io("Could not read a note modification time", error))?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX);
    Ok(IndexedNote {
        key: note.key.clone(),
        title: note.title.clone(),
        body: note.body.clone(),
        revision: note.revision.clone(),
        modified_at_ms,
    })
}

fn best_effort_index(search: &SearchState, root: &Path, previous_key: Option<&str>, note: &Note) {
    let result = indexed_note(root, note).and_then(|indexed| {
        search
            .replace(previous_key, &indexed)
            .map_err(search_command_error)
    });
    if let Err(error) = result {
        search.mark_dirty();
        log::warn!(
            "The Markdown note was saved, but its derived search entry is stale: {}",
            error.message
        );
    }
}

fn search_command_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new("search", format!("Search is unavailable: {error}"))
}

fn persist_vault(app: &AppHandle, root: &Path) -> CommandResult<()> {
    let value = root
        .to_str()
        .ok_or_else(|| CommandError::new("invalid_vault", "The vault path must be valid UTF-8."))?;
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| CommandError::io("Could not open settings", error))?;
    store.set(VAULT_PATH_KEY, serde_json::Value::String(value.to_owned()));
    store
        .save()
        .map_err(|error| CommandError::io("Could not save settings", error))
}

fn canonical_vault(path: &Path) -> CommandResult<PathBuf> {
    let root = path
        .canonicalize()
        .map_err(|error| CommandError::io("Could not open the selected vault", error))?;
    if !root.is_dir() {
        return Err(CommandError::new(
            "invalid_vault",
            "The selected vault is not a directory.",
        ));
    }
    Ok(root)
}

fn validate_vault_name(name: &str) -> CommandResult<()> {
    let has_invalid_character = name.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
    });
    let device_name = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();

    if name.trim().is_empty()
        || name.ends_with([' ', '.'])
        || name.len() > MAX_FILENAME_BYTES
        || has_invalid_character
        || is_windows_reserved_name(&device_name)
    {
        return Err(CommandError::new(
            "invalid_vault_name",
            "Use a portable vault name without reserved characters, trailing spaces, or periods.",
        ));
    }
    Ok(())
}

fn create_vault_directory(parent: &Path, name: &str) -> CommandResult<PathBuf> {
    validate_vault_name(name)?;
    let path = parent.join(name);
    fs::create_dir(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            CommandError::new(
                "vault_exists",
                "A file or folder with this vault name already exists in that location.",
            )
        } else {
            CommandError::io("Could not create the vault folder", error)
        }
    })?;

    let root = canonical_vault(&path)?;
    if root.parent() != Some(parent) || !root.starts_with(parent) {
        let _ = fs::remove_dir(&path);
        return Err(CommandError::new(
            "invalid_vault",
            "The new vault folder resolved outside the chosen location.",
        ));
    }
    Ok(root)
}

fn vault_root(guard: &Option<PathBuf>) -> CommandResult<PathBuf> {
    let stored_root = guard
        .as_deref()
        .ok_or_else(|| CommandError::new("no_vault", "Choose a vault folder first."))?;
    validate_vault_root(stored_root)
}

fn validate_vault_root(stored_root: &Path) -> CommandResult<PathBuf> {
    let current_root = canonical_vault(stored_root)?;
    if current_root != stored_root {
        return Err(CommandError::new(
            "invalid_vault",
            "The selected vault path changed. Choose the vault again.",
        ));
    }
    Ok(current_root)
}

fn is_windows_reserved_name(name: &str) -> bool {
    matches!(name, "CON" | "PRN" | "AUX" | "NUL")
        || name.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || name.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_a_named_vault_inside_the_selected_location() {
        let location = tempdir().unwrap();
        let vault = create_vault_directory(location.path(), "Research").unwrap();
        assert_eq!(
            vault,
            location.path().join("Research").canonicalize().unwrap()
        );
        assert!(vault.is_dir());
        assert!(create_vault_directory(location.path(), "Research").is_err());
        assert!(create_vault_directory(location.path(), "NUL").is_err());
        assert!(create_vault_directory(location.path(), "unsafe/name").is_err());
        assert!(create_vault_directory(location.path(), "trailing.").is_err());
    }

    #[test]
    fn derived_index_failure_does_not_change_a_persisted_note() {
        let vault = tempdir().unwrap();
        let persistence = NotePersistence::new(vault.path());
        let note = persistence.create("Durable source").unwrap();
        let search = SearchState::unavailable("injected index failure");

        best_effort_index(&search, vault.path(), None, &note);

        let stored = persistence.read(&note.key).unwrap();
        assert_eq!(stored.title, "Durable source");
        assert_eq!(stored.revision, note.revision);
    }

    #[test]
    fn random_note_reads_the_current_markdown_source_after_index_selection() {
        let data = tempdir().unwrap();
        let vault = tempdir().unwrap();
        let persistence = NotePersistence::new(vault.path());
        let note = persistence.create("Indexed title").unwrap();
        let search = SearchState::available(data.path().to_path_buf());
        let indexed = indexed_note(vault.path(), &note).unwrap();
        search.reconcile(vault.path(), &[indexed]).unwrap();

        fs::write(
            vault.path().join(&note.key),
            "# Current title\n\nUpdated directly on disk",
        )
        .unwrap();

        let selected = random_note_from_index(vault.path(), &search, None)
            .unwrap()
            .unwrap();
        assert_eq!(selected.key, note.key);
        assert_eq!(selected.title, "Current title");
        assert_eq!(selected.body, "Updated directly on disk");
    }

    #[test]
    fn validates_substack_publication_urls() {
        assert_eq!(
            normalize_substack_publication_url(" https://example.substack.com/ ").unwrap(),
            "https://example.substack.com"
        );
        assert!(normalize_substack_publication_url("http://example.substack.com").is_err());
        assert!(normalize_substack_publication_url("https://example.substack.com/about").is_err());
        assert!(
            normalize_substack_publication_url("https://example.substack.com?draft=1").is_err()
        );
    }

    #[test]
    fn editor_spellcheck_defaults_on_and_respects_a_stored_boolean() {
        assert!(editor_spellcheck_from_value(None));
        assert!(editor_spellcheck_from_value(Some(
            &serde_json::Value::Bool(true)
        )));
        assert!(!editor_spellcheck_from_value(Some(
            &serde_json::Value::Bool(false)
        )));
        assert!(editor_spellcheck_from_value(Some(
            &serde_json::Value::String("invalid".to_owned(),)
        )));
    }
}
