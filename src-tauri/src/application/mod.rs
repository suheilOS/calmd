mod error;
mod indexed_vault;
mod note_operations;
mod retrieval;
pub(crate) mod settings;
mod vault;

pub use error::{ApplicationError, ApplicationResult};
pub use note_operations::{NoteOperations, NotePreview, OpenNoteLinkResponse};
pub use retrieval::Retrieval;
pub use vault::VaultState;
pub(crate) use vault::validate_vault_name;
