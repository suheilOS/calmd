mod search;
mod storage;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(storage::VaultState::default())
        .invoke_handler(tauri::generate_handler![
            storage::select_vault,
            storage::open_vault,
            storage::search_notes,
            storage::create_note,
            storage::read_note,
            storage::save_note,
            storage::rename_note,
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
