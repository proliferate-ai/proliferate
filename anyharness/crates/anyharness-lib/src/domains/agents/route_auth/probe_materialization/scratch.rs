//! The probe-owned scratch root, and the conservative sweep that reclaims the
//! roots whose owning process died without running any guard.

use std::path::{Path, PathBuf};

use super::super::RouteAuthError;
use super::PROBE_ROOT_DIR;

// ---------------------------------------------------------------------------
// The scratch root: created 0700, owned by the probe thread, gone on drop.
// ---------------------------------------------------------------------------

/// A probe-owned scratch root, removed on `Drop` — every exit path, including an
/// unwind.
///
/// It lives under the runtime home rather than `temp_dir()` on purpose: `/tmp` is
/// world-readable and shared with every user, while the runtime home is already
/// the 0600 custody boundary for `state.json`. It also makes the orphan sweep a
/// bounded single directory instead of prefix-matching shared space.
///
/// **Ownership is load-bearing.** The guard must live on the thread that owns the
/// harness child, so the scratch outlives the child and never the reverse.
/// Dropping it from a cancelling caller would delete `claude-config/` or
/// `codex-home-<rev>/config.toml` out from under a process actively reading them.
pub struct ProbeScratch {
    root: PathBuf,
}

impl ProbeScratch {
    /// `<runtime_home>/agent-auth-probe/<harness>-<pid>-<nanos>`, 0700
    /// before any content is written (so nested `create_dir_all` dirs cannot be
    /// world-traversable regardless of umask).
    ///
    /// pid + nanos make a name collision impossible between two probes of the
    /// same harness, and they are what lets the sweep tell an abandoned root
    /// from a live one.
    pub(super) fn create(runtime_home: &Path, harness_kind: &str) -> Result<Self, RouteAuthError> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root = probe_root(runtime_home).join(format!(
            "{harness_kind}-{}-{nanos}",
            std::process::id()
        ));
        create_private_dir(&root)?;
        let scratch = Self { root };
        create_private_dir(&scratch.workspace_root())?;
        Ok(scratch)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Parent for `probe_agent`'s throwaway spawn workspace, so one guard cleans
    /// everything — including on a cancelled probe, whose own teardown never runs.
    pub fn workspace_root(&self) -> PathBuf {
        self.root.join("workspace")
    }
}

impl Drop for ProbeScratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn probe_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join(PROBE_ROOT_DIR)
}

fn create_private_dir(dir: &Path) -> Result<(), RouteAuthError> {
    std::fs::create_dir_all(dir).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", dir.display()),
    })?;
    set_private_dir_permissions(dir)
}

#[cfg(unix)]
fn set_private_dir_permissions(dir: &Path) -> Result<(), RouteAuthError> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|error| {
        RouteAuthError::Materialize {
            detail: format!("failed to chmod {}: {error}", dir.display()),
        }
    })
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_dir: &Path) -> Result<(), RouteAuthError> {
    Ok(())
}

// ---------------------------------------------------------------------------
// The conservative orphan sweep.
// ---------------------------------------------------------------------------

/// Reclaim scratch roots whose owning process died without running any guard
/// (SIGKILL, power loss). Called once at startup, and only by the runtime that
/// holds the probe-engine lock.
///
/// A root is removed only when **both** hold:
/// (a) its embedded pid is neither ours nor live, and
/// (b) its embedded timestamp is older than `max_probe_age`.
///
/// Both, because either alone mis-deletes: (a) alone loses to pid reuse, (b) alone
/// deletes another runtime's slow probe. Requiring both makes a wrongful delete
/// need pid reuse AND a root older than three probe timeouts. Names we cannot
/// parse fall back to (b) on directory mtime.
///
/// Returns the roots it removed, so the caller can log and tests can assert.
pub fn sweep_probe_scratch(runtime_home: &Path, max_probe_age: std::time::Duration) -> Vec<PathBuf> {
    let root = probe_root(runtime_home);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    let own_pid = std::process::id();
    let now_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let max_age_nanos = max_probe_age.as_nanos();
    let mut removed = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name();
        let parsed = name.to_str().and_then(parse_scratch_name);
        let old_enough = match parsed {
            Some((_, nanos)) => now_nanos.saturating_sub(nanos) > max_age_nanos,
            // Unparseable: fall back to directory mtime.
            None => dir_age_exceeds(&path, max_probe_age),
        };
        if !old_enough {
            continue;
        }
        if let Some((pid, _)) = parsed {
            // Our own roots are never swept regardless of platform: this process's
            // guards own them, and a live probe of ours may be mid-spawn.
            if pid == own_pid {
                continue;
            }
            if let Some(true) = process_is_live(pid) {
                continue;
            }
        }
        if std::fs::remove_dir_all(&path).is_ok() {
            removed.push(path);
        }
    }
    removed
}

/// `<harness>-<pid>-<nanos>` -> (pid, nanos). Harness kinds may themselves
/// contain `-` (and pre-re-cut roots carried a context segment too), so the two
/// numeric fields are taken from the END.
fn parse_scratch_name(name: &str) -> Option<(u32, u128)> {
    let (head, nanos) = name.rsplit_once('-')?;
    let (_, pid) = head.rsplit_once('-')?;
    Some((pid.parse().ok()?, nanos.parse().ok()?))
}

fn dir_age_exceeds(path: &Path, max_age: std::time::Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.elapsed().ok())
        .map(|age| age > max_age)
        // Unknown age: leave it alone. A stray directory costs bytes; deleting a
        // live probe's config mid-spawn costs a correct observation.
        .unwrap_or(false)
}

/// Is `pid` a live process? `Some(true)` live, `Some(false)` dead, `None` when this
/// platform cannot tell.
///
/// `ESRCH` means dead; `EPERM` means alive but owned by another user, which a second
/// runtime's probe legitimately is. There is no pid-liveness helper anywhere in the
/// workspace today, so this is the narrowest possible one.
#[cfg(unix)]
fn process_is_live(pid: u32) -> Option<bool> {
    // SAFETY: signal 0 performs error checking only — it delivers no signal and
    // cannot affect the target process.
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if result == 0 {
        return Some(true);
    }
    Some(std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH))
}

/// `None`: this platform has no liveness check wired, so the AGE gate alone governs.
///
/// The earlier shape returned "live" unconditionally, which read as conservative but
/// was in fact a leak: a parseable root could then never be swept at all, no matter
/// how old. Falling back to age-only keeps reclamation alive; the age bound (three
/// probe timeouts) is what makes it safe without the pid signal, and our own roots
/// are already excluded above.
#[cfg(not(unix))]
fn process_is_live(_pid: u32) -> Option<bool> {
    None
}
