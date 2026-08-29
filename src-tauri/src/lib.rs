mod application;
mod attachments;
mod commands;
mod links;
mod note_persistence;
mod portable_filename;
mod search;
mod text_normalization;
mod unlinked_mentions;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(application::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            commands::select_vault,
            commands::open_vault,
            commands::get_substack_publication_url,
            commands::set_substack_publication_url,
            commands::get_editor_spellcheck,
            commands::set_editor_spellcheck,
            commands::search_notes,
            commands::suggest_notes,
            commands::open_random_note,
            commands::create_note,
            commands::create_untitled_note,
            commands::open_note_link,
            commands::resolve_note_preview,
            commands::read_note_preview,
            commands::get_backlinks,
            commands::get_unlinked_mentions,
            commands::read_note,
            commands::save_note,
            commands::rename_note,
            commands::delete_note,
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
            commands::restore_vault(app.handle(), &app.state::<application::VaultState>())?;
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
