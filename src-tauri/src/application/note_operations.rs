use super::{
    ApplicationError, ApplicationResult, VaultState,
    retrieval::{reconcile_after_rename, remove_best_effort, replace_best_effort},
};
use crate::{
    links::key_stem,
    note_persistence::{LinkKeyResolution, LinkResolution, Note, NotePersistence, NotePreviewRead},
    search::SearchState,
};
use serde::Serialize;

const NOTE_PREVIEW_CHARACTER_LIMIT: usize = 4_000;

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

pub struct NoteOperations<'a> {
    vault: &'a VaultState,
    search: &'a SearchState,
}

impl<'a> NoteOperations<'a> {
    pub fn new(vault: &'a VaultState, search: &'a SearchState) -> Self {
        Self { vault, search }
    }

    pub fn create(&self, title: &str) -> ApplicationResult<Note> {
        self.vault.with_root(|root| {
            let note = NotePersistence::new(root).find_or_create(title)?;
            replace_best_effort(self.search, root, &note);
            Ok(note)
        })
    }

    pub fn create_untitled(&self) -> ApplicationResult<Note> {
        self.vault.with_root(|root| {
            let note = NotePersistence::new(root).create_untitled()?;
            replace_best_effort(self.search, root, &note);
            Ok(note)
        })
    }

    pub fn open_link(&self, target: &str) -> ApplicationResult<OpenNoteLinkResponse> {
        let target = validate_link_target(target)?;
        self.vault.with_root(|root| {
            let persistence = NotePersistence::new(root);
            let note = match persistence.resolve_link(&target)? {
                LinkResolution::Missing => persistence.create(&target)?,
                LinkResolution::Found(note) => note,
                LinkResolution::Ambiguous => {
                    return Err(ApplicationError::new(
                        "ambiguous_link",
                        "More than one note matches this link.",
                    ));
                }
            };
            replace_best_effort(self.search, root, &note);
            Ok(OpenNoteLinkResponse {
                canonical_target: key_stem(&note.key).to_owned(),
                note,
            })
        })
    }

    pub fn resolve_preview(&self, target: &str) -> ApplicationResult<Option<NotePreview>> {
        let target = validate_link_target(target)?;
        self.vault.with_root(|root| {
            let persistence = NotePersistence::new(root);
            match persistence.resolve_link_key(&target)? {
                LinkKeyResolution::Found(key) => Ok(Some(note_preview(
                    persistence.read_preview(&key, NOTE_PREVIEW_CHARACTER_LIMIT)?,
                ))),
                LinkKeyResolution::Missing | LinkKeyResolution::Ambiguous => Ok(None),
            }
        })
    }

    pub fn read(&self, key: &str) -> ApplicationResult<Note> {
        self.vault
            .with_root(|root| NotePersistence::new(root).read(key).map_err(Into::into))
    }

    pub fn read_preview(&self, key: &str) -> ApplicationResult<NotePreview> {
        self.vault.with_root(|root| {
            NotePersistence::new(root)
                .read_preview(key, NOTE_PREVIEW_CHARACTER_LIMIT)
                .map(note_preview)
                .map_err(Into::into)
        })
    }

    pub fn save(
        &self,
        key: &str,
        title: &str,
        body: &str,
        expected_revision: &str,
    ) -> ApplicationResult<Note> {
        self.vault.with_root(|root| {
            let note = NotePersistence::new(root).save(key, title, body, expected_revision)?;
            replace_best_effort(self.search, root, &note);
            Ok(note)
        })
    }

    pub fn delete(&self, key: &str, expected_revision: &str) -> ApplicationResult<()> {
        self.vault.with_root(|root| {
            NotePersistence::new(root).delete(key, expected_revision)?;
            remove_best_effort(self.search, key);
            Ok(())
        })
    }

    pub fn rename(
        &self,
        key: &str,
        title: &str,
        body: &str,
        expected_revision: &str,
    ) -> ApplicationResult<Note> {
        self.vault.with_root(|root| {
            let note = NotePersistence::new(root).rename_with_links(
                key,
                title,
                body,
                expected_revision,
            )?;
            reconcile_after_rename(self.search, root);
            Ok(note)
        })
    }
}

fn note_preview(note: NotePreviewRead) -> NotePreview {
    NotePreview {
        key: note.key,
        title: note.title,
        excerpt: note.body,
        truncated: note.truncated,
    }
}

fn validate_link_target(target: &str) -> ApplicationResult<String> {
    let target = key_stem(target.trim());
    if target.is_empty()
        || target.contains(['\r', '\n', '/', '\\', '|', '#', '^'])
        || target.contains("[[")
        || target.contains("]]")
    {
        return Err(ApplicationError::new(
            "invalid_link",
            "This internal link target is invalid.",
        ));
    }
    Ok(target.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn ready_vault(root: &std::path::Path) -> VaultState {
        let vault = VaultState::default();
        vault.restore(Some(root.canonicalize().unwrap())).unwrap();
        vault
    }

    #[test]
    fn derived_index_failure_does_not_change_a_persisted_note() {
        let directory = tempdir().unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::unavailable("injected index failure");
        let operations = NoteOperations::new(&vault, &search);

        let note = operations.create("Durable source").unwrap();
        let saved = operations
            .save(
                &note.key,
                &note.title,
                "Saved without an index",
                &note.revision,
            )
            .unwrap();

        let stored = NotePersistence::new(directory.path())
            .read(&saved.key)
            .unwrap();
        assert_eq!(stored.body, "Saved without an index");
        assert_eq!(stored.revision, saved.revision);
        assert!(search.needs_reconciliation());
    }

    #[test]
    fn rename_and_delete_commit_even_when_the_index_is_unavailable() {
        let directory = tempdir().unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::unavailable("injected index failure");
        let operations = NoteOperations::new(&vault, &search);
        let note = operations.create("Original").unwrap();

        let renamed = operations
            .rename(&note.key, "Renamed", "Body", &note.revision)
            .unwrap();
        assert!(!directory.path().join(&note.key).exists());
        assert!(directory.path().join(&renamed.key).exists());

        operations.delete(&renamed.key, &renamed.revision).unwrap();
        assert!(!directory.path().join(&renamed.key).exists());
        assert!(search.needs_reconciliation());
    }

    #[test]
    fn open_link_returns_the_canonical_created_target() {
        let directory = tempdir().unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::unavailable("injected index failure");

        let response = NoteOperations::new(&vault, &search)
            .open_link(" New thought ")
            .unwrap();

        assert_eq!(response.canonical_target, "New thought");
        assert_eq!(response.note.title, "New thought");
    }

    #[test]
    fn preview_resolution_is_read_only_and_bounded() {
        let directory = tempdir().unwrap();
        let persistence = NotePersistence::new(directory.path());
        let note = persistence.create("Preview").unwrap();
        let body = "a".repeat(NOTE_PREVIEW_CHARACTER_LIMIT + 1);
        let note = persistence
            .save(&note.key, &note.title, &body, &note.revision)
            .unwrap();
        let vault = ready_vault(directory.path());
        let search = SearchState::unavailable("unused");

        let preview = NoteOperations::new(&vault, &search)
            .resolve_preview("Preview")
            .unwrap()
            .unwrap();

        assert_eq!(
            preview.excerpt.chars().count(),
            NOTE_PREVIEW_CHARACTER_LIMIT
        );
        assert!(preview.truncated);
        assert_eq!(persistence.read(&note.key).unwrap().revision, note.revision);
    }
}
