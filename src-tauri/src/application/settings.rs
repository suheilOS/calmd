use super::{ApplicationError, ApplicationResult};
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use url::Url;

const SETTINGS_FILE: &str = "settings.json";
const VAULT_PATH_KEY: &str = "vault_path";
const SUBSTACK_PUBLICATION_URL_KEY: &str = "substack_publication_url";
const EDITOR_SPELLCHECK_KEY: &str = "editor_spellcheck_enabled";

pub fn read_vault_path(app: &AppHandle) -> ApplicationResult<Option<PathBuf>> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| ApplicationError::io("Could not open settings", error))?;
    Ok(store
        .get(VAULT_PATH_KEY)
        .and_then(|value| value.as_str().map(PathBuf::from)))
}

pub fn persist_vault_path(app: &AppHandle, root: &Path) -> ApplicationResult<()> {
    let value = root.to_str().ok_or_else(|| {
        ApplicationError::new("invalid_vault", "The vault path must be valid UTF-8.")
    })?;
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| ApplicationError::io("Could not open settings", error))?;
    store.set(VAULT_PATH_KEY, serde_json::Value::String(value.to_owned()));
    store
        .save()
        .map_err(|error| ApplicationError::io("Could not save settings", error))
}

pub fn get_substack_publication_url(app: &AppHandle) -> ApplicationResult<Option<String>> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| ApplicationError::io("Could not open settings", error))?;
    Ok(store
        .get(SUBSTACK_PUBLICATION_URL_KEY)
        .and_then(|value| value.as_str().map(str::to_owned)))
}

pub fn set_substack_publication_url(app: &AppHandle, url: &str) -> ApplicationResult<String> {
    let url = normalize_substack_publication_url(url)?;
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| ApplicationError::io("Could not open settings", error))?;
    store.set(
        SUBSTACK_PUBLICATION_URL_KEY,
        serde_json::Value::String(url.clone()),
    );
    store
        .save()
        .map_err(|error| ApplicationError::io("Could not save settings", error))?;
    Ok(url)
}

pub fn get_editor_spellcheck(app: &AppHandle) -> ApplicationResult<bool> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| ApplicationError::io("Could not open settings", error))?;
    Ok(editor_spellcheck_from_value(
        store.get(EDITOR_SPELLCHECK_KEY).as_ref(),
    ))
}

pub fn set_editor_spellcheck(app: &AppHandle, enabled: bool) -> ApplicationResult<bool> {
    let store = app
        .store(SETTINGS_FILE)
        .map_err(|error| ApplicationError::io("Could not open settings", error))?;
    store.set(EDITOR_SPELLCHECK_KEY, serde_json::Value::Bool(enabled));
    store
        .save()
        .map_err(|error| ApplicationError::io("Could not save settings", error))?;
    Ok(enabled)
}

fn editor_spellcheck_from_value(value: Option<&serde_json::Value>) -> bool {
    value.and_then(serde_json::Value::as_bool).unwrap_or(true)
}

fn normalize_substack_publication_url(value: &str) -> ApplicationResult<String> {
    let value = value.trim().trim_end_matches('/');
    let parsed = Url::parse(value).map_err(|_| {
        ApplicationError::new(
            "invalid_substack_url",
            "Enter a valid HTTPS publication URL.",
        )
    })?;

    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || (parsed.path() != "" && parsed.path() != "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ApplicationError::new(
            "invalid_substack_url",
            "Enter the base HTTPS URL of your publication, such as https://your-publication.substack.com.",
        ));
    }

    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_substack_publication_urls() {
        assert_eq!(
            normalize_substack_publication_url(" https://example.substack.com/ ").unwrap(),
            "https://example.substack.com"
        );
        assert!(normalize_substack_publication_url("http://example.substack.com").is_err());
        assert!(normalize_substack_publication_url("https://example.substack.com/about").is_err());
        assert!(
            normalize_substack_publication_url("https://example.substack.com?draft=1").is_err()
        );
    }

    #[test]
    fn editor_spellcheck_defaults_on_and_respects_a_stored_boolean() {
        assert!(editor_spellcheck_from_value(None));
        assert!(editor_spellcheck_from_value(Some(
            &serde_json::Value::Bool(true)
        )));
        assert!(!editor_spellcheck_from_value(Some(
            &serde_json::Value::Bool(false)
        )));
        assert!(editor_spellcheck_from_value(Some(
            &serde_json::Value::String("invalid".to_owned())
        )));
    }
}
