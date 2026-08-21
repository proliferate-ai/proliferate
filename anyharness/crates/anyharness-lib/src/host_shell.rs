//! The one place that answers "which shell does this host use, and how is it
//! handed a command string?".
//!
//! Everything that used to hardcode `/bin/sh` asks here instead. The unix
//! answers are exactly the literals the call sites used before, so unix
//! behaviour is unchanged; the windows answers are the equivalents that
//! actually exist there. Written as `cfg(unix)` / `cfg(not(unix))` function
//! pairs to match how the rest of this crate handles platform differences
//! (see `process_kill`, `integrations::agent_cli::executable::make_executable`).

use std::ffi::OsString;

/// Program plus the single flag that makes it read the *next* argument as a
/// whole command string to interpret.
///
/// Used for command strings that are genuinely user-supplied and genuinely
/// want shell semantics (pipes, globs, `&&`, environment expansion). A fixed
/// program with fixed arguments should be spawned directly instead of going
/// through here.
#[derive(Debug, Clone)]
pub struct CommandStringShell {
    pub program: OsString,
    pub command_flag: &'static str,
}

/// Unix: `/bin/sh -lc <command>`, byte-for-byte what the setup-command runner
/// spawned before this module existed.
#[cfg(unix)]
pub fn command_string_shell() -> CommandStringShell {
    CommandStringShell {
        program: OsString::from("/bin/sh"),
        command_flag: "-lc",
    }
}

/// Windows: the interpreter named by `ComSpec` (`cmd.exe` when unset) with
/// `/C`, which is the closest equivalent of `sh -c` that is guaranteed to be
/// present. There is no login-shell notion, so `-lc` collapses to `/C`.
#[cfg(not(unix))]
pub fn command_string_shell() -> CommandStringShell {
    CommandStringShell {
        program: std::env::var_os("ComSpec").unwrap_or_else(|| OsString::from("cmd.exe")),
        command_flag: "/C",
    }
}

/// Absolute interpreter paths probed, in order, when a managed run needs a
/// shell and the caller did not name one. Unix keeps the original list and
/// order; windows has no such fixed paths, so the probe is empty and the
/// caller falls through to [`last_resort_shell`].
#[cfg(unix)]
pub fn well_known_shell_paths() -> &'static [&'static str] {
    &[
        "/bin/bash",
        "/usr/bin/bash",
        "/bin/zsh",
        "/usr/bin/zsh",
        "/bin/sh",
        "/usr/bin/sh",
    ]
}

#[cfg(not(unix))]
pub fn well_known_shell_paths() -> &'static [&'static str] {
    &[]
}

/// Interpreter paths tried after `$SHELL` when detecting the host's default
/// interactive shell. Unix keeps the original list and order.
#[cfg(unix)]
pub fn default_shell_fallbacks() -> &'static [&'static str] {
    &["/bin/bash", "/usr/bin/bash", "/bin/sh", "/usr/bin/sh"]
}

#[cfg(not(unix))]
pub fn default_shell_fallbacks() -> &'static [&'static str] {
    &[]
}

/// What to spawn when nothing else resolved. Unix returns `/bin/sh`, the same
/// literal the terminal driver returned before. Windows returns `ComSpec`,
/// which is the only shell guaranteed to exist there.
#[cfg(unix)]
pub fn last_resort_shell() -> String {
    "/bin/sh".to_string()
}

#[cfg(not(unix))]
pub fn last_resort_shell() -> String {
    std::env::var_os("ComSpec")
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "cmd.exe".to_string())
}

/// Home directory of the current user, honouring `USERPROFILE` on windows
/// where `HOME` is usually absent.
///
/// `HOME` is consulted first and returned verbatim, so every unix host that
/// sets it resolves exactly as before, empty value included. `USERPROFILE` is
/// only reached when `HOME` is absent entirely, which is the case this exists
/// to fix.
pub fn home_dir_from_env() -> Option<std::path::PathBuf> {
    if let Some(home) = std::env::var_os("HOME") {
        return Some(std::path::PathBuf::from(home));
    }
    std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)
}
