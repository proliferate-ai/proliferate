use std::path::{Path, PathBuf};

/// The on-disk filename an executable must carry on this platform. Windows
/// will not execute an extension-less file, so every managed artifact we place
/// has to be named `<name>.exe` there. Single source of truth for that rule:
/// the installer writes through it and every resolver reads through it, so a
/// write site and a read site can never disagree about the name.
pub(crate) fn platform_binary_filename(binary_name: &str) -> PathBuf {
    if cfg!(windows) && !binary_name.to_ascii_lowercase().ends_with(".exe") {
        PathBuf::from(format!("{binary_name}.exe"))
    } else {
        PathBuf::from(binary_name)
    }
}

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

pub(crate) fn is_known_agent_wrapper(path: &Path) -> bool {
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
    fn platform_binary_filename_carries_the_windows_executable_extension() {
        // Runs on every platform on purpose: the interesting half of this rule
        // is the Windows half, and a `cfg(windows)`-only test would never run
        // in a unix-only CI matrix. Asserting the contract in both directions
        // keeps the unix arm honest too, so nobody "fixes" Windows by
        // appending `.exe` everywhere.
        let name = platform_binary_filename("claude");

        assert_eq!(
            name.file_stem().and_then(|stem| stem.to_str()),
            Some("claude"),
            "the stem must always be the requested binary name"
        );
        assert_eq!(
            name.extension().and_then(|ext| ext.to_str()),
            if cfg!(windows) { Some("exe") } else { None },
            "windows needs a .exe suffix to execute the file at all; unix must not get one"
        );
        assert_eq!(
            name,
            PathBuf::from(if cfg!(windows) {
                "claude.exe"
            } else {
                "claude"
            })
        );
    }

    #[test]
    fn platform_binary_filename_does_not_double_up_an_existing_extension() {
        // Archive pins name their inner member with the extension already
        // present (codex ships `codex-x86_64-pc-windows-msvc.exe`). The
        // destination name is derived from the agent kind, never from that
        // member, so this helper is only ever handed a bare kind — but if a
        // caller ever passes a suffixed name, we must not produce `x.exe.exe`.
        let name = platform_binary_filename("codex.exe");
        assert_eq!(name, PathBuf::from("codex.exe"));
    }

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
