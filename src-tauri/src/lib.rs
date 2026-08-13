mod attachments;
mod links;
mod note_persistence;
mod portable_filename;
mod search;
mod storage;
mod unlinked_mentions;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(storage::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            storage::select_vault,
            storage::open_vault,
            storage::get_substack_publication_url,
            storage::set_substack_publication_url,
            storage::get_editor_spellcheck,
            storage::set_editor_spellcheck,
            storage::search_notes,
            storage::suggest_notes,
            storage::open_random_note,
            storage::create_note,
            storage::create_untitled_note,
            storage::open_note_link,
            storage::resolve_note_preview,
            storage::read_note_preview,
            storage::get_backlinks,
            storage::get_unlinked_mentions,
            storage::read_note,
            storage::save_note,
            storage::rename_note,
            storage::delete_note,
            attachments::pick_attachment,
            attachments::import_attachment_bytes,
            attachments::resolve_image,
        ])
        .setup(|app| {
            let search = match app.path().app_data_dir() {
                Ok(path) => search::SearchState::available(path),
                Err(error) => search::SearchState::unavailable(format!(
                    "Could not resolve application data storage: {error}"
                )),
            };
            app.manage(search);
            storage::restore_vault(app.handle(), &app.state::<storage::VaultState>())?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
