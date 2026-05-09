use std::path::Path;

pub(super) fn strip_quarantine_best_effort(_runtime_home: &Path) {
    #[cfg(target_os = "macos")]
    {
        let targets = [
            _runtime_home.join("agents").join("claude"),
            _runtime_home.join("agents").join("codex"),
            _runtime_home.join("node"),
        ];
        for target in targets {
            strip_quarantine_tree_best_effort(&target);
        }
    }
}

#[cfg(target_os = "macos")]
fn strip_quarantine_tree_best_effort(root: &Path) {
    use std::fs;

    if !root.exists() {
        return;
    }

    let mut pending = Vec::with_capacity(128);
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                tracing::debug!(
                    error = %error,
                    path = %path.display(),
                    "failed to inspect agent seed path while stripping quarantine"
                );
                continue;
            }
        };

        pending.push(path.clone());
        if pending.len() >= 128 {
            strip_quarantine_batch_best_effort(&mut pending);
        }

        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            let entries = match fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(error) => {
                    tracing::debug!(
                        error = %error,
                        path = %path.display(),
                        "failed to read agent seed directory while stripping quarantine"
                    );
                    continue;
                }
            };
            for entry in entries.flatten() {
                stack.push(entry.path());
            }
        }
    }

    strip_quarantine_batch_best_effort(&mut pending);
}

#[cfg(target_os = "macos")]
fn strip_quarantine_batch_best_effort(paths: &mut Vec<std::path::PathBuf>) {
    use std::process::Stdio;

    if paths.is_empty() {
        return;
    }

    let result = std::process::Command::new("/usr/bin/xattr")
        .arg("-d")
        .arg("com.apple.quarantine")
        .args(paths.iter())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if let Err(error) = result {
        tracing::debug!(
            error = %error,
            "failed to run xattr while stripping agent seed quarantine"
        );
    }

    paths.clear();
}
