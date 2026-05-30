use std::path::{Path, PathBuf};

pub(crate) fn find_in_path(binary_name: &str) -> Option<PathBuf> {
    find_in_path_matching(binary_name, |_| true)
}

pub(crate) fn find_real_binary_in_path(binary_name: &str) -> Option<PathBuf> {
    find_in_path_matching(binary_name, |candidate| !is_known_agent_wrapper(candidate))
}

fn find_in_path_matching(
    binary_name: &str,
    mut matches_candidate: impl FnMut(&Path) -> bool,
) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary_name);
        if is_valid_executable(&candidate) && matches_candidate(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_known_agent_wrapper(path: &Path) -> bool {
    use std::io::Read;

    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut buffer = vec![0; 4096];
    let Ok(bytes_read) = file.read(&mut buffer) else {
        return false;
    };
    String::from_utf8_lossy(&buffer[..bytes_read]).contains("# Superset agent-wrapper")
}

/// Check whether a path points to a valid, executable file (not a partial download).
pub(crate) fn is_valid_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(meta) if meta.is_file() => meta.permissions().mode() & 0o111 != 0,
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(unix)]
pub(crate) fn make_executable(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
pub(crate) fn make_executable(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_superset_agent_wrapper_marker() {
        let root = std::env::temp_dir().join(format!(
            "anyharness-agent-wrapper-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let wrapper = root.join("cursor-agent");
        std::fs::write(
            &wrapper,
            "#!/bin/sh\n# Superset agent-wrapper v3\nexec cursor-agent \"$@\"\n",
        )
        .expect("write wrapper");
        let real_binary = root.join("real-cursor-agent");
        std::fs::write(&real_binary, "#!/bin/sh\nexit 0\n").expect("write real binary");

        assert!(is_known_agent_wrapper(&wrapper));
        assert!(!is_known_agent_wrapper(&real_binary));

        let _ = std::fs::remove_dir_all(root);
    }
}
