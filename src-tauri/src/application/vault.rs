use super::{ApplicationError, ApplicationResult, indexed_vault::scan};
use crate::{note_persistence::recover_operation, search::SearchState};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_FILENAME_BYTES: usize = 180;

#[derive(Default)]
pub struct VaultState(Mutex<Option<PathBuf>>);

impl VaultState {
    pub fn restore(&self, stored_path: Option<PathBuf>) -> ApplicationResult<()> {
        let Some(path) = stored_path else {
            return Ok(());
        };
        if let Ok(root) = canonical_vault(&path) {
            *self.lock()? = Some(root);
        }
        Ok(())
    }

    pub fn create(
        &self,
        parent: &Path,
        name: &str,
        search: &SearchState,
        persist: impl FnOnce(&Path) -> ApplicationResult<()>,
    ) -> ApplicationResult<PathBuf> {
        let parent = canonical_vault(parent)?;
        let root = create_vault_directory(&parent, name)?;
        let indexed_notes = match scan(&root) {
            Ok(notes) => notes,
            Err(error) => {
                let _ = fs::remove_dir(&root);
                return Err(error);
            }
        };
        if let Err(error) = persist(&root) {
            let _ = fs::remove_dir(&root);
            return Err(error);
        }
        let mut guard = self.lock()?;
        *guard = Some(root.clone());
        search.reconcile_best_effort(&root, &indexed_notes);
        Ok(root)
    }

    pub fn open(&self, search: &SearchState) -> ApplicationResult<bool> {
        let guard = self.lock()?;
        let Some(_) = guard.as_ref() else {
            return Ok(false);
        };
        let root = vault_root(&guard)?;
        recover_operation(&root)?;
        let notes = scan(&root)?;
        search.reconcile_best_effort(&root, &notes);
        Ok(true)
    }

    pub(crate) fn root(&self) -> ApplicationResult<PathBuf> {
        self.lock()?
            .clone()
            .ok_or_else(|| ApplicationError::new("no_vault", "Choose a vault folder first."))
    }

    pub(super) fn with_root<T>(
        &self,
        run: impl FnOnce(&Path) -> ApplicationResult<T>,
    ) -> ApplicationResult<T> {
        let guard = self.lock()?;
        let root = vault_root(&guard)?;
        run(&root)
    }

    fn lock(&self) -> ApplicationResult<std::sync::MutexGuard<'_, Option<PathBuf>>> {
        self.0
            .lock()
            .map_err(|_| ApplicationError::new("state", "Vault state is unavailable."))
    }
}

pub(crate) fn validate_vault_name(name: &str) -> ApplicationResult<()> {
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
        return Err(ApplicationError::new(
            "invalid_vault_name",
            "Use a portable vault name without reserved characters, trailing spaces, or periods.",
        ));
    }
    Ok(())
}

fn canonical_vault(path: &Path) -> ApplicationResult<PathBuf> {
    let root = path
        .canonicalize()
        .map_err(|error| ApplicationError::io("Could not open the selected vault", error))?;
    if !root.is_dir() {
        return Err(ApplicationError::new(
            "invalid_vault",
            "The selected vault is not a directory.",
        ));
    }
    Ok(root)
}

fn create_vault_directory(parent: &Path, name: &str) -> ApplicationResult<PathBuf> {
    validate_vault_name(name)?;
    let path = parent.join(name);
    fs::create_dir(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            ApplicationError::new(
                "vault_exists",
                "A file or folder with this vault name already exists in that location.",
            )
        } else {
            ApplicationError::io("Could not create the vault folder", error)
        }
    })?;

    let root = canonical_vault(&path)?;
    if root.parent() != Some(parent) || !root.starts_with(parent) {
        let _ = fs::remove_dir(&path);
        return Err(ApplicationError::new(
            "invalid_vault",
            "The new vault folder resolved outside the chosen location.",
        ));
    }
    Ok(root)
}

fn vault_root(guard: &Option<PathBuf>) -> ApplicationResult<PathBuf> {
    let stored_root = guard
        .as_deref()
        .ok_or_else(|| ApplicationError::new("no_vault", "Choose a vault folder first."))?;
    validate_vault_root(stored_root)
}

fn validate_vault_root(stored_root: &Path) -> ApplicationResult<PathBuf> {
    let current_root = canonical_vault(stored_root)?;
    if current_root != stored_root {
        return Err(ApplicationError::new(
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
        let data = tempdir().unwrap();
        let state = VaultState::default();
        let search = SearchState::available(data.path().to_path_buf());

        let vault = state
            .create(location.path(), "Research", &search, |_| Ok(()))
            .unwrap();

        assert_eq!(
            vault,
            location.path().join("Research").canonicalize().unwrap()
        );
        assert_eq!(state.root().unwrap(), vault);
        assert!(
            state
                .create(location.path(), "Research", &search, |_| Ok(()))
                .is_err()
        );
        assert!(validate_vault_name("NUL").is_err());
        assert!(validate_vault_name("unsafe/name").is_err());
        assert!(validate_vault_name("trailing.").is_err());
    }

    #[test]
    fn failed_persistence_removes_the_new_vault_without_committing_state() {
        let location = tempdir().unwrap();
        let search = SearchState::unavailable("unused");
        let state = VaultState::default();

        let error = state
            .create(location.path(), "Research", &search, |_| {
                Err(ApplicationError::new("io", "injected settings failure"))
            })
            .unwrap_err();

        assert_eq!(error.code(), "io");
        assert!(!location.path().join("Research").exists());
        assert!(state.root().is_err());
    }

    #[test]
    fn restore_accepts_only_an_existing_canonical_directory() {
        let directory = tempdir().unwrap();
        let state = VaultState::default();
        state
            .restore(Some(directory.path().canonicalize().unwrap()))
            .unwrap();
        assert_eq!(
            state.root().unwrap(),
            directory.path().canonicalize().unwrap()
        );

        let missing = directory.path().join("missing");
        let other = VaultState::default();
        other.restore(Some(missing)).unwrap();
        assert!(other.root().is_err());
    }

    #[test]
    fn opening_surfaces_markdown_scan_failures() {
        let directory = tempdir().unwrap();
        let data = tempdir().unwrap();
        fs::write(directory.path().join("invalid.md"), [0xff]).unwrap();
        let state = VaultState::default();
        state
            .restore(Some(directory.path().canonicalize().unwrap()))
            .unwrap();
        let search = SearchState::available(data.path().to_path_buf());

        let error = state.open(&search).unwrap_err();

        assert_eq!(error.code(), "io");
    }
}
