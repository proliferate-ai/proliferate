//! The worker's process-supervision scripts are POSIX shell by construction:
//! they use `pgrep`, `nohup`, `$$` and `$PPID`, none of which `cmd.exe` has.
//! Rather than sprinkle `cfg` at every call site, every such script goes
//! through here, so the platform question is answered once.
//!
//! On unix each helper builds exactly the `Command` the call site built
//! before, so behaviour is unchanged. On any other platform the spawn is
//! refused up front with an `Unsupported` error naming the reason, instead of
//! surfacing a bare "program not found" for a missing `sh` that no reader can
//! trace back to shell supervision.

use std::path::Path;
use std::process::ExitStatus;

/// Which interpreter a script needs. `Sh` maps to `sh -c`, `BashLogin` to
/// `bash -lc`; both are the exact invocations the call sites used before.
#[derive(Debug, Clone, Copy)]
pub(crate) enum ScriptShell {
    Sh,
    BashLogin,
}

impl ScriptShell {
    #[cfg(unix)]
    fn program(self) -> &'static str {
        match self {
            Self::Sh => "sh",
            Self::BashLogin => "bash",
        }
    }

    #[cfg(unix)]
    fn flag(self) -> &'static str {
        match self {
            Self::Sh => "-c",
            Self::BashLogin => "-lc",
        }
    }
}

/// Run `script` to completion under `shell`, optionally in `cwd`.
#[cfg(unix)]
pub(crate) fn run_script(
    shell: ScriptShell,
    script: &str,
    cwd: Option<&Path>,
) -> std::io::Result<ExitStatus> {
    let mut command = std::process::Command::new(shell.program());
    command.arg(shell.flag()).arg(script);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    command.status()
}

#[cfg(not(unix))]
pub(crate) fn run_script(
    _shell: ScriptShell,
    _script: &str,
    _cwd: Option<&Path>,
) -> std::io::Result<ExitStatus> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "worker process supervision needs a POSIX shell (pgrep/nohup/$PPID), \
         which this platform does not provide",
    ))
}

#[cfg(all(test, unix))]
mod tests {
    use super::{run_script, ScriptShell};

    /// Negative control for the "unix behaviour is unchanged" claim: these are
    /// the exact programs and flags the three call sites hardcoded before this
    /// module existed (`sh -c` twice, `bash -lc` once).
    #[test]
    fn programs_and_flags_are_the_original_literals() {
        assert_eq!(ScriptShell::Sh.program(), "sh");
        assert_eq!(ScriptShell::Sh.flag(), "-c");
        assert_eq!(ScriptShell::BashLogin.program(), "bash");
        assert_eq!(ScriptShell::BashLogin.flag(), "-lc");
    }

    #[test]
    fn the_scripts_exit_status_is_returned_verbatim() {
        let status = run_script(ScriptShell::Sh, "exit 3", None).expect("spawn sh");

        assert_eq!(status.code(), Some(3));
    }

    #[test]
    fn a_requested_working_directory_is_applied() {
        let dir = std::env::temp_dir().join(format!(
            "worker-posix-shell-cwd-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        std::fs::write(dir.join("marker"), b"").expect("write marker");

        let status = run_script(ScriptShell::Sh, "test -f marker", Some(&dir)).expect("spawn sh");

        assert!(status.success(), "the script ran outside the requested cwd");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn without_a_working_directory_the_script_inherits_the_process_cwd() {
        let expected = std::env::current_dir().expect("process cwd");
        let script = format!(
            "test \"$(pwd -P)\" = \"$(cd '{}' && pwd -P)\"",
            expected.display()
        );

        let status = run_script(ScriptShell::Sh, &script, None).expect("spawn sh");

        assert!(status.success());
    }
}
