//! Platform-conditional npm program and shim-path resolution.
//!
//! Extracted from `npm.rs` so the Windows resolution rules live in one small
//! file with their own tests, and so `npm.rs` stays under the PROD-SIZE-1
//! line allowance rather than acquiring new measured debt.

use std::path::{Path, PathBuf};

/// npm itself is a JS program, not a native binary: node's Windows installer
/// ships `npm.cmd` (and `npm.ps1`), never `npm.exe`. `Command::new("npm")`'s
/// own Windows module search only appends a default `.exe` to an
/// extension-less program name (that's `CreateProcess`'s behavior when
/// `lpApplicationName` is unset, not something Rust adds), so it would look
/// for `npm.exe`, find nothing, and fail before ever reaching npm. Naming
/// the program `npm.cmd` explicitly makes `std::process::Command` take its
/// documented `.cmd`/`.bat` branch and spawn it via `cmd.exe /c` itself —
/// the same mechanism this crate now relies on for the generated launcher
/// (see `integrations::agent_cli::launcher::managed_launcher_file_name`) —
/// so PATH resolution for `npm.cmd` happens inside cmd.exe, which does find
/// it.
#[cfg(any(windows, test))]
fn npm_program_name_windows() -> &'static str {
    "npm.cmd"
}

#[cfg(any(not(windows), test))]
fn npm_program_name_unix() -> &'static str {
    "npm"
}

pub(super) fn npm_program_name() -> &'static str {
    #[cfg(windows)]
    {
        npm_program_name_windows()
    }
    #[cfg(not(windows))]
    {
        npm_program_name_unix()
    }
}

/// Resolve the executable a managed npm/git install should actually exec.
/// `executable_relpath` (e.g. `node_modules/.bin/claude-agent-acp`) names
/// npm's UNIX shim, which has no windows equivalent — npm's `cmd-shim`
/// ALSO writes a `<name>.cmd` (and `<name>.ps1`) sibling into the same
/// `.bin` directory, and `<name>.cmd` is the one Windows can actually run.
/// Execing the bare, extension-less name and hoping PATHEXT / `CreateProcess`
/// falls back to a sibling is not guaranteed at the `CreateProcess` layer the
/// way it's easy to assume; naming the real `.cmd` sibling explicitly here
/// is the same choice `platform_binary_filename` above already makes for a
/// source-built binary, applied to the npm-shim case.
#[cfg(any(windows, test))]
fn platform_npm_bin_relpath_windows(executable_relpath: &Path) -> PathBuf {
    let mut with_ext = executable_relpath.as_os_str().to_os_string();
    with_ext.push(".cmd");
    PathBuf::from(with_ext)
}

#[cfg(any(not(windows), test))]
fn platform_npm_bin_relpath_unix(executable_relpath: &Path) -> PathBuf {
    executable_relpath.to_path_buf()
}

pub(super) fn platform_npm_bin_relpath(executable_relpath: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        platform_npm_bin_relpath_windows(executable_relpath)
    }
    #[cfg(not(windows))]
    {
        platform_npm_bin_relpath_unix(executable_relpath)
    }
}

#[cfg(test)]
mod windows_npm_resolution_tests {
    use super::*;

    // These call the `_windows`/`_unix` split functions directly (not the
    // `cfg!(windows)`-dispatching wrappers), so both branches are exercised
    // on every host regardless of which platform actually built the test
    // binary — the same pure-string-shape pattern used in
    // `integrations::agent_cli::launcher`'s batch-script tests.

    #[test]
    fn npm_program_name_is_dot_cmd_on_windows() {
        // `Command::new`'s Windows module search appends only a default
        // `.exe` to an extension-less program name; naming it `npm.cmd`
        // explicitly is what makes std take its documented `.cmd`/`.bat`
        // branch and spawn via `cmd.exe /c` itself, the same mechanism the
        // generated launcher relies on.
        assert_eq!(npm_program_name_windows(), "npm.cmd");
    }

    #[test]
    fn npm_program_name_stays_bare_on_unix() {
        assert_eq!(npm_program_name_unix(), "npm");
    }

    #[test]
    fn platform_npm_bin_relpath_appends_cmd_extension_on_windows() {
        let shim = Path::new("node_modules/.bin/claude-agent-acp");
        assert_eq!(
            platform_npm_bin_relpath_windows(shim),
            PathBuf::from("node_modules/.bin/claude-agent-acp.cmd")
        );
    }

    #[test]
    fn platform_npm_bin_relpath_leaves_unix_shim_unchanged() {
        let shim = Path::new("node_modules/.bin/claude-agent-acp");
        assert_eq!(platform_npm_bin_relpath_unix(shim), shim.to_path_buf());
    }
}
