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
