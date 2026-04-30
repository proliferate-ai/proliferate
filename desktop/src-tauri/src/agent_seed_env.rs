use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tauri::{path::BaseDirectory, AppHandle, Manager, Runtime};

const AGENT_SEED_DIR_ENV: &str = "ANYHARNESS_AGENT_SEED_DIR";
const AGENT_SEED_EXPECTED_ENV: &str = "ANYHARNESS_AGENT_SEED_EXPECTED";
const AGENT_SEED_UNSAFE_ENV: &str = "ANYHARNESS_AGENT_SEED_DIR_UNSAFE";

pub(crate) fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-musl"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-musl"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
}

pub(crate) fn launch_env<R: Runtime>(app: &AppHandle<R>) -> HashMap<String, String> {
    let mut env = HashMap::new();
    let target = current_target_triple();

    if let Ok(explicit_dir) = std::env::var(AGENT_SEED_DIR_ENV) {
        if cfg!(debug_assertions) || std::env::var_os(AGENT_SEED_UNSAFE_ENV).is_some() {
            env.insert(AGENT_SEED_DIR_ENV.to_string(), explicit_dir);
            if std::env::var_os(AGENT_SEED_UNSAFE_ENV).is_some() {
                env.insert(AGENT_SEED_UNSAFE_ENV.to_string(), "1".to_string());
            }
            return env;
        }
    }

    if let Some(seed_dir) = bundled_seed_dir(app, target) {
        env.insert(
            AGENT_SEED_DIR_ENV.to_string(),
            seed_dir.to_string_lossy().into_owned(),
        );
        env.insert(AGENT_SEED_EXPECTED_ENV.to_string(), "1".to_string());
        return env;
    }

    if !cfg!(debug_assertions) {
        env.insert(AGENT_SEED_EXPECTED_ENV.to_string(), "1".to_string());
    }

    env
}

fn bundled_seed_dir<R: Runtime>(app: &AppHandle<R>, target: &str) -> Option<PathBuf> {
    let resource_name = format!("agent-seeds/{}", seed_archive_name(target));
    if let Ok(seed_archive) = app.path().resolve(resource_name, BaseDirectory::Resource) {
        if let Some(seed_dir) = seed_dir_for_archive(&seed_archive) {
            return Some(seed_dir);
        }
    }

    bundled_seed_dir_from_current_exe(target)
}

fn bundled_seed_dir_from_current_exe(target: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;

    #[cfg(target_os = "macos")]
    {
        let macos_dir = exe.parent()?;
        let contents_dir = macos_dir.parent()?;
        return seed_dir_for_archive(
            &contents_dir
                .join("Resources")
                .join("agent-seeds")
                .join(seed_archive_name(target)),
        );
    }

    #[cfg(not(target_os = "macos"))]
    {
        seed_dir_for_archive(
            &exe.parent()?
                .join("agent-seeds")
                .join(seed_archive_name(target)),
        )
    }
}

fn seed_archive_name(target: &str) -> String {
    format!("agent-seed-{target}.tar.zst")
}

fn seed_dir_for_archive(seed_archive: &Path) -> Option<PathBuf> {
    seed_archive
        .is_file()
        .then(|| seed_archive.parent().map(Path::to_path_buf))
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_archive_name_uses_target_triple() {
        assert_eq!(
            seed_archive_name("aarch64-apple-darwin"),
            "agent-seed-aarch64-apple-darwin.tar.zst"
        );
    }

    #[test]
    fn seed_dir_for_archive_returns_parent_only_when_file_exists() {
        let temp = std::env::temp_dir().join(format!(
            "proliferate-agent-seed-env-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp).expect("create tempdir");
        let archive = temp.join("agent-seed-aarch64-apple-darwin.tar.zst");
        assert_eq!(seed_dir_for_archive(&archive), None);

        std::fs::write(&archive, b"seed").expect("write archive");
        assert_eq!(seed_dir_for_archive(&archive), Some(temp.clone()));
        let _ = std::fs::remove_dir_all(temp);
    }
}
