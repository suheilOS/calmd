use crate::{
    application::{
        ApplicationError, ApplicationResult, NoteOperations, NotePreview, OpenNoteLinkResponse,
        Retrieval, VaultState, settings, validate_vault_name,
    },
    links::NoteReference,
    note_persistence::Note,
    search::{SearchResponse, SearchState},
    unlinked_mentions::UnlinkedMention,
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

pub fn restore_vault(app: &AppHandle, state: &VaultState) -> ApplicationResult<()> {
    state.restore(settings::read_vault_path(app)?)
}

#[tauri::command]
pub fn get_substack_publication_url(app: AppHandle) -> ApplicationResult<Option<String>> {
    settings::get_substack_publication_url(&app)
}

#[tauri::command]
pub fn set_substack_publication_url(url: String, app: AppHandle) -> ApplicationResult<String> {
    settings::set_substack_publication_url(&app, &url)
}

#[tauri::command]
pub fn get_editor_spellcheck(app: AppHandle) -> ApplicationResult<bool> {
    settings::get_editor_spellcheck(&app)
}

#[tauri::command]
pub fn set_editor_spellcheck(enabled: bool, app: AppHandle) -> ApplicationResult<bool> {
    settings::set_editor_spellcheck(&app, enabled)
}

#[tauri::command]
pub async fn select_vault(
    name: String,
    app: AppHandle,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<bool> {
    validate_vault_name(&name)?;
    let selection = app
        .dialog()
        .file()
        .set_title("Choose where to create the vault")
        .blocking_pick_folder();
    let Some(FilePath::Path(parent)) = selection else {
        return Ok(false);
    };

    state.create(&parent, &name, &search, |root| {
        settings::persist_vault_path(&app, root)
    })?;
    Ok(true)
}

#[tauri::command]
pub async fn open_vault(app: AppHandle) -> ApplicationResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<VaultState>().open(&app.state::<SearchState>())
    })
    .await
    .map_err(|error| ApplicationError::new("state", format!("Could not open the vault: {error}")))?
}

#[tauri::command]
pub async fn search_notes(query: String, app: AppHandle) -> ApplicationResult<SearchResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        Retrieval::new(&app.state::<VaultState>(), &app.state::<SearchState>()).search(&query)
    })
    .await
    .map_err(|error| ApplicationError::new("search", format!("Could not search notes: {error}")))?
}

#[tauri::command]
pub async fn suggest_notes(query: String, app: AppHandle) -> ApplicationResult<Vec<NoteReference>> {
    tauri::async_runtime::spawn_blocking(move || {
        Retrieval::new(&app.state::<VaultState>(), &app.state::<SearchState>()).suggest(&query)
    })
    .await
    .map_err(|error| ApplicationError::new("search", format!("Could not suggest notes: {error}")))?
}

#[tauri::command]
pub async fn open_random_note(
    excluded_key: Option<String>,
    app: AppHandle,
) -> ApplicationResult<Option<Note>> {
    tauri::async_runtime::spawn_blocking(move || {
        Retrieval::new(&app.state::<VaultState>(), &app.state::<SearchState>())
            .random_note(excluded_key.as_deref())
    })
    .await
    .map_err(|error| {
        ApplicationError::new("search", format!("Could not open a random note: {error}"))
    })?
}

#[tauri::command]
pub async fn get_backlinks(key: String, app: AppHandle) -> ApplicationResult<Vec<NoteReference>> {
    tauri::async_runtime::spawn_blocking(move || {
        Retrieval::new(&app.state::<VaultState>(), &app.state::<SearchState>()).backlinks(&key)
    })
    .await
    .map_err(|error| {
        ApplicationError::new("search", format!("Could not load backlinks: {error}"))
    })?
}

#[tauri::command]
pub async fn get_unlinked_mentions(
    key: String,
    app: AppHandle,
) -> ApplicationResult<Vec<UnlinkedMention>> {
    tauri::async_runtime::spawn_blocking(move || {
        Retrieval::new(&app.state::<VaultState>(), &app.state::<SearchState>())
            .unlinked_mentions(&key)
    })
    .await
    .map_err(|error| {
        ApplicationError::new(
            "search",
            format!("Could not load unlinked mentions: {error}"),
        )
    })?
}

#[tauri::command]
pub fn create_note(
    title: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<Note> {
    NoteOperations::new(&state, &search).create(&title)
}

#[tauri::command]
pub fn create_untitled_note(
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<Note> {
    NoteOperations::new(&state, &search).create_untitled()
}

#[tauri::command]
pub fn open_note_link(
    target: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<OpenNoteLinkResponse> {
    NoteOperations::new(&state, &search).open_link(&target)
}

#[tauri::command]
pub fn resolve_note_preview(
    target: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<Option<NotePreview>> {
    NoteOperations::new(&state, &search).resolve_preview(&target)
}

#[tauri::command]
pub fn read_note(
    key: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<Note> {
    NoteOperations::new(&state, &search).read(&key)
}

#[tauri::command]
pub fn read_note_preview(
    key: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<NotePreview> {
    NoteOperations::new(&state, &search).read_preview(&key)
}

#[tauri::command]
pub fn save_note(
    key: String,
    title: String,
    body: String,
    expected_revision: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<Note> {
    NoteOperations::new(&state, &search).save(&key, &title, &body, &expected_revision)
}

#[tauri::command]
pub fn delete_note(
    key: String,
    expected_revision: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<()> {
    NoteOperations::new(&state, &search).delete(&key, &expected_revision)
}

#[tauri::command]
pub fn rename_note(
    key: String,
    title: String,
    body: String,
    expected_revision: String,
    state: State<'_, VaultState>,
    search: State<'_, SearchState>,
) -> ApplicationResult<Note> {
    NoteOperations::new(&state, &search).rename(&key, &title, &body, &expected_revision)
}
