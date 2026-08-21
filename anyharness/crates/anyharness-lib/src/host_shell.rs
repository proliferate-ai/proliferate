//! The one place that decides how a user-authored command string reaches a
//! shell.
//!
//! Scope is deliberately narrow: this covers the *piped* command runner in
//! `live::terminals::command_runs::setup_process`, which hands a command
//! string to a shell, captures stdout/stderr and waits for exit under a
//! deadline. It does NOT cover the PTY command-run path, and must not be
//! wired into it. That path writes a POSIX sentinel wrapper into the terminal
//! (`. <script>; anyharness_code=$?; printf ...` in
//! `command_runs::pty::build_pty_command_wrapper`) and waits for the sentinel
//! to come back, so an interpreter that cannot speak POSIX would leave a run
//! that never completes. That path already refuses such shells up front:
//! `command_runs::pty::run_terminal_command` bails with
//! `unsupported_terminal_shell` whenever `ShellKind::is_posix()` is false, and
//! `detect_shell_kind` classifies anything that is not bash/zsh/sh as
//! `ShellKind::Other`. Terminal shell detection is therefore left resolving
//! POSIX paths only, so the failure stays at PTY spawn rather than becoming a
//! terminal that opens and then rejects every command.
//!
//! Written as a `cfg(unix)` / `cfg(not(unix))` function pair to match how the
//! rest of this crate handles platform differences (see `process_kill`,
//! `integrations::agent_cli::executable::make_executable`,
//! `integrations::mcp::capability_token::write_secret_file`).

/// A `tokio` command that will run `command` through the host's shell.
///
/// The caller still owns cwd, stdio, environment and process-group setup; this
/// only fixes the interpreter, the flag, and how the command string is quoted.
///
/// Unix: `/bin/sh -lc <command>`, byte-for-byte the invocation the setup
/// runner built before this module existed.
#[cfg(unix)]
pub fn command_string_shell(command: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("/bin/sh");
    cmd.arg("-lc").arg(command);
    cmd
}

/// Windows: the interpreter named by `ComSpec` (`cmd.exe` when unset) with
/// `/C`, the closest guaranteed-present equivalent of `sh -c`. There is no
/// login-shell notion, so `-lc` collapses to `/C`.
///
/// The command string goes through `raw_arg`, not `arg`. `arg` applies the
/// MSVCRT quoting rules on windows, which wrap anything containing a space in
/// quotes; `cmd.exe` does not parse its argument that way, so a perfectly
/// ordinary `npm run build --if-present` would arrive mangled. `raw_arg`
/// passes the string through untouched, which is what `/C` expects.
#[cfg(not(unix))]
pub fn command_string_shell(command: &str) -> tokio::process::Command {
    let program =
        std::env::var_os("ComSpec").unwrap_or_else(|| std::ffi::OsString::from("cmd.exe"));
    let mut cmd = tokio::process::Command::new(program);
    cmd.arg("/C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.as_std_mut().raw_arg(command);
    }
    #[cfg(not(windows))]
    cmd.arg(command);
    cmd
}

#[cfg(all(test, unix))]
mod tests {
    use std::ffi::OsStr;

    /// Negative control for the "unix behaviour is unchanged" claim: these are
    /// the exact program and flag the setup runner hardcoded before this
    /// module existed. Changing either should fail here.
    #[test]
    fn unix_invocation_is_exactly_bin_sh_dash_lc() {
        let command = super::command_string_shell("printf ok");
        let std_command = command.as_std();

        assert_eq!(std_command.get_program(), OsStr::new("/bin/sh"));
        assert_eq!(
            std_command.get_args().collect::<Vec<_>>(),
            vec![OsStr::new("-lc"), OsStr::new("printf ok")]
        );
    }

    #[tokio::test]
    async fn the_command_string_is_interpreted_by_a_shell_and_its_status_is_returned() {
        let status = super::command_string_shell("exit 7")
            .status()
            .await
            .expect("spawn the host shell");

        assert_eq!(status.code(), Some(7));
    }

    #[tokio::test]
    async fn shell_syntax_in_the_command_string_is_honoured() {
        // Proves a shell really is interpreting the string rather than the
        // string being spawned as a program name with arguments.
        let status = super::command_string_shell("false || true")
            .status()
            .await
            .expect("spawn the host shell");

        assert!(status.success());
    }
}
