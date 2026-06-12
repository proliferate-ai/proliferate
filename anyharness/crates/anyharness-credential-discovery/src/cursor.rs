//! Cursor keychain detection: presence of the macOS keychain service
//! `"Cursor Safe Storage"` (where the Cursor CLI stores its login state).
//! Presence only — the secret value is never read into a fact. Non-macOS
//! platforms are always absent.

use std::path::Path;

use crate::facts::fact_kinds;

#[cfg(target_os = "macos")]
const CURSOR_KEYCHAIN_SERVICE: &str = "Cursor Safe Storage";

pub(crate) fn discovery_fact_kinds(home_dir: &Path) -> Vec<&'static str> {
    if keychain_entry_present(home_dir) {
        vec![fact_kinds::CURSOR_KEYCHAIN]
    } else {
        Vec::new()
    }
}

#[cfg(target_os = "macos")]
fn keychain_entry_present(home_dir: &Path) -> bool {
    use crate::util::home_matches_process_home;

    // Mirror the claude keychain guard: the keychain belongs to the process
    // user, so probing it for a foreign home_dir would fabricate facts.
    if !home_matches_process_home(home_dir) {
        tracing::debug!(
            home_dir = %home_dir.display(),
            "Skipping Cursor keychain lookup because home_dir does not match process home"
        );
        return false;
    }

    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", CURSOR_KEYCHAIN_SERVICE])
        .output();
    match output {
        Ok(output) => output.status.success(),
        Err(err) => {
            tracing::warn!(error = %err, "Cursor keychain lookup failed; treating as absent");
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_entry_present(_home_dir: &Path) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn foreign_home_dir_is_always_absent() {
        let home = std::env::temp_dir().join(format!(
            "anyharness-cursor-credential-discovery-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&home).expect("create temp home");

        assert!(discovery_fact_kinds(&home).is_empty());

        let _ = std::fs::remove_dir_all(home);
    }
}
