use crate::commands::keychain;

use super::types::StoredOAuthBundle;

pub fn read_oauth_bundle(connection_id: &str) -> Result<Option<StoredOAuthBundle>, String> {
    let Some(raw) = keychain::read_connector_oauth_bundle(connection_id)? else {
        return Ok(None);
    };
    serde_json::from_str::<StoredOAuthBundle>(&raw)
        .map(Some)
        .map_err(|error| format!("Couldn't read saved OAuth state: {error}"))
}

pub fn write_oauth_bundle(connection_id: &str, bundle: &StoredOAuthBundle) -> Result<(), String> {
    let raw = serde_json::to_string(bundle).map_err(|error| error.to_string())?;
    keychain::set_connector_oauth_bundle(connection_id, &raw)
}

pub fn delete_oauth_bundle(connection_id: &str) -> Result<(), String> {
    keychain::delete_connector_oauth_bundle(connection_id)
}
