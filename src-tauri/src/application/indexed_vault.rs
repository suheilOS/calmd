use super::{ApplicationError, ApplicationResult};
use crate::{
    note_persistence::{Note, NotePersistence},
    search::IndexedNote,
};
use std::{fs, path::Path, time::UNIX_EPOCH};

pub(super) fn scan(root: &Path) -> ApplicationResult<Vec<IndexedNote>> {
    NotePersistence::new(root)
        .scan()?
        .iter()
        .map(|note| indexed_note(root, note))
        .collect()
}

pub(super) fn indexed_note(root: &Path, note: &Note) -> ApplicationResult<IndexedNote> {
    let metadata = fs::metadata(root.join(&note.key)).map_err(|error| {
        ApplicationError::io("Could not inspect a note modification time", error)
    })?;
    let modified_at_ms = metadata
        .modified()
        .map_err(|error| ApplicationError::io("Could not read a note modification time", error))?
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
