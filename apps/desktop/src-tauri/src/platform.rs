use std::{
    env,
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};

const SHELL_PATH_MARKER: &str = "__PROLIFERATE_PATH__";
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);

static SHELL_PATH_CACHE: OnceLock<Option<String>> = OnceLock::new();

pub(crate) fn open_url(url: &str) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|error| format!("Failed to open URL: {error}"))
}

pub(crate) fn reveal_path(path: impl AsRef<Path>) -> Result<(), String> {
    tauri_plugin_opener::reveal_item_in_dir(path.as_ref())
        .map_err(|error| format!("Failed to reveal path: {error}"))
}

pub(crate) fn open_terminal_at(path: impl AsRef<Path>) -> Result<(), String> {
    let working_dir = terminal_working_dir(path.as_ref());

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Failed to open Terminal: {error}"))
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = linux_terminal_commands(&working_dir);
        let mut tried = Vec::with_capacity(candidates.len());

        for candidate in candidates {
            tried.push(candidate.program);
            let Some(program) = resolve_executable(candidate.program) else {
                continue;
            };

            let mut command = Command::new(program);
            command
                .args(candidate.args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            if working_dir.is_dir() {
                command.current_dir(&working_dir);
            }

            return command.spawn().map(|_| ()).map_err(|error| {
                format!(
                    "Failed to open terminal {} at {}: {error}",
                    candidate.program,
                    working_dir.display()
                )
            });
        }

        Err(format!(
            "No supported Linux terminal command found. Tried: {}",
            tried.join(", ")
        ))
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = working_dir;
        Err("open_terminal_at is not supported on this platform.".to_string())
    }
}

pub(crate) fn resolve_shell_path() -> Option<String> {
    SHELL_PATH_CACHE
        .get_or_init(resolve_shell_path_uncached)
        .clone()
}

pub(crate) fn resolve_executable(program: &str) -> Option<PathBuf> {
    let direct_path = PathBuf::from(program);
    if direct_path.components().count() > 1 && is_usable_executable(&direct_path) {
        return Some(direct_path);
    }

    if let Ok(path) = which::which(program) {
        return Some(path);
    }

    let shell_path = resolve_shell_path()?;
    find_executable_in_path(program, &OsString::from(shell_path))
}

fn terminal_working_dir(path: &Path) -> PathBuf {
    if path.is_dir() {
        return path.to_path_buf();
    }

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        return parent.to_path_buf();
    }

    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TerminalCommand {
    program: &'static str,
    args: Vec<OsString>,
}

#[cfg(target_os = "linux")]
fn linux_terminal_commands(working_dir: &Path) -> Vec<TerminalCommand> {
    linux_terminal_commands_for_dir(working_dir)
}

fn linux_terminal_commands_for_dir(working_dir: &Path) -> Vec<TerminalCommand> {
    let dir = working_dir.as_os_str().to_os_string();
    vec![
        TerminalCommand {
            program: "gnome-terminal",
            args: vec![OsString::from("--working-directory"), dir.clone()],
        },
        TerminalCommand {
            program: "konsole",
            args: vec![OsString::from("--workdir"), dir.clone()],
        },
        TerminalCommand {
            program: "xfce4-terminal",
            args: vec![OsString::from("--working-directory"), dir.clone()],
        },
        TerminalCommand {
            program: "kitty",
            args: vec![OsString::from("--directory"), dir.clone()],
        },
        TerminalCommand {
            program: "wezterm",
            args: vec![
                OsString::from("start"),
                OsString::from("--cwd"),
                dir.clone(),
            ],
        },
        TerminalCommand {
            program: "alacritty",
            args: vec![OsString::from("--working-directory"), dir.clone()],
        },
        TerminalCommand {
            program: "xterm",
            args: vec![
                OsString::from("-e"),
                OsString::from("sh"),
                OsString::from("-lc"),
                OsString::from("cd \"$1\" && exec \"${SHELL:-/bin/sh}\""),
                OsString::from("sh"),
                dir,
            ],
        },
    ]
}

fn resolve_shell_path_uncached() -> Option<String> {
    for shell in shell_candidates() {
        if let Some(path) = resolve_shell_path_from_shell(&shell) {
            return Some(path);
        }
    }
    None
}

fn shell_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(shell) = env::var_os("SHELL")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        candidates.push(shell);
    }

    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/bin/zsh"),
        PathBuf::from("/bin/bash"),
        PathBuf::from("/bin/sh"),
    ]);

    #[cfg(target_os = "linux")]
    candidates.extend([PathBuf::from("/bin/bash"), PathBuf::from("/bin/sh")]);

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    candidates.extend([PathBuf::from("/bin/sh")]);

    dedupe_paths(candidates)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for path in paths {
        if !out.iter().any(|existing: &PathBuf| existing == &path) {
            out.push(path);
        }
    }
    out
}

fn resolve_shell_path_from_shell(shell: &Path) -> Option<String> {
    let path_script = format!("printf '{SHELL_PATH_MARKER}%s\\n' \"$PATH\"");
    let shell_args = shell_path_args(shell, &path_script);
    let mut child = Command::new(shell)
        .args(shell_args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let start = Instant::now();
    loop {
        if child.try_wait().ok()?.is_some() {
            break;
        }
        if start.elapsed() >= SHELL_PATH_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(20));
    }

    let mut output = String::new();
    let mut stdout = child.stdout.take()?;
    stdout.read_to_string(&mut output).ok()?;
    parse_shell_path_output(&output)
}

fn shell_path_args<'a>(shell: &Path, script: &'a str) -> Vec<&'a str> {
    if shell.file_name().and_then(|name| name.to_str()) == Some("sh") {
        vec!["-c", script]
    } else {
        vec!["-l", "-i", "-c", script]
    }
}

fn parse_shell_path_output(output: &str) -> Option<String> {
    output.lines().rev().find_map(|line| {
        line.find(SHELL_PATH_MARKER)
            .map(|index| line[index + SHELL_PATH_MARKER.len()..].trim().to_string())
            .filter(|path| !path.is_empty())
    })
}

fn find_executable_in_path(program: &str, path_value: &OsString) -> Option<PathBuf> {
    env::split_paths(path_value).find_map(|dir| {
        let candidate = dir.join(program);
        if is_usable_executable(&candidate) {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            let candidate = dir.join(format!("{program}.exe"));
            if is_usable_executable(&candidate) {
                return Some(candidate);
            }
        }

        None
    })
}

fn is_usable_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args_as_strings(command: &TerminalCommand) -> Vec<String> {
        command
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn shell_path_output_uses_marker_line() {
        let output = "noise\n__PROLIFERATE_PATH__/usr/local/bin:/usr/bin\n";

        assert_eq!(
            parse_shell_path_output(output),
            Some("/usr/local/bin:/usr/bin".to_string())
        );
    }

    #[test]
    fn shell_path_output_ignores_unmarked_output() {
        assert_eq!(parse_shell_path_output("/usr/bin\n"), None);
    }

    #[test]
    fn shell_path_args_use_plain_command_for_sh_fallback() {
        assert_eq!(
            shell_path_args(Path::new("/bin/sh"), "echo ok"),
            vec!["-c", "echo ok"]
        );
        assert_eq!(
            shell_path_args(Path::new("/bin/bash"), "echo ok"),
            vec!["-l", "-i", "-c", "echo ok"]
        );
    }

    #[test]
    fn linux_terminal_commands_are_ordered_by_common_desktop_defaults() {
        let commands = linux_terminal_commands_for_dir(Path::new("/tmp/project"));
        let programs: Vec<&str> = commands.iter().map(|command| command.program).collect();

        assert_eq!(
            programs,
            vec![
                "gnome-terminal",
                "konsole",
                "xfce4-terminal",
                "kitty",
                "wezterm",
                "alacritty",
                "xterm",
            ]
        );
        assert_eq!(
            args_as_strings(&commands[0]),
            vec!["--working-directory", "/tmp/project"]
        );
        assert_eq!(
            args_as_strings(commands.last().expect("xterm command")),
            vec![
                "-e",
                "sh",
                "-lc",
                "cd \"$1\" && exec \"${SHELL:-/bin/sh}\"",
                "sh",
                "/tmp/project",
            ]
        );
    }

    #[test]
    fn terminal_working_dir_uses_parent_for_file_paths() {
        assert_eq!(
            terminal_working_dir(Path::new("/tmp/project/src/main.rs")),
            PathBuf::from("/tmp/project/src")
        );
    }
}
