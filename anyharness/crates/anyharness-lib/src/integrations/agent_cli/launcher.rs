use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::executable::make_executable;

#[derive(Debug, thiserror::Error)]
pub enum LauncherError {
    #[error("launcher path setup failed: {0}")]
    PathJoin(#[from] std::env::JoinPathsError),
    #[error("launcher io error: {0}")]
    Io(#[from] std::io::Error),
}

/// Regenerate a LIVE managed launcher without ever letting `fs::write` land
/// directly on the live path. The script is written to a `.{name}.next` staged
/// sibling, made executable, then atomically renamed over the live launcher.
///
/// POSIX rename replaces the directory entry while a running managed session
/// keeps the previous inode open (no kills, no waiting — Update Flow FR-3 /
/// R2.5). A transient `.{name}.previous` copy preserves the prior launcher
/// across the rename so a promotion failure leaves the old launcher in place.
pub(crate) fn generate_launcher_script_atomic(
    launcher_path: &Path,
    exec_path: &Path,
    extra_args: &[String],
    env: &HashMap<String, String>,
    path_prefixes: &[PathBuf],
) -> Result<(), LauncherError> {
    let staged = staged_launcher_sibling(launcher_path, "next")?;
    // Best-effort clear of a residual staged file from an interrupted prior run.
    let _ = std::fs::remove_file(&staged);
    generate_launcher_script(&staged, exec_path, extra_args, env, path_prefixes)?;
    promote_launcher(&staged, launcher_path)?;
    Ok(())
}

/// Atomically move `staged` onto `live`, keeping the previous launcher (if any)
/// in a `.{name}.previous` sibling until the promotion succeeds, then removing
/// it. Running sessions holding the old inode are unaffected.
fn promote_launcher(staged: &Path, live: &Path) -> Result<(), LauncherError> {
    // Deliberately NOT `.{name}.previous`: that sibling belongs to the
    // journaled ArchiveTreeActivation, and a crash between our two renames must
    // not leave a journal-less backup that wedges its recovery path.
    let previous = staged_launcher_sibling(live, "launcher-previous")?;
    let _ = std::fs::remove_file(&previous);
    if live.exists() {
        std::fs::rename(live, &previous)?;
    }
    match std::fs::rename(staged, live) {
        Ok(()) => {
            let _ = std::fs::remove_file(&previous);
            Ok(())
        }
        Err(error) => {
            // Promotion failed: restore the previous launcher so the live path
            // keeps its working version (R2.5: rename-failure leaves prior).
            if previous.exists() {
                let _ = std::fs::rename(&previous, live);
            }
            let _ = std::fs::remove_file(staged);
            Err(LauncherError::Io(error))
        }
    }
}

fn staged_launcher_sibling(launcher_path: &Path, suffix: &str) -> Result<PathBuf, LauncherError> {
    let name = launcher_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            LauncherError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "launcher path has no file name",
            ))
        })?;
    Ok(launcher_path.with_file_name(format!(".{name}.{suffix}")))
}

pub(crate) fn generate_launcher_script(
    launcher_path: &Path,
    exec_path: &Path,
    extra_args: &[String],
    env: &HashMap<String, String>,
    path_prefixes: &[PathBuf],
) -> Result<(), LauncherError> {
    let mut script = String::from("#!/bin/sh\nset -e\n");

    if !path_prefixes.is_empty() {
        let joined = std::env::join_paths(path_prefixes)?;
        script.push_str(&format!(
            "export PATH='{}':\"$PATH\"\n",
            shell_escape(&joined.to_string_lossy())
        ));
    }

    for (key, value) in env {
        script.push_str(&format!("export {}='{}'\n", key, shell_escape(value)));
    }

    script.push_str(&format!("exec \"{}\"", exec_path.display()));
    for arg in extra_args {
        script.push(' ');
        script.push_str(&shell_escape(arg));
    }
    script.push_str(" \"$@\"\n");

    std::fs::write(launcher_path, script)?;
    make_executable(launcher_path)?;
    Ok(())
}

fn shell_escape(s: &str) -> String {
    if s.contains(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == '\\') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_escape_leaves_simple_tokens_unquoted() {
        assert_eq!(shell_escape("codex"), "codex");
        assert_eq!(shell_escape("--acp"), "--acp");
    }

    #[test]
    fn shell_escape_quotes_shell_sensitive_tokens() {
        assert_eq!(shell_escape("two words"), "'two words'");
        assert_eq!(shell_escape("has'quote"), "'has'\\''quote'");
        assert_eq!(shell_escape("has\\slash"), "'has\\slash'");
    }

    fn scratch(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("scratch dir");
        path
    }

    #[cfg(unix)]
    #[test]
    fn atomic_regen_preserves_previous_inode_until_promotion() {
        use std::io::Read;
        use std::os::unix::fs::MetadataExt;

        let dir = scratch("launcher-atomic");
        let live = dir.join("claude-launcher");
        let env = HashMap::new();

        // Seed a "running" launcher and capture its inode + an open handle.
        generate_launcher_script(&live, Path::new("/bin/echo-old"), &[], &env, &[])
            .expect("seed launcher");
        let old_ino = std::fs::metadata(&live).expect("meta").ino();
        let mut held = std::fs::File::open(&live).expect("hold old launcher fd");

        // The staged sibling receives the new bytes; the live path must not be
        // written in place.
        generate_launcher_script_atomic(&live, Path::new("/bin/echo-new"), &[], &env, &[])
            .expect("atomic regen");

        // The live path now points at a NEW inode with the new exec target.
        let new_ino = std::fs::metadata(&live).expect("meta2").ino();
        assert_ne!(old_ino, new_ino, "promotion must swap the inode, not overwrite");
        let live_script = std::fs::read_to_string(&live).expect("read live");
        assert!(live_script.contains("/bin/echo-new"), "live has new target");

        // The held fd (a running session) still reads the OLD launcher bytes —
        // POSIX inode semantics: no kill, no wait.
        let mut old_bytes = String::new();
        held.read_to_string(&mut old_bytes).expect("read held fd");
        assert!(old_bytes.contains("/bin/echo-old"), "old inode content survives");

        // No staged/previous residue is left behind after a clean promotion.
        assert!(!dir.join(".claude-launcher.next").exists(), "no staged residue");
        assert!(!dir.join(".claude-launcher.previous").exists(), "no previous residue");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
