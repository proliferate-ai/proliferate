use std::ffi::OsStr;
use std::fs;
use std::path::Path;

use portable_pty::CommandBuilder;

pub(super) fn detect_default_shell() -> String {
    let shell_env = std::env::var("SHELL").ok();
    let path_env = std::env::var_os("PATH");
    detect_default_shell_with_env(shell_env.as_deref(), path_env.as_deref())
}

pub(super) fn configure_compact_prompt(
    cmd: &mut CommandBuilder,
    shell: &str,
    workspace_path: &str,
) {
    cmd.env("ANYHARNESS_WORKSPACE_ROOT", workspace_path);
    cmd.env("PROMPT_DIRTRIM", "1");

    match prompt_shell_kind(shell) {
        PromptShellKind::Bash => {
            if let Some(rcfile) = ensure_bash_prompt_rcfile() {
                cmd.arg("--rcfile");
                cmd.arg(rcfile);
                cmd.arg("-i");
            } else {
                cmd.env("PS1", r"\u@\h:\W\$ ");
            }
        }
        PromptShellKind::Zsh => {
            cmd.env("PROMPT", "%n@%m:workspace%# ");
        }
        PromptShellKind::Sh => {
            cmd.env("PS1", "$ ");
        }
        PromptShellKind::Other => {}
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PromptShellKind {
    Bash,
    Zsh,
    Sh,
    Other,
}

fn prompt_shell_kind(shell: &str) -> PromptShellKind {
    let name = Path::new(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(shell);
    if name.ends_with("bash") {
        PromptShellKind::Bash
    } else if name.ends_with("zsh") {
        PromptShellKind::Zsh
    } else if name == "sh" {
        PromptShellKind::Sh
    } else {
        PromptShellKind::Other
    }
}

fn ensure_bash_prompt_rcfile() -> Option<String> {
    let home = std::env::var_os("HOME")?;
    let rcfile = Path::new(&home)
        .join(".proliferate")
        .join("anyharness")
        .join("terminal")
        .join("bashrc");
    let parent = rcfile.parent()?;
    fs::create_dir_all(parent).ok()?;
    fs::write(&rcfile, bash_prompt_rcfile_contents()).ok()?;
    Some(rcfile.to_string_lossy().to_string())
}

fn bash_prompt_rcfile_contents() -> &'static str {
    concat!(
        "# Managed by AnyHarness. Keeps workspace terminal prompts compact.\n",
        "if [ -f \"$HOME/.bashrc\" ]; then . \"$HOME/.bashrc\"; fi\n",
        "export PROMPT_DIRTRIM=1\n",
        "__anyharness_compact_prompt() {\n",
        "  local root=\"${ANYHARNESS_WORKSPACE_ROOT:-}\"\n",
        "  local label=\"${PWD##*/}\"\n",
        "  if [ -n \"$root\" ]; then\n",
        "    case \"$PWD\" in\n",
        "      \"$root\") label=\"workspace\" ;;\n",
        "      \"$root\"/*) label=\"workspace/${PWD#\"$root\"/}\" ;;\n",
        "    esac\n",
        "  fi\n",
        "  PS1=\"\\u@\\h:${label}\\$ \"\n",
        "}\n",
        "case \"${PROMPT_COMMAND:-}\" in\n",
        "  *__anyharness_compact_prompt*) ;;\n",
        "  '') PROMPT_COMMAND='__anyharness_compact_prompt' ;;\n",
        "  *) PROMPT_COMMAND=\"${PROMPT_COMMAND};__anyharness_compact_prompt\" ;;\n",
        "esac\n",
        "__anyharness_compact_prompt\n",
    )
}

fn detect_default_shell_with_env(shell_env: Option<&str>, path_env: Option<&OsStr>) -> String {
    let mut candidates: Vec<&str> = Vec::new();

    if let Some(shell) = shell_env.filter(|value| !value.trim().is_empty()) {
        candidates.push(shell);
    }

    for fallback in ["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"] {
        if !candidates.contains(&fallback) {
            candidates.push(fallback);
        }
    }

    for candidate in candidates {
        if is_executable_command(candidate, path_env) {
            return candidate.to_string();
        }
    }

    "/bin/sh".to_string()
}

fn is_executable_command(command: &str, path_env: Option<&OsStr>) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return false;
    }

    if command.contains(std::path::MAIN_SEPARATOR) {
        return is_executable_path(Path::new(command));
    }

    if let Some(path_env) = path_env {
        for dir in std::env::split_paths(path_env) {
            if is_executable_path(&dir.join(command)) {
                return true;
            }
        }
    }

    false
}

fn is_executable_path(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn detect_default_shell_avoids_nonexistent_zsh_fallback() {
        let shell = super::detect_default_shell_with_env(None, None);
        assert_ne!(shell, "/bin/zsh");
        assert!(matches!(
            shell.as_str(),
            "/bin/bash" | "/usr/bin/bash" | "/bin/sh" | "/usr/bin/sh"
        ));
    }

    #[test]
    fn detect_default_shell_skips_missing_shell_env() {
        let shell = super::detect_default_shell_with_env(Some("/definitely/missing-shell"), None);
        assert_ne!(shell, "/definitely/missing-shell");
        assert!(matches!(
            shell.as_str(),
            "/bin/bash" | "/usr/bin/bash" | "/bin/sh" | "/usr/bin/sh"
        ));
    }

    #[test]
    fn prompt_shell_kind_detects_common_shells() {
        assert_eq!(
            super::prompt_shell_kind("/bin/bash"),
            super::PromptShellKind::Bash
        );
        assert_eq!(
            super::prompt_shell_kind("/usr/bin/zsh"),
            super::PromptShellKind::Zsh
        );
        assert_eq!(
            super::prompt_shell_kind("/bin/sh"),
            super::PromptShellKind::Sh
        );
        assert_eq!(
            super::prompt_shell_kind("/usr/bin/fish"),
            super::PromptShellKind::Other
        );
    }
}
