use crate::{
    links::{Backlink, key_stem, normalize_key},
    note_persistence::{Note, NotePersistence, PersistenceError, recover_operation},
    search::{IndexedNote, SearchResponse, SearchState},
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

const SETTINGS_FILE: &str = "settings.json";
const VAULT_PATH_KEY: &str = "vault_path";
const MAX_FILENAME_BYTES: usize = 180;

#[derive(Default)]
pub struct VaultState(Mutex<Option<PathBuf>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenNoteLinkResponse {
    note: Note,
    canonical_target: String,
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

    if search.needs_reconciliation() {
        let notes = scan_indexed_vault(&root)?;
        search
            .reconcile(&root, &notes)
            .map_err(search_command_error)?;
    }

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
    let normalized = normalize_key(&target);
    let matches = persistence
        .scan()?
        .into_iter()
        .filter(|note| normalize_key(&note.key) == normalized)
        .collect::<Vec<_>>();
    let note = match matches.len() {
        0 => persistence.create(&target)?,
        1 => matches.into_iter().next().unwrap(),
        _ => {
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
pub async fn get_backlinks(key: String, app: AppHandle) -> CommandResult<Vec<Backlink>> {
    tauri::async_runtime::spawn_blocking(move || get_backlinks_in(&app, &key))
        .await
        .map_err(|error| {
            CommandError::new("search", format!("Could not load backlinks: {error}"))
        })?
}

fn get_backlinks_in(app: &AppHandle, key: &str) -> CommandResult<Vec<Backlink>> {
    let state = app.state::<VaultState>();
    let search = app.state::<SearchState>();
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    if search.needs_reconciliation() {
        let notes = scan_indexed_vault(&root)?;
        search
            .reconcile(&root, &notes)
            .map_err(search_command_error)?;
    }
    search.backlinks(key).map_err(search_command_error)
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
}
