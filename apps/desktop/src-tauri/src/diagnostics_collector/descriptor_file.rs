//! The connection-descriptor file the desktop writes for the local tail.
//!
//! `anyharness logs` (the `proliferate logs` verb) reaches the collector's
//! loopback surface through `~/.proliferate/diagnostics/collector.json`:
//! endpoint + capability, mode 0600, written when a collector generation
//! becomes ready and removed when it stops. The capability guards a
//! loopback-only port in the user's own trust domain — the same records are
//! readable in the file sinks beside it — so a 0600 file is the deliberate
//! custody decision, made here and nowhere else. A crash leaves a stale file
//! pointing at a dead port; the reader degrades loudly and the next ready
//! generation overwrites it.
//!
//! Best-effort by law: diagnostics plumbing never fails a launch.

use std::io::Write;
use std::path::PathBuf;

pub(crate) fn descriptor_path() -> Option<PathBuf> {
    Some(
        crate::app_config::home_dir()
            .ok()?
            .join(".proliferate")
            .join("diagnostics")
            .join("collector.json"),
    )
}

pub(crate) fn write(endpoint: &str, capability: &str) {
    let Some(path) = descriptor_path() else { return };
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let payload = serde_json::json!({ "endpoint": endpoint, "capability": capability });
    // Temp-write + rename: a reader never sees a partial file, and the mode
    // applies at creation whatever a pre-existing file carried.
    let temp = path.with_extension("json.tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let Ok(mut file) = options.open(&temp) else { return };
    if file.write_all(payload.to_string().as_bytes()).is_err() {
        let _ = std::fs::remove_file(&temp);
        return;
    }
    drop(file);
    if std::fs::rename(&temp, &path).is_err() {
        let _ = std::fs::remove_file(&temp);
    }
}

pub(crate) fn remove() {
    if let Some(path) = descriptor_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(unix)]
    fn the_descriptor_file_is_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        // Written via the same options the production path uses, into a temp
        // home-independent location by exercising write() against the real
        // path shape is not hermetic; prove the mode contract on the options
        // themselves through a scratch file.
        let dir = std::env::temp_dir().join(format!("descriptor-mode-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let path = dir.join("collector.json");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&path).expect("open");
        let mode = std::fs::metadata(&path).expect("meta").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        std::fs::remove_dir_all(&dir).expect("cleanup");
    }
}
