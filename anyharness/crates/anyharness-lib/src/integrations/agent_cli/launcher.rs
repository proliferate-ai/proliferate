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
}
