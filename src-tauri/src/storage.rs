use atomic_write_file::AtomicWriteFile;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_store::StoreExt;

const SETTINGS_FILE: &str = "settings.json";
const VAULT_PATH_KEY: &str = "vault_path";
const MAX_FILENAME_BYTES: usize = 180;

#[derive(Default)]
pub struct VaultState(Mutex<Option<PathBuf>>);

#[derive(Debug, Serialize)]
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
) -> CommandResult<Option<Vec<Note>>> {
    validate_vault_name(&name)?;
    let selection = app
        .dialog()
        .file()
        .set_title("Choose where to create the vault")
        .blocking_pick_folder();

    let Some(FilePath::Path(path)) = selection else {
        return Ok(None);
    };

    let parent = canonical_vault(&path)?;
    let root = create_vault_directory(&parent, &name)?;
    let notes = match scan_vault(&root) {
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
    *state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))? = Some(root);

    Ok(Some(notes))
}

#[tauri::command]
pub fn open_vault(state: State<'_, VaultState>) -> CommandResult<Option<Vec<Note>>> {
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let Some(_) = guard.as_ref() else {
        return Ok(None);
    };
    let root = vault_root(&guard)?;
    scan_vault(&root).map(Some)
}

#[tauri::command]
pub fn create_note(title: String, state: State<'_, VaultState>) -> CommandResult<Note> {
    validate_title(&title)?;
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    create_note_in(&root, &title)
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
) -> CommandResult<Note> {
    validate_title(&title)?;
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    save_note_in(&root, &key, &title, &body, &expected_revision)
}

#[tauri::command]
pub fn rename_note(
    key: String,
    title: String,
    body: String,
    expected_revision: String,
    state: State<'_, VaultState>,
) -> CommandResult<Note> {
    validate_title(&title)?;
    let guard = state
        .0
        .lock()
        .map_err(|_| CommandError::new("state", "Vault state is unavailable."))?;
    let root = vault_root(&guard)?;
    rename_note_in(&root, &key, &title, &body, &expected_revision)
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

fn create_note_in(root: &Path, title: &str) -> CommandResult<Note> {
    let key = available_filename(root, title, None)?;
    let path = root.join(&key);
    let content = serialize_markdown(title, "");
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
    let content = serialize_markdown(title, body);
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
    let old_path = validated_note_path(root, key)?;
    let new_key = available_filename(root, title, Some(key))?;
    let content = serialize_markdown(title, body);

    // Save the complete new content at the old path first. If the process stops
    // here, the note remains intact and can be reconciled on the next scan.
    write_atomic_checked(&old_path, &content, expected_revision)?;

    if new_key != key {
        let new_path = root.join(&new_key);
        if new_path.exists() {
            return Err(CommandError::new(
                "collision",
                "Another file took the note's new filename. Try saving again.",
            ));
        }
        fs::rename(&old_path, &new_path)
            .map_err(|error| CommandError::io("Could not rename the note", error))?;
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
    let mut offset = 0;
    for line in content.split_inclusive('\n') {
        let heading = line
            .trim_end_matches('\n')
            .trim_end_matches('\r')
            .trim_start_matches('\u{feff}');
        if let Some(title) = heading.strip_prefix("# ").map(str::trim) {
            if !title.is_empty() {
                let remainder = &content[offset + line.len()..];
                let body = remainder
                    .strip_prefix("\r\n")
                    .or_else(|| remainder.strip_prefix('\n'))
                    .unwrap_or(remainder);
                return (title.to_owned(), body.to_owned());
            }
        }
        offset += line.len();
    }

    (fallback_title.to_owned(), content.to_owned())
}

fn serialize_markdown(title: &str, body: &str) -> String {
    format!("# {title}\n\n{body}")
}

fn validate_title(title: &str) -> CommandResult<()> {
    if title.trim().is_empty() || title.contains(['\r', '\n']) {
        return Err(CommandError::new(
            "invalid_title",
            "A note title must contain text on one line.",
        ));
    }
    Ok(())
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
        .filter(|name| current_key != Some(name.as_str()))
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
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_canonical_and_external_markdown() {
        assert_eq!(
            parse_markdown("# Purification\n\nThe body", "fallback"),
            ("Purification".to_owned(), "The body".to_owned())
        );
        assert_eq!(
            parse_markdown("An external note without a heading", "External"),
            (
                "External".to_owned(),
                "An external note without a heading".to_owned()
            )
        );
        assert_eq!(
            parse_markdown("Preface\n# عنوان عربي\nBody", "fallback"),
            ("عنوان عربي".to_owned(), "Body".to_owned())
        );
    }

    #[test]
    fn derives_portable_filenames_without_changing_titles() {
        assert_eq!(safe_filename_stem("A/B: C?"), "A-B- C-");
        assert_eq!(safe_filename_stem("CON"), "CON note");
        assert_eq!(safe_filename_stem("NUL.txt"), "NUL.txt note");
        assert_eq!(safe_filename_stem("Trailing. "), "Trailing");
        assert_eq!(safe_filename_stem("عنوان عربي"), "عنوان عربي");
    }

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
    fn handles_case_insensitive_filename_collisions() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("Purification.md"), "existing").unwrap();
        assert_eq!(
            available_filename(vault.path(), "purification", None).unwrap(),
            "purification (2).md"
        );
    }

    #[test]
    fn creates_saves_renames_and_detects_conflicts() {
        let vault = tempdir().unwrap();
        let created = create_note_in(vault.path(), "Purification").unwrap();
        assert_eq!(created.key, "Purification.md");

        let saved = save_note_in(
            vault.path(),
            &created.key,
            &created.title,
            "Complete body",
            &created.revision,
        )
        .unwrap();
        assert_eq!(saved.body, "Complete body");

        fs::write(
            vault.path().join(&saved.key),
            "# Purification\n\nExternal edit",
        )
        .unwrap();
        let conflict = save_note_in(
            vault.path(),
            &saved.key,
            &saved.title,
            "Calmd edit",
            &saved.revision,
        )
        .unwrap_err();
        assert_eq!(conflict.code, "conflict");

        let reopened = read_note_in(vault.path(), &saved.key).unwrap();
        let renamed = rename_note_in(
            vault.path(),
            &reopened.key,
            "تنقية",
            &reopened.body,
            &reopened.revision,
        )
        .unwrap();
        assert_eq!(renamed.key, "تنقية.md");
        assert!(!vault.path().join("Purification.md").exists());
        assert_eq!(
            read_note_in(vault.path(), "تنقية.md").unwrap().title,
            "تنقية"
        );
    }

    #[test]
    fn rejects_traversal_and_symlinks() {
        let vault = tempdir().unwrap();
        assert!(validated_note_path(vault.path(), "../outside.md").is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::write(vault.path().join("real.md"), "# Real\n\n").unwrap();
            symlink(vault.path().join("real.md"), vault.path().join("link.md")).unwrap();
            assert!(validated_note_path(vault.path(), "link.md").is_err());
        }
    }
}
