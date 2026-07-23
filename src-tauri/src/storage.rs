use crate::search::{IndexedNote, SearchResponse, SearchState};
use atomic_write_file::AtomicWriteFile;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;

const SETTINGS_FILE: &str = "settings.json";
const VAULT_PATH_KEY: &str = "vault_path";
const MAX_FILENAME_BYTES: usize = 180;
const TEMP_FILE_PREFIX: &str = ".calmd-";
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct VaultState(Mutex<Option<PathBuf>>);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    key: String,
    title: String,
    body: String,
    revision: String,
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

    fn conflict() -> Self {
        Self::new(
            "conflict",
            "This note changed outside Calmd. Your edits were not overwritten.",
        )
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
    let note = find_or_create_note_in(&root, &title)?;
    best_effort_index(&search, &root, None, &note);
    Ok(note)
}

#[tauri::command]
pub fn read_note(key: String, state: State<'_, VaultState>) -> CommandResult<Note> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    read_note_in(&root, &key)
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
    let note = save_note_in(&root, &key, &title, &body, &expected_revision)?;
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
    let note = rename_note_in(&root, &key, &title, &body, &expected_revision)?;
    best_effort_index(&search, &root, Some(&key), &note);
    Ok(note)
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

fn scan_vault(root: &Path) -> CommandResult<Vec<Note>> {
    let mut notes = Vec::new();
    let entries =
        fs::read_dir(root).map_err(|error| CommandError::io("Could not scan the vault", error))?;

    for entry in entries {
        let entry = entry.map_err(|error| CommandError::io("Could not scan the vault", error))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| CommandError::io("Could not inspect a vault entry", error))?;
        if !file_type.is_file() || !has_markdown_extension(&path) {
            continue;
        }
        let Some(key) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        notes.push(read_note_in(root, &key)?);
    }

    notes.sort_by(|left, right| {
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.key.to_lowercase().cmp(&right.key.to_lowercase()))
    });
    Ok(notes)
}

fn scan_indexed_vault(root: &Path) -> CommandResult<Vec<IndexedNote>> {
    scan_vault(root)?
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

fn find_or_create_note_in(root: &Path, title: &str) -> CommandResult<Note> {
    let normalized_title = canonicalize_title(title)?.to_lowercase();
    if let Some(note) = scan_vault(root)?.into_iter().find(|note| {
        note.title
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
            == normalized_title
    }) {
        return Ok(note);
    }
    create_note_in(root, title)
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

fn create_note_in(root: &Path, title: &str) -> CommandResult<Note> {
    let title = canonicalize_title(title)?;
    let key = available_filename(root, &title, None)?;
    let path = root.join(&key);
    let content = serialize_markdown(&title, "");
    write_atomic(&path, &content)?;
    note_from_content(key, content)
}

fn read_note_in(root: &Path, key: &str) -> CommandResult<Note> {
    let path = validated_note_path(root, key)?;
    let content = fs::read_to_string(&path)
        .map_err(|error| CommandError::io("Could not read the note", error))?;
    note_from_content(key.to_owned(), content)
}

fn save_note_in(
    root: &Path,
    key: &str,
    title: &str,
    body: &str,
    expected_revision: &str,
) -> CommandResult<Note> {
    let path = validated_note_path(root, key)?;
    let title = canonicalize_title(title)?;
    let content = serialize_markdown(&title, body);
    write_atomic_checked(&path, &content, expected_revision)?;
    note_from_content(key.to_owned(), content)
}

fn rename_note_in(
    root: &Path,
    key: &str,
    title: &str,
    body: &str,
    expected_revision: &str,
) -> CommandResult<Note> {
    let title = canonicalize_title(title)?;
    rename_note_in_with(root, key, &title, body, expected_revision, |from, to| {
        fs::hard_link(from, to)
    })
}

fn rename_note_in_with<F>(
    root: &Path,
    key: &str,
    title: &str,
    body: &str,
    expected_revision: &str,
    install: F,
) -> CommandResult<Note>
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    let old_path = validated_note_path(root, key)?;
    let new_key = available_filename(root, title, Some(key))?;
    let content = serialize_markdown(title, body);

    ensure_revision(&old_path, expected_revision)?;
    if new_key == key {
        write_atomic_checked(&old_path, &content, expected_revision)?;
        return note_from_content(new_key, content);
    }

    let new_path = root.join(&new_key);
    let case_only_rename = key.eq_ignore_ascii_case(&new_key);
    if new_path.exists() && !case_only_rename {
        return Err(CommandError::new(
            "collision",
            "Another file took the note's new filename. Try saving again.",
        ));
    }

    let staged_path = write_staged_file(root, &content)?;
    if let Err(error) = ensure_revision(&old_path, expected_revision) {
        remove_temp_file(&staged_path);
        return Err(error);
    }
    if new_path.exists() && !case_only_rename {
        remove_temp_file(&staged_path);
        return Err(CommandError::new(
            "collision",
            "Another file took the note's new filename. Try saving again.",
        ));
    }

    let backup_path = match stage_original_file(root, &old_path) {
        Ok(path) => path,
        Err(error) => {
            remove_temp_file(&staged_path);
            return Err(error);
        }
    };

    if let Err(error) = install(&staged_path, &new_path) {
        let restore_result =
            fs::hard_link(&backup_path, &old_path).and_then(|()| fs::remove_file(&backup_path));
        remove_temp_file(&staged_path);
        return match restore_result {
            Ok(()) => Err(CommandError::io("Could not rename the note", error)),
            Err(restore_error) => Err(CommandError::new(
                "io",
                format!(
                    "Could not rename the note ({error}) or restore its original filename ({restore_error}). The complete original remains at {}.",
                    backup_path.display()
                ),
            )),
        };
    }

    remove_temp_file(&staged_path);
    if let Err(error) = fs::remove_file(&backup_path) {
        log::warn!(
            "The note was renamed, but temporary backup {} could not be removed: {error}",
            backup_path.display()
        );
    }

    note_from_content(new_key, content)
}

fn ensure_revision(path: &Path, expected_revision: &str) -> CommandResult<()> {
    let current = fs::read(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            CommandError::conflict()
        } else {
            CommandError::io("Could not verify the note", error)
        }
    })?;
    if revision(&current) != expected_revision {
        return Err(CommandError::conflict());
    }
    Ok(())
}

fn validated_note_path(root: &Path, key: &str) -> CommandResult<PathBuf> {
    let relative = Path::new(key);
    let mut components = relative.components();
    if key.contains('/')
        || key.contains('\\')
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || !has_markdown_extension(relative)
    {
        return Err(CommandError::new("invalid_key", "The note key is invalid."));
    }

    let joined = root.join(relative);
    let metadata = fs::symlink_metadata(&joined)
        .map_err(|error| CommandError::io("Could not inspect the note", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(CommandError::new(
            "invalid_key",
            "The note key does not identify a regular Markdown file.",
        ));
    }

    let canonical = joined
        .canonicalize()
        .map_err(|error| CommandError::io("Could not resolve the note", error))?;
    if canonical.parent() != Some(root) || !canonical.starts_with(root) {
        return Err(CommandError::new(
            "invalid_key",
            "The note is outside the selected vault.",
        ));
    }
    Ok(canonical)
}

fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn note_from_content(key: String, content: String) -> CommandResult<Note> {
    let fallback_title = Path::new(&key)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("Untitled");
    let (title, body) = parse_markdown(&content, fallback_title);
    Ok(Note {
        key,
        title,
        body,
        revision: revision(content.as_bytes()),
    })
}

fn parse_markdown(content: &str, fallback_title: &str) -> (String, String) {
    let document = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut heading_offset = 0;

    for line in document.split_inclusive('\n') {
        let line_text = line.trim_end_matches(['\r', '\n']);
        if line_text.is_empty() {
            heading_offset += line.len();
            continue;
        }

        if let Some(title) = line_text.strip_prefix("# ").map(str::trim) {
            if !title.is_empty() {
                let remainder = &document[heading_offset + line.len()..];
                let body = remainder
                    .strip_prefix("\r\n")
                    .or_else(|| remainder.strip_prefix('\n'))
                    .unwrap_or(remainder);
                return (title.to_owned(), body.to_owned());
            }
        }
        break;
    }

    (fallback_title.to_owned(), content.to_owned())
}

fn serialize_markdown(title: &str, body: &str) -> String {
    format!("# {title}\n\n{body}")
}

fn canonicalize_title(title: &str) -> CommandResult<String> {
    if title.contains(['\r', '\n']) {
        return Err(CommandError::new(
            "invalid_title",
            "A note title must contain text on one line.",
        ));
    }
    let canonical = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if canonical.is_empty() {
        return Err(CommandError::new(
            "invalid_title",
            "A note title must contain text on one line.",
        ));
    }
    Ok(canonical)
}

fn available_filename(
    root: &Path,
    title: &str,
    current_key: Option<&str>,
) -> CommandResult<String> {
    let existing = fs::read_dir(root)
        .map_err(|error| CommandError::io("Could not inspect filename collisions", error))?
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .filter(|name| !current_key.is_some_and(|current| name.eq_ignore_ascii_case(current)))
        .map(|name| name.to_lowercase())
        .collect::<HashSet<_>>();

    let base = safe_filename_stem(title);
    for number in 1.. {
        let suffix = if number == 1 {
            String::new()
        } else {
            format!(" ({number})")
        };
        let available_bytes = MAX_FILENAME_BYTES.saturating_sub(suffix.len() + 3);
        let stem = truncate_utf8(&base, available_bytes);
        let candidate = format!("{stem}{suffix}.md");
        if !existing.contains(&candidate.to_lowercase()) {
            return Ok(candidate);
        }
    }
    unreachable!()
}

fn safe_filename_stem(title: &str) -> String {
    let mut stem = title
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    stem = stem.trim_end_matches([' ', '.']).to_owned();
    if stem.is_empty() {
        stem = "Untitled".to_owned();
    }

    let device_name = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    if is_windows_reserved_name(&device_name) {
        stem.push_str(" note");
    }
    truncate_utf8(&stem, MAX_FILENAME_BYTES - 3).to_owned()
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

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

fn unique_temp_path(root: &Path, purpose: &str) -> PathBuf {
    let number = NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed);
    root.join(format!(
        "{TEMP_FILE_PREFIX}{purpose}-{}-{number}.tmp",
        std::process::id()
    ))
}

fn stage_original_file(root: &Path, original: &Path) -> CommandResult<PathBuf> {
    for _ in 0..100 {
        let backup = unique_temp_path(root, "backup");
        match fs::hard_link(original, &backup) {
            Ok(()) => {
                if let Err(error) = fs::remove_file(original) {
                    remove_temp_file(&backup);
                    return Err(CommandError::io("Could not stage the original note", error));
                }
                return Ok(backup);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(CommandError::io("Could not stage the original note", error)),
        }
    }
    Err(CommandError::new(
        "io",
        "Could not allocate a temporary backup for the original note.",
    ))
}

fn write_staged_file(root: &Path, content: &str) -> CommandResult<PathBuf> {
    for _ in 0..100 {
        let path = unique_temp_path(root, "stage");
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file
                    .write_all(content.as_bytes())
                    .and_then(|()| file.sync_all())
                {
                    remove_temp_file(&path);
                    return Err(CommandError::io("Could not stage the renamed note", error));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(CommandError::io("Could not stage the renamed note", error));
            }
        }
    }
    Err(CommandError::new(
        "io",
        "Could not allocate a temporary file for the renamed note.",
    ))
}

fn remove_temp_file(path: &Path) {
    if let Err(error) = fs::remove_file(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!(
                "Could not remove temporary file {}: {error}",
                path.display()
            );
        }
    }
}

fn revision(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn write_atomic(path: &Path, content: &str) -> CommandResult<()> {
    let file = prepare_atomic_write(path, content)?;
    file.commit()
        .map_err(|error| CommandError::io("Could not finish the note save", error))
}

fn write_atomic_checked(path: &Path, content: &str, expected_revision: &str) -> CommandResult<()> {
    let file = prepare_atomic_write(path, content)?;
    // Compare after the complete replacement has been prepared, immediately
    // before commit, to keep the unavoidable cross-process race window small.
    ensure_revision(path, expected_revision)?;
    file.commit()
        .map_err(|error| CommandError::io("Could not finish the note save", error))
}

fn prepare_atomic_write(path: &Path, content: &str) -> CommandResult<AtomicWriteFile> {
    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| CommandError::io("Could not prepare the note save", error))?;
    file.write_all(content.as_bytes())
        .map_err(|error| CommandError::io("Could not write the note", error))?;
    Ok(file)
}

#[cfg(test)]
#[path = "storage_tests.rs"]
mod tests;
