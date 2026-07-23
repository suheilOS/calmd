use atomic_write_file::AtomicWriteFile;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_FILENAME_BYTES: usize = 180;
const TEMP_FILE_PREFIX: &str = ".calmd-";
static NEXT_TEMP_FILE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub key: String,
    pub title: String,
    pub body: String,
    pub revision: String,
}

#[derive(Debug)]
pub struct PersistenceError {
    pub code: &'static str,
    pub message: String,
}

impl PersistenceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
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

pub type PersistenceResult<T> = Result<T, PersistenceError>;

pub struct NotePersistence<'a> {
    root: &'a Path,
}

impl<'a> NotePersistence<'a> {
    pub fn new(root: &'a Path) -> Self {
        Self { root }
    }

    pub fn scan(&self) -> PersistenceResult<Vec<Note>> {
        let mut notes = Vec::new();
        let entries = fs::read_dir(self.root)
            .map_err(|error| PersistenceError::io("Could not scan the vault", error))?;

        for entry in entries {
            let entry =
                entry.map_err(|error| PersistenceError::io("Could not scan the vault", error))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| PersistenceError::io("Could not inspect a vault entry", error))?;
            if !file_type.is_file() || !has_markdown_extension(&path) {
                continue;
            }
            let Some(key) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            notes.push(self.read(&key)?);
        }

        notes.sort_by(|left, right| {
            left.title
                .to_lowercase()
                .cmp(&right.title.to_lowercase())
                .then_with(|| left.key.to_lowercase().cmp(&right.key.to_lowercase()))
        });
        Ok(notes)
    }

    pub fn find_or_create(&self, title: &str) -> PersistenceResult<Note> {
        let normalized_title = canonicalize_title(title)?.to_lowercase();
        if let Some(note) = self.scan()?.into_iter().find(|note| {
            note.title
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
                == normalized_title
        }) {
            return Ok(note);
        }
        self.create(title)
    }

    pub fn create(&self, title: &str) -> PersistenceResult<Note> {
        let title = canonicalize_title(title)?;
        let key = available_filename(self.root, &title, None)?;
        let path = self.root.join(&key);
        let content = serialize_markdown(&title, "");
        write_atomic(&path, &content)?;
        note_from_content(key, content)
    }

    pub fn read(&self, key: &str) -> PersistenceResult<Note> {
        let path = validated_note_path(self.root, key)?;
        let content = fs::read_to_string(&path)
            .map_err(|error| PersistenceError::io("Could not read the note", error))?;
        note_from_content(key.to_owned(), content)
    }

    pub fn save(
        &self,
        key: &str,
        title: &str,
        body: &str,
        expected_revision: &str,
    ) -> PersistenceResult<Note> {
        let path = validated_note_path(self.root, key)?;
        let title = canonicalize_title(title)?;
        let content = serialize_markdown(&title, body);
        write_atomic_checked(&path, &content, expected_revision)?;
        note_from_content(key.to_owned(), content)
    }

    pub fn rename(
        &self,
        key: &str,
        title: &str,
        body: &str,
        expected_revision: &str,
    ) -> PersistenceResult<Note> {
        let title = canonicalize_title(title)?;
        self.rename_with(key, &title, body, expected_revision, |from, to| {
            fs::hard_link(from, to)
        })
    }

    fn rename_with<F>(
        &self,
        key: &str,
        title: &str,
        body: &str,
        expected_revision: &str,
        install: F,
    ) -> PersistenceResult<Note>
    where
        F: FnOnce(&Path, &Path) -> std::io::Result<()>,
    {
        let old_path = validated_note_path(self.root, key)?;
        let new_key = available_filename(self.root, title, Some(key))?;
        let content = serialize_markdown(title, body);

        ensure_revision(&old_path, expected_revision)?;
        if new_key == key {
            write_atomic_checked(&old_path, &content, expected_revision)?;
            return note_from_content(new_key, content);
        }

        let new_path = self.root.join(&new_key);
        let case_only_rename = key.eq_ignore_ascii_case(&new_key);
        if new_path.exists() && !case_only_rename {
            return Err(PersistenceError::new(
                "collision",
                "Another file took the note's new filename. Try saving again.",
            ));
        }

        let staged_path = write_staged_file(self.root, &content)?;
        if let Err(error) = ensure_revision(&old_path, expected_revision) {
            remove_temp_file(&staged_path);
            return Err(error);
        }
        if new_path.exists() && !case_only_rename {
            remove_temp_file(&staged_path);
            return Err(PersistenceError::new(
                "collision",
                "Another file took the note's new filename. Try saving again.",
            ));
        }

        let backup_path = match stage_original_file(self.root, &old_path) {
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
                Ok(()) => Err(PersistenceError::io("Could not rename the note", error)),
                Err(restore_error) => Err(PersistenceError::new(
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
}

fn ensure_revision(path: &Path, expected_revision: &str) -> PersistenceResult<()> {
    let current = fs::read(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            PersistenceError::conflict()
        } else {
            PersistenceError::io("Could not verify the note", error)
        }
    })?;
    if revision(&current) != expected_revision {
        return Err(PersistenceError::conflict());
    }
    Ok(())
}

fn validated_note_path(root: &Path, key: &str) -> PersistenceResult<PathBuf> {
    let relative = Path::new(key);
    let mut components = relative.components();
    if key.contains('/')
        || key.contains('\\')
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || !has_markdown_extension(relative)
    {
        return Err(PersistenceError::new(
            "invalid_key",
            "The note key is invalid.",
        ));
    }

    let joined = root.join(relative);
    let metadata = fs::symlink_metadata(&joined)
        .map_err(|error| PersistenceError::io("Could not inspect the note", error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(PersistenceError::new(
            "invalid_key",
            "The note key does not identify a regular Markdown file.",
        ));
    }

    let canonical = joined
        .canonicalize()
        .map_err(|error| PersistenceError::io("Could not resolve the note", error))?;
    if canonical.parent() != Some(root) || !canonical.starts_with(root) {
        return Err(PersistenceError::new(
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

fn note_from_content(key: String, content: String) -> PersistenceResult<Note> {
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

fn canonicalize_title(title: &str) -> PersistenceResult<String> {
    if title.contains(['\r', '\n']) {
        return Err(PersistenceError::new(
            "invalid_title",
            "A note title must contain text on one line.",
        ));
    }
    let canonical = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if canonical.is_empty() {
        return Err(PersistenceError::new(
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
) -> PersistenceResult<String> {
    let existing = fs::read_dir(root)
        .map_err(|error| PersistenceError::io("Could not inspect filename collisions", error))?
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

fn stage_original_file(root: &Path, original: &Path) -> PersistenceResult<PathBuf> {
    for _ in 0..100 {
        let backup = unique_temp_path(root, "backup");
        match fs::hard_link(original, &backup) {
            Ok(()) => {
                if let Err(error) = fs::remove_file(original) {
                    remove_temp_file(&backup);
                    return Err(PersistenceError::io(
                        "Could not stage the original note",
                        error,
                    ));
                }
                return Ok(backup);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(PersistenceError::io(
                    "Could not stage the original note",
                    error,
                ));
            }
        }
    }
    Err(PersistenceError::new(
        "io",
        "Could not allocate a temporary backup for the original note.",
    ))
}

fn write_staged_file(root: &Path, content: &str) -> PersistenceResult<PathBuf> {
    for _ in 0..100 {
        let path = unique_temp_path(root, "stage");
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file
                    .write_all(content.as_bytes())
                    .and_then(|()| file.sync_all())
                {
                    remove_temp_file(&path);
                    return Err(PersistenceError::io(
                        "Could not stage the renamed note",
                        error,
                    ));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(PersistenceError::io(
                    "Could not stage the renamed note",
                    error,
                ));
            }
        }
    }
    Err(PersistenceError::new(
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

fn write_atomic(path: &Path, content: &str) -> PersistenceResult<()> {
    let file = prepare_atomic_write(path, content)?;
    file.commit()
        .map_err(|error| PersistenceError::io("Could not finish the note save", error))
}

fn write_atomic_checked(
    path: &Path,
    content: &str,
    expected_revision: &str,
) -> PersistenceResult<()> {
    let file = prepare_atomic_write(path, content)?;
    ensure_revision(path, expected_revision)?;
    file.commit()
        .map_err(|error| PersistenceError::io("Could not finish the note save", error))
}

fn prepare_atomic_write(path: &Path, content: &str) -> PersistenceResult<AtomicWriteFile> {
    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| PersistenceError::io("Could not prepare the note save", error))?;
    file.write_all(content.as_bytes())
        .map_err(|error| PersistenceError::io("Could not write the note", error))?;
    Ok(file)
}

#[cfg(test)]
#[path = "note_persistence_tests.rs"]
mod tests;
