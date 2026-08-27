use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::executable::make_executable;

#[derive(Debug, thiserror::Error)]
pub enum LauncherError {
    #[error("launcher path setup failed: {0}")]
    PathJoin(#[from] std::env::JoinPathsError),
    #[error("launcher io error: {0}")]
    Io(#[from] std::io::Error),
    /// The windows batch emitter refuses to embed a literal `"` in a value: a
    /// batch `set "K=V"`/quoted-argument value has no escape for an embedded
    /// quote the way POSIX shells have `'\''`, so silently writing one would
    /// produce a script that tokenizes differently than intended. Fail closed
    /// instead of shipping a launcher nobody can reason about.
    #[error("value is not representable in a windows batch launcher (contains '\"'): {0:?}")]
    UnsupportedBatchValue(String),
}

/// The managed launcher's file name for `kind`. Unix identifies an executable
/// by its permission bits, so a `#!/bin/sh` script needs no suffix. Windows
/// has no exec bit — executability comes entirely from the extension — so the
/// windows arm gets `.cmd`. This is the ONE place that decides the name; every
/// site that constructs or resolves a managed launcher path calls through
/// here so the write side and the read side can never drift apart.
pub(crate) fn managed_launcher_file_name(kind_str: &str) -> String {
    #[cfg(windows)]
    {
        windows_launcher_file_name(kind_str)
    }
    #[cfg(not(windows))]
    {
        unix_launcher_file_name(kind_str)
    }
}

#[cfg(any(windows, test))]
fn windows_launcher_file_name(kind_str: &str) -> String {
    format!("{kind_str}-launcher.cmd")
}

#[cfg(any(not(windows), test))]
fn unix_launcher_file_name(kind_str: &str) -> String {
    format!("{kind_str}-launcher")
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
    let script = build_launcher_script(exec_path, extra_args, env, path_prefixes)?;
    std::fs::write(launcher_path, script)?;
    make_executable(launcher_path)?;
    Ok(())
}

fn build_launcher_script(
    exec_path: &Path,
    extra_args: &[String],
    env: &HashMap<String, String>,
    path_prefixes: &[PathBuf],
) -> Result<String, LauncherError> {
    #[cfg(windows)]
    {
        build_batch_launcher_script(exec_path, extra_args, env, path_prefixes)
    }
    #[cfg(not(windows))]
    {
        build_unix_launcher_script(exec_path, extra_args, env, path_prefixes)
    }
}

#[cfg(any(not(windows), test))]
fn build_unix_launcher_script(
    exec_path: &Path,
    extra_args: &[String],
    env: &HashMap<String, String>,
    path_prefixes: &[PathBuf],
) -> Result<String, LauncherError> {
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

    Ok(script)
}

#[cfg(any(not(windows), test))]
fn shell_escape(s: &str) -> String {
    if s.contains(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == '\\') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

/// Emit a `.cmd` launcher. Reachable on non-windows hosts too (`cfg(test)`) so
/// the string-shape tests below run on the Linux CI job that already exercises
/// this crate; the `#[cfg(windows)]` dispatch in `build_launcher_script` is
/// what actually selects this arm at runtime.
///
/// Semantics preserved from the unix arm, each for a reason:
/// - `set -e` has no batch equivalent; batch just runs the next line
///   regardless of the previous exit code. The script is linear (one `set`
///   per var, one final call), so the only thing that has to survive is the
///   FINAL call's exit code, which is why the script ends with an explicit
///   `exit /b %ERRORLEVEL%` rather than trusting cmd.exe's implicit "last
///   command's code" behavior.
/// - `export PATH='<joined>':"$PATH"` becomes `set "PATH=<joined>;%PATH%"`.
///   `std::env::join_paths` already emits `;`-joined paths on windows.
/// - `export K='v'` becomes `set "K=v"`.
/// - `exec "<path>" args "$@"` becomes `"<path>" args %*` — batch has no
///   `exec`, so this SPAWNS a child rather than replacing the current
///   process image. The launcher's own `cmd.exe` stays alive as the child's
///   parent, one process-tree level deeper than the unix shebang-exec path.
/// - `@echo off` is new (no unix analogue): without it cmd.exe echoes every
///   line of the script to stdout before running it, which would corrupt the
///   ACP stdio stream the spawned agent is piped over.
#[cfg(any(windows, test))]
fn build_batch_launcher_script(
    exec_path: &Path,
    extra_args: &[String],
    env: &HashMap<String, String>,
    path_prefixes: &[PathBuf],
) -> Result<String, LauncherError> {
    let mut script = String::from("@echo off\r\n");

    if !path_prefixes.is_empty() {
        let joined = std::env::join_paths(path_prefixes)?;
        let joined = batch_escape(&joined.to_string_lossy())?;
        script.push_str(&format!("set \"PATH={joined};%PATH%\"\r\n"));
    }

    for (key, value) in env {
        script.push_str(&format!("set \"{key}={}\"\r\n", batch_escape(value)?));
    }

    let exec_str = batch_escape(&exec_path.display().to_string())?;
    script.push_str(&format!("\"{exec_str}\""));
    for arg in extra_args {
        script.push(' ');
        script.push_str(&batch_escape_arg(arg)?);
    }
    script.push_str(" %*\r\n");
    script.push_str("exit /b %ERRORLEVEL%\r\n");

    Ok(script)
}

/// Escape a value for use inside a batch double-quoted context
/// (`set "K=<here>"`, `"<here>"`). Two characters are load-bearing in a `.cmd`
/// file:
/// - `%` triggers variable expansion even inside quotes; a literal percent
///   requires doubling (`%%`) — the standard, documented batch-file escape.
/// - `"` cannot be embedded in a quoted value at all: cmd.exe has no
///   backslash-style quote escape, so a literal `"` would prematurely close
///   the quoted region and change how the rest of the line tokenizes. Refuse
///   rather than emit a script that means something other than what was
///   asked for.
///
/// `!` is deliberately NOT escaped: it is only special under
/// `setlocal enabledelayedexpansion`, which this script never enables.
#[cfg(any(windows, test))]
fn batch_escape(s: &str) -> Result<String, LauncherError> {
    if s.contains('"') {
        return Err(LauncherError::UnsupportedBatchValue(s.to_string()));
    }
    Ok(s.replace('%', "%%"))
}

/// Like `batch_escape`, but for a positional argument: ALWAYS wraps the
/// token in quotes, unconditionally, rather than only when it contains
/// whitespace. `shell_escape`'s whitespace-only heuristic is right for a
/// POSIX shell, where an unquoted `&`, `|`, `<`, `>`, `^`, `(` or `)` is
/// still just a plain character once nothing forces word-splitting. cmd.exe
/// is different: those characters are metacharacters (pipe, redirection,
/// escape, subshell grouping) whether or not the token has whitespace in
/// it, so an unquoted single-word argument can still be reinterpreted by
/// cmd.exe. No catalog-declared arg exercises this today (`[]`, `["acp"]`,
/// `["agent", "stdio"]`), but the catalog is remotely syncable, so that is a
/// property of current data, not of this code — always quoting removes the
/// hazard rather than special-casing the metacharacter set.
#[cfg(any(windows, test))]
fn batch_escape_arg(s: &str) -> Result<String, LauncherError> {
    let escaped = batch_escape(s)?;
    Ok(format!("\"{escaped}\""))
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
        assert_ne!(
            old_ino, new_ino,
            "promotion must swap the inode, not overwrite"
        );
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

    // --- Windows batch launcher: pure string-shape tests. These call the
    // `cfg(any(windows, test))` builders directly (never through
    // `build_launcher_script`'s runtime dispatch), so they run on ANY host,
    // including the Linux CI job, with no FFI and no execution of the
    // generated script.

    #[test]
    fn windows_launcher_file_name_gets_cmd_extension() {
        assert_eq!(windows_launcher_file_name("claude"), "claude-launcher.cmd");
        assert_eq!(unix_launcher_file_name("claude"), "claude-launcher");
    }

    #[test]
    fn batch_script_starts_with_echo_off_and_ends_with_errorlevel_propagation() {
        let env = HashMap::new();
        let script =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &[], &env, &[])
                .expect("build batch script");
        assert!(
            script.starts_with("@echo off\r\n"),
            "must suppress command echo before anything runs (stdout carries ACP protocol): {script:?}"
        );
        assert!(
            script.trim_end().ends_with("exit /b %ERRORLEVEL%"),
            "final command's exit code must propagate explicitly: {script:?}"
        );
        assert!(
            script.contains("\"C:\\agents\\claude.exe\" %*\r\n"),
            "batch has no exec: it spawns the child and forwards all args via %*: {script:?}"
        );
    }

    #[test]
    fn batch_script_prepends_path_prefixes_ahead_of_percent_path() {
        // Uses plain relative components (no `:` or `;`) so the test exercises
        // the SAME `std::env::join_paths` call the production code makes,
        // rather than hardcoding a separator: on a real Windows host that
        // call joins with `;`, but a `C:\...`-style path run through the
        // HOST's (unix, in CI) `join_paths` would spuriously error on the
        // drive-letter colon. The oracle is join_paths itself; what THIS test
        // asserts is only that the batch emitter wraps its result correctly.
        let env = HashMap::new();
        let prefixes = vec![PathBuf::from("agents-a"), PathBuf::from("agents-b")];
        let joined = std::env::join_paths(&prefixes)
            .expect("join paths")
            .to_string_lossy()
            .into_owned();
        let script = build_batch_launcher_script(Path::new("claude.exe"), &[], &env, &prefixes)
            .expect("build batch script");
        let expected = format!("set \"PATH={joined};%PATH%\"\r\n");
        assert!(
            script.contains(&expected),
            "PATH prefix must prepend ahead of the existing %PATH%: {script:?}"
        );
    }

    #[test]
    fn batch_script_emits_set_for_each_env_var() {
        let mut env = HashMap::new();
        env.insert("DISABLE_AUTOUPDATER".to_string(), "1".to_string());
        let script =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &[], &env, &[])
                .expect("build batch script");
        assert!(
            script.contains("set \"DISABLE_AUTOUPDATER=1\"\r\n"),
            "env var must become a batch `set`: {script:?}"
        );
    }

    #[test]
    fn batch_script_always_quotes_args_even_without_whitespace() {
        let env = HashMap::new();
        let args = vec!["--acp".to_string(), "two words".to_string()];
        let script =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &args, &env, &[])
                .expect("build batch script");
        assert!(
            script.contains("\"C:\\agents\\claude.exe\" \"--acp\" \"two words\" %*\r\n"),
            "every arg is quoted unconditionally, not only ones with whitespace \
             (cmd.exe metacharacters like & | < > ^ ( ) are hazardous unquoted \
             even in a single-word token): {script:?}"
        );
    }

    #[test]
    fn batch_escape_doubles_percent_for_literal_expansion_safety() {
        assert_eq!(batch_escape("100%").unwrap(), "100%%");
        assert_eq!(batch_escape("no-percent").unwrap(), "no-percent");
    }

    #[test]
    fn batch_escape_rejects_embedded_double_quote() {
        let error = batch_escape(r#"has"quote"#).unwrap_err();
        assert!(matches!(error, LauncherError::UnsupportedBatchValue(_)));
    }

    #[test]
    fn batch_escape_arg_always_quotes_even_a_single_word_token() {
        // A mutation that keeps the whitespace-quoting branch but drops the
        // unconditional-quote requirement (i.e. reintroduces the
        // whitespace-only heuristic) must fail this assertion.
        assert_eq!(batch_escape_arg("--acp").unwrap(), "\"--acp\"");
        assert_eq!(batch_escape_arg("two words").unwrap(), "\"two words\"");
        // cmd.exe metacharacters in a single, whitespace-free token: only
        // safe unquoted-vs-quoted distinction that matters is "always".
        assert_eq!(batch_escape_arg("a&b").unwrap(), "\"a&b\"");
        assert_eq!(batch_escape_arg("a|b").unwrap(), "\"a|b\"");
        assert_eq!(batch_escape_arg("(a)").unwrap(), "\"(a)\"");
    }

    #[test]
    fn batch_escape_arg_still_doubles_percent_and_rejects_quote() {
        // Coverage hole closed: a mutation that keeps whitespace-quoting but
        // drops the `%`/`"` handling in `batch_escape_arg` stayed green
        // before this test existed, because every prior assertion on `%`/`"`
        // went through an ENV value, never through the argument path.
        assert_eq!(batch_escape_arg("100%").unwrap(), "\"100%%\"");
        let error = batch_escape_arg(r#"has"quote"#).unwrap_err();
        assert!(matches!(error, LauncherError::UnsupportedBatchValue(_)));
    }

    #[test]
    fn batch_script_drives_percent_and_quote_through_the_argument_path() {
        // Same coverage hole, exercised end-to-end through
        // `build_batch_launcher_script`'s `extra_args`, not just the
        // `batch_escape_arg` unit above.
        let env = HashMap::new();
        let args = vec!["--load=50%".to_string()];
        let script =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &args, &env, &[])
                .expect("build batch script");
        assert!(
            script.contains("\"--load=50%%\""),
            "a literal percent in an ARG must be doubled: {script:?}"
        );

        let bad_args = vec!["has\"quote".to_string()];
        let error =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &bad_args, &env, &[])
                .unwrap_err();
        assert!(matches!(error, LauncherError::UnsupportedBatchValue(_)));
    }

    #[test]
    fn batch_script_propagates_percent_and_quote_handling_end_to_end() {
        let mut env = HashMap::new();
        env.insert("LOAD".to_string(), "50%".to_string());
        let script =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &[], &env, &[])
                .expect("build batch script");
        assert!(
            script.contains("set \"LOAD=50%%\"\r\n"),
            "a literal percent in an env value must be doubled in the emitted file: {script:?}"
        );

        let mut bad_env = HashMap::new();
        bad_env.insert("BAD".to_string(), "has\"quote".to_string());
        let error =
            build_batch_launcher_script(Path::new(r"C:\agents\claude.exe"), &[], &bad_env, &[])
                .unwrap_err();
        assert!(matches!(error, LauncherError::UnsupportedBatchValue(_)));
    }
}
