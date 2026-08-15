use std::io::Read;
use std::path::Path;

use super::{open_existing_owner_file, DiscoveryError};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileInstance {
    profile: String,
    worktree_path: String,
    branch: String,
    profile_env: String,
    launch_env: String,
    tauri_config: String,
    tauri_runner: String,
    tauri_app_runner: String,
    anyharness_runtime_home: String,
    desktop_home: String,
    database_name: String,
    ports: ProfilePorts,
    updated_at: String,
    status: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfilePorts {
    api: u16,
    desktop_web: u16,
    hosted_web: u16,
    mobile_web: u16,
    hmr: u16,
    anyharness: u16,
}

pub(super) fn read_profile_instance(path: &Path) -> Result<(String, String), DiscoveryError> {
    let mut file = open_existing_owner_file(path, None)?;
    let length = file.metadata().map_err(|_| DiscoveryError::Io)?.len();
    if length == 0 || length > 65_536 {
        return Err(DiscoveryError::Protocol);
    }
    let mut bytes = Vec::with_capacity(length as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| DiscoveryError::Io)?;
    let instance: ProfileInstance =
        serde_json::from_slice(&bytes).map_err(|_| DiscoveryError::Protocol)?;
    Ok((instance.profile, instance.desktop_home))
}
