use super::{
    ApplicationError, ApplicationResult, VaultState,
    indexed_vault::{indexed_note, scan},
};
use crate::{
    links::NoteReference,
    note_persistence::{Note, NotePersistence},
    search::{SearchResponse, SearchState},
    unlinked_mentions::UnlinkedMention,
};
use std::path::Path;

pub struct Retrieval<'a> {
    vault: &'a VaultState,
    search: &'a SearchState,
}

impl<'a> Retrieval<'a> {
    pub fn new(vault: &'a VaultState, search: &'a SearchState) -> Self {
        Self { vault, search }
    }

    pub fn search(&self, query: &str) -> ApplicationResult<SearchResponse> {
        self.vault.with_root(|root| {
            reconcile_if_needed(self.search, root)?;
            match self.search.search(query) {
                Ok(response) => Ok(response),
                Err(error) if error.is_recoverable() => {
                    reconcile(self.search, root)?;
                    self.search.search(query).map_err(search_error)
                }
                Err(error) => Err(search_error(error)),
            }
        })
    }

    pub fn suggest(&self, query: &str) -> ApplicationResult<Vec<NoteReference>> {
        self.vault.with_root(|root| {
            reconcile_if_needed(self.search, root)?;
            self.search.suggest_notes(query).map_err(search_error)
        })
    }

    pub fn random_note(&self, excluded_key: Option<&str>) -> ApplicationResult<Option<Note>> {
        self.vault.with_root(|root| {
            reconcile_if_needed(self.search, root)?;
            let key = match (
                self.search.random_key(excluded_key).map_err(search_error)?,
                excluded_key.is_some(),
            ) {
                (None, true) => self.search.random_key(None).map_err(search_error)?,
                (key, _) => key,
            };
            let Some(key) = key else {
                return Ok(None);
            };
            NotePersistence::new(root)
                .read(&key)
                .map(Some)
                .map_err(Into::into)
        })
    }

    pub fn backlinks(&self, key: &str) -> ApplicationResult<Vec<NoteReference>> {
        self.vault.with_root(|root| {
            reconcile_if_needed(self.search, root)?;
            self.search.backlinks(key).map_err(search_error)
        })
    }

    pub fn unlinked_mentions(&self, key: &str) -> ApplicationResult<Vec<UnlinkedMention>> {
        self.vault.with_root(|root| {
            reconcile_if_needed(self.search, root)?;
            self.search.unlinked_mentions(key).map_err(search_error)
        })
    }
}

pub(super) fn reconcile_after_rename(search: &SearchState, root: &Path) {
    match scan(root) {
        Ok(notes) => search.reconcile_best_effort(root, &notes),
        Err(error) => {
            search.mark_dirty();
            log::warn!(
                "The rename succeeded, but its derived index is stale: {}",
                error.message()
            );
        }
    }
}

pub(super) fn replace_best_effort(search: &SearchState, root: &Path, note: &Note) {
    let result = indexed_note(root, note)
        .and_then(|indexed| search.replace(None, &indexed).map_err(search_error));
    if let Err(error) = result {
        search.mark_dirty();
        log::warn!(
            "The Markdown note was saved, but its derived search entry is stale: {}",
            error.message()
        );
    }
}

pub(super) fn remove_best_effort(search: &SearchState, key: &str) {
    if let Err(error) = search.remove(key) {
        search.mark_dirty();
        log::warn!("The Markdown note was deleted, but its derived search entry is stale: {error}");
    }
}

fn reconcile_if_needed(search: &SearchState, root: &Path) -> ApplicationResult<()> {
    if search.needs_reconciliation() {
        reconcile(search, root)?;
    }
    Ok(())
}

fn reconcile(search: &SearchState, root: &Path) -> ApplicationResult<()> {
    search.reconcile(root, &scan(root)?).map_err(search_error)
}

fn search_error(error: impl std::fmt::Display) -> ApplicationError {
    ApplicationError::new("search", format!("Search is unavailable: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn ready_vault(root: &Path) -> VaultState {
        let vault = VaultState::default();
        vault.restore(Some(root.canonicalize().unwrap())).unwrap();
        vault
    }

    #[test]
    fn dirty_retrieval_reconciles_from_markdown() {
        let data = tempdir().unwrap();
        let directory = tempdir().unwrap();
        NotePersistence::new(directory.path())
            .create("Recovered thought")
            .unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::available(data.path().to_path_buf());

        let response = Retrieval::new(&vault, &search).search("Recovered").unwrap();

        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].title, "Recovered thought");
    }

    #[test]
    fn random_note_reads_current_markdown_after_index_selection() {
        let data = tempdir().unwrap();
        let directory = tempdir().unwrap();
        let persistence = NotePersistence::new(directory.path());
        let note = persistence.create("Indexed title").unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::available(data.path().to_path_buf());
        reconcile(&search, directory.path()).unwrap();

        fs::write(
            directory.path().join(&note.key),
            "# Current title\n\nUpdated directly on disk",
        )
        .unwrap();

        let selected = Retrieval::new(&vault, &search)
            .random_note(None)
            .unwrap()
            .unwrap();
        assert_eq!(selected.key, note.key);
        assert_eq!(selected.title, "Current title");
        assert_eq!(selected.body, "Updated directly on disk");
    }

    #[test]
    fn unavailable_index_preserves_search_error_contract() {
        let directory = tempdir().unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::unavailable("injected index failure");

        let error = Retrieval::new(&vault, &search)
            .search("thought")
            .unwrap_err();

        assert_eq!(error.code(), "search");
        assert!(error.message().starts_with("Search is unavailable:"));
    }
}
