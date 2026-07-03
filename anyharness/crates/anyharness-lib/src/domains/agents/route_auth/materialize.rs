//! Switch-time filesystem materialization for gateway routes that need isolated
//! harness state (claude CLAUDE_CONFIG_DIR, codex CODEX_HOME, opencode config,
//! grok HOME).
//!
//! This is the APPLY half of the two-phase render (contract §4): [`render`]
//! produces pure [`FileSpec`]s (which family, which revision, what bytes) and
//! the launcher hands each here to be written. Path computation is shared with
//! the render layer via the pure [`revision_dir_path`] / [`claude_config_dir_path`]
//! helpers, so the env vars render sets and the dirs applied here always agree.
//!
//! [`render`]: super::render
//!
//! Bookkeeping is filesystem-only: the applied revision is carried in the
//! directory name (`codex-home-<rev>`, `grok-home-<rev>`, ...), so no new
//! SQLite table is introduced. Each materialization garbage-collects sibling
//! dirs for *stale* revisions, then writes the current revision's dir
//! idempotently.
//!
//! Cleanup is deliberately conservative: the current revision's dir AND the
//! immediately-previous revision's dir are always kept, so in-flight processes
//! launched under the prior revision keep reading valid isolated state.

use std::fs;
use std::path::{Path, PathBuf};

use super::RouteAuthError;

const ROUTE_AUTH_DIR: &str = "agent-auth";

/// Directory family prefixes; the applied revision is appended (`-<rev>`).
pub(super) const CODEX_HOME_PREFIX: &str = "codex-home";
pub(super) const GROK_HOME_PREFIX: &str = "grok-home";
pub(super) const OPENCODE_CONFIG_PREFIX: &str = "opencode-config";

/// Isolated CLAUDE_CONFIG_DIR family. Claude Code reads `~/.claude` (settings,
/// cached credentials) unless CLAUDE_CONFIG_DIR points elsewhere; an ambient
/// `~/.claude` can otherwise defeat the env sanitization the claude adapter
/// performs. This dir is stable (not revision-keyed) — it holds no
/// revision-specific content; the launch env vars are authoritative each launch.
const CLAUDE_CONFIG_DIR_NAME: &str = "claude-config";

/// Config file names written inside the isolated home dirs.
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";
pub(super) const OPENCODE_CONFIG_FILE_NAME: &str = "opencode.json";

/// Isolated XDG subdir names materialized beside the opencode config; the
/// render layer points XDG_CONFIG_HOME/XDG_DATA_HOME at these.
pub(super) const OPENCODE_XDG_CONFIG_SUBDIR: &str = "xdg-config";
pub(super) const OPENCODE_XDG_DATA_SUBDIR: &str = "xdg-data";

/// Which isolated-state family a [`FileSpec`] materializes. The render layer
/// tags the spec; apply runs the matching recipe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathFamily {
    /// Stable (not revision-keyed) CLAUDE_CONFIG_DIR; no content file.
    ClaudeConfig,
    /// Revision-keyed CODEX_HOME with a `config.toml`.
    CodexHome,
    /// Stable (not revision-keyed) codex-local `CODEX_HOME` with an `auth.json`.
    /// The api_key codex route writes its credential file here (the launch
    /// resolves `CODEX_HOME` to this dir; the bare env var is not honored on the
    /// ACP resume path).
    CodexLocalAuth,
    /// Revision-keyed OpenCode dir with `opencode.json` + XDG subdirs.
    OpencodeConfig,
    /// Revision-keyed grok HOME; no content file.
    GrokHome,
}

/// A file/dir the launcher must materialize after a pure render (contract §4).
/// `contents` is `Some` for families with a config file (codex/opencode) and
/// `None` for dir-only families (claude/grok).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSpec {
    pub path_family: PathFamily,
    pub revision: i64,
    pub contents: Option<Vec<u8>>,
}

fn route_auth_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join(ROUTE_AUTH_DIR)
}

/// Pure: the revision-keyed dir path for a family (no I/O). Shared by the render
/// layer (to set env vars) and apply (to create + write). Must match the path
/// [`prepare_revision_dir`] creates.
pub(super) fn revision_dir_path(runtime_home: &Path, prefix: &str, revision: i64) -> PathBuf {
    route_auth_root(runtime_home).join(format!("{prefix}-{revision}"))
}

/// Pure: the stable CLAUDE_CONFIG_DIR path (no I/O).
pub(super) fn claude_config_dir_path(runtime_home: &Path) -> PathBuf {
    route_auth_root(runtime_home).join(CLAUDE_CONFIG_DIR_NAME)
}

/// The session-layer `CODEX_HOME` directory name a codex launch resolves to
/// (`sessions::runtime::launch_env::prepare_local_codex_home`). The codex
/// api_key route overlays its `auth.json` here rather than repointing
/// `CODEX_HOME`; keep in sync with that module (mirrors the duplicated literal
/// in `agents::portability::codex::codex_artifact_roots`).
const CODEX_LOCAL_HOME_DIR: &str = "codex-local";
/// The credential file codex reads from `CODEX_HOME` on both `session/new` and
/// `session/load`.
const CODEX_AUTH_FILE_NAME: &str = "auth.json";

/// Pure: the stable codex-local `CODEX_HOME` path (no I/O). This is the home a
/// native/api_key codex launch resolves to
/// (`sessions::runtime::launch_env::prepare_local_codex_home`); unlike the
/// gateway route it is NOT revision-keyed.
pub(super) fn codex_local_home_path(runtime_home: &Path) -> PathBuf {
    route_auth_root(runtime_home).join(CODEX_LOCAL_HOME_DIR)
}

/// Apply one [`FileSpec`]: create the isolated dir (revision-keyed families GC
/// stale siblings first) and write its config file 0600 where the family has
/// one. Idempotent per revision.
pub(super) fn apply_file_spec(
    runtime_home: &Path,
    spec: &FileSpec,
) -> Result<(), RouteAuthError> {
    match spec.path_family {
        PathFamily::ClaudeConfig => {
            let dir = claude_config_dir_path(runtime_home);
            create_dir(&dir)?;
        }
        PathFamily::CodexHome => {
            let dir = prepare_revision_dir(runtime_home, CODEX_HOME_PREFIX, spec.revision)?;
            write_private_file(&dir.join(CODEX_CONFIG_FILE_NAME), spec_contents(spec)?)?;
        }
        PathFamily::CodexLocalAuth => {
            let dir = codex_local_home_path(runtime_home);
            create_dir(&dir)?;
            write_private_file(&dir.join(CODEX_AUTH_FILE_NAME), spec_contents(spec)?)?;
        }
        PathFamily::OpencodeConfig => {
            let dir = prepare_revision_dir(runtime_home, OPENCODE_CONFIG_PREFIX, spec.revision)?;
            write_private_file(
                &dir.join(OPENCODE_CONFIG_FILE_NAME),
                spec_contents(spec)?,
            )?;
            for sub in [OPENCODE_XDG_CONFIG_SUBDIR, OPENCODE_XDG_DATA_SUBDIR] {
                create_dir(&dir.join(sub))?;
            }
        }
        PathFamily::GrokHome => {
            prepare_revision_dir(runtime_home, GROK_HOME_PREFIX, spec.revision)?;
        }
    }
    Ok(())
}

fn spec_contents(spec: &FileSpec) -> Result<&[u8], RouteAuthError> {
    spec.contents
        .as_deref()
        .ok_or_else(|| RouteAuthError::Materialize {
            detail: format!(
                "file spec for {:?} is missing its contents",
                spec.path_family
            ),
        })
}

fn create_dir(dir: &Path) -> Result<(), RouteAuthError> {
    fs::create_dir_all(dir).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", dir.display()),
    })
}

/// Create (idempotently) the revision-keyed directory for a family, removing
/// any sibling dirs of the same family carrying a stale revision.
fn prepare_revision_dir(
    runtime_home: &Path,
    prefix: &str,
    revision: i64,
) -> Result<PathBuf, RouteAuthError> {
    let root = route_auth_root(runtime_home);
    create_dir(&root)?;
    gc_old_revision_dirs(&root, prefix, revision)?;
    let dir = revision_dir_path(runtime_home, prefix, revision);
    create_dir(&dir)?;
    Ok(dir)
}

/// Garbage-collect `<prefix>-<rev>` sibling dirs, KEEPING the current revision's
/// dir and the immediately-previous revision's dir. Only dirs strictly older
/// than the immediately-previous revision are removed.
///
/// Why keep the immediately-previous dir: a session launched under revision N-1
/// may still be running when revision N is materialized. Its isolated home
/// (`codex-home-<N-1>`, `grok-home-<N-1>`, ...) must remain intact so the
/// in-flight process finishes on the old state. Dirs we cannot parse a revision
/// from, and any revision >= current (shouldn't normally occur), are left
/// untouched as well.
fn gc_old_revision_dirs(
    root: &Path,
    prefix: &str,
    current_revision: i64,
) -> Result<(), RouteAuthError> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(RouteAuthError::Materialize {
                detail: format!("failed to read {}: {error}", root.display()),
            })
        }
    };
    let stale_prefix = format!("{prefix}-");
    let mut revisions: Vec<(i64, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(rev_str) = name.strip_prefix(&stale_prefix) else {
            continue;
        };
        let Ok(rev) = rev_str.parse::<i64>() else {
            continue;
        };
        revisions.push((rev, entry.path()));
    }
    // Immediately-previous revision = greatest revision strictly below current.
    let Some(previous_revision) = revisions
        .iter()
        .map(|(rev, _)| *rev)
        .filter(|rev| *rev < current_revision)
        .max()
    else {
        return Ok(());
    };
    for (rev, path) in revisions {
        if rev < previous_revision {
            let _ = fs::remove_dir_all(path);
        }
    }
    Ok(())
}

pub(super) fn write_private_file(path: &Path, contents: &[u8]) -> Result<(), RouteAuthError> {
    let tmp_path = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&tmp_path, contents).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to write {}: {error}", tmp_path.display()),
    })?;
    set_private_file_permissions(&tmp_path)?;
    fs::rename(&tmp_path, path).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to move {} into place: {error}", tmp_path.display()),
    })?;
    set_private_file_permissions(path)?;
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), RouteAuthError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
        RouteAuthError::Materialize {
            detail: format!("failed to chmod {}: {error}", path.display()),
        }
    })
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), RouteAuthError> {
    Ok(())
}
