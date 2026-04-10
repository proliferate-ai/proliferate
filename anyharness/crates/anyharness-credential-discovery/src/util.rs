use std::path::{Path, PathBuf};

pub(crate) fn resolve_process_override_dir(
    env_name: &str,
    home_dir: &Path,
    default_path: PathBuf,
) -> PathBuf {
    if home_matches_process_home(home_dir) {
        if let Ok(value) = std::env::var(env_name) {
            if !value.is_empty() {
                return PathBuf::from(value);
            }
        }
    }
    default_path
}

pub(crate) fn home_matches_process_home(home_dir: &Path) -> bool {
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(value) = std::env::var(key) {
            if Path::new(&value) == home_dir {
                return true;
            }
        }
    }
    false
}
