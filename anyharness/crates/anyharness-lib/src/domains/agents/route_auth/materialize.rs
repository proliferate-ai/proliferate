//! Switch-time filesystem materialization for routed auth profiles that need
//! isolated harness state (claude CLAUDE_CONFIG_DIR, codex CODEX_HOME, opencode
//! config, grok HOME).
//!
//! This is the APPLY half of the two-phase render (contract §4): [`render`]
//! produces pure [`FileSpec`]s (which family, which sequence, what bytes) and
//! the launcher hands each here to be written. Path computation is shared with
//! the render layer via the pure [`sequence_dir_path`] / [`claude_config_dir_path`]
//! helpers, so the env vars render sets and the dirs applied here always agree.
//!
//! [`render`]: super::render
//!
//! Bookkeeping is filesystem-only: the applied sequence is carried in the
//! directory name (`codex-home-<rev>`, `grok-home-<rev>`, ...), so no new
//! SQLite table is introduced. Each materialization garbage-collects sibling
//! dirs for *stale* sequences, then writes the current sequence's dir
//! idempotently.
//!
//! Cleanup is deliberately conservative: the current sequence's dir, the
//! immediately-previous sequence's dir, AND any in-space dir above the current
//! sequence (a racing newer materializer's home) are always kept, so in-flight
//! processes launched under another sequence keep reading valid isolated
//! state. See [`gc_old_sequence_dirs`] for the full retention law.

use std::fs;
use std::path::{Path, PathBuf};

use super::RouteAuthError;

#[cfg(test)]
#[path = "materialize_gc_tests.rs"]
mod materialize_gc_tests;

const ROUTE_AUTH_DIR: &str = "agent-auth";

/// Directory family prefixes; the applied sequence is appended (`-<rev>`).
pub(super) const CODEX_HOME_PREFIX: &str = "codex-home";
pub(super) const GROK_HOME_PREFIX: &str = "grok-home";
pub(super) const OPENCODE_CONFIG_PREFIX: &str = "opencode-config";

/// Isolated CLAUDE_CONFIG_DIR family. Claude Code reads `~/.claude` (settings,
/// cached credentials) unless CLAUDE_CONFIG_DIR points elsewhere; an ambient
/// `~/.claude` can otherwise defeat the env sanitization the claude adapter
/// performs. This dir is stable (not sequence-keyed) — it holds no
/// sequence-specific content; the launch env vars are authoritative each launch.
const CLAUDE_CONFIG_DIR_NAME: &str = "claude-config";

/// Per-seat CLAUDE_CONFIG_DIR family (`claude-config-<seat>/`, seats v1).
/// Keyed by the seat's vault entry id, NOT by sequence: the dir's identity is
/// the seat, so keychain entries the CLI writes there (config-dir-hashed
/// service names) stay stable across document sequences, and two seats never
/// share credential state. Never GC'd by the sequence sweep (its suffix is a
/// UUID, not a sequence); a revoked seat's dir is inert — the launch env is
/// authoritative and simply stops pointing at it.
const CLAUDE_SEAT_CONFIG_DIR_PREFIX: &str = "claude-config-";

/// Config file names written inside the isolated home dirs.
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";
pub(super) const OPENCODE_CONFIG_FILE_NAME: &str = "opencode.json";

/// Isolated XDG subdir names materialized beside the opencode config.
/// XDG_CONFIG_HOME is pointed here (isolated provider config); XDG_DATA_HOME is
/// left ambient (native auth coexistence). The xdg-data dir is still created
/// for forward-compat but no env var points at it.
pub(super) const OPENCODE_XDG_CONFIG_SUBDIR: &str = "xdg-config";
pub(super) const OPENCODE_XDG_DATA_SUBDIR: &str = "xdg-data";

/// Which isolated-state family a [`FileSpec`] materializes. The render layer
/// tags the spec; apply runs the matching recipe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathFamily {
    /// Stable (not sequence-keyed) CLAUDE_CONFIG_DIR; no content file.
    ClaudeConfig,
    /// Seat-keyed CLAUDE_CONFIG_DIR (`claude-config-<seat>/`, seats v1); no
    /// content file. Keyed by the seat's vault entry id so keychain state the
    /// CLI writes there stays per-seat and sequence-stable.
    ClaudeSeatConfig { seat_id: String },
    /// Sequence-keyed CODEX_HOME with a `config.toml` (a ROUTED codex launch).
    CodexHome,
    /// Sequence-keyed OpenCode dir with `opencode.json` + XDG subdirs.
    OpencodeConfig,
    /// Sequence-keyed grok HOME; no content file.
    GrokHome,
}

/// A file/dir the launcher must materialize after a pure render (contract §4).
/// `contents` is `Some` for families with a config file (codex/opencode) and
/// `None` for dir-only families (claude/grok).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSpec {
    pub path_family: PathFamily,
    pub sequence: i64,
    pub contents: Option<Vec<u8>>,
}

fn route_auth_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join(ROUTE_AUTH_DIR)
}

/// Pure: the sequence-keyed dir path for a family (no I/O). Shared by the render
/// layer (to set env vars) and apply (to create + write). Must match the path
/// [`prepare_sequence_dir`] creates.
pub(super) fn sequence_dir_path(runtime_home: &Path, prefix: &str, sequence: i64) -> PathBuf {
    route_auth_root(runtime_home).join(format!("{prefix}-{sequence}"))
}

/// Pure: the stable CLAUDE_CONFIG_DIR path (no I/O).
pub(super) fn claude_config_dir_path(runtime_home: &Path) -> PathBuf {
    route_auth_root(runtime_home).join(CLAUDE_CONFIG_DIR_NAME)
}

/// Pure: the per-seat CLAUDE_CONFIG_DIR path (no I/O). The seat id is
/// filesystem-sanitized defensively — the server issues UUIDs, but a path
/// component must never be built from an unvetted wire string.
pub(super) fn claude_seat_config_dir_path(runtime_home: &Path, seat_id: &str) -> PathBuf {
    route_auth_root(runtime_home).join(format!(
        "{CLAUDE_SEAT_CONFIG_DIR_PREFIX}{}",
        sanitize_path_component(seat_id)
    ))
}

/// Keep `[A-Za-z0-9_-]`; everything else becomes `_`. Purely defensive: the
/// producer's seat ids are UUIDs, which pass through unchanged.
fn sanitize_path_component(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

/// Apply one [`FileSpec`]: create the isolated dir (sequence-keyed families GC
/// stale siblings first) and write its config file 0600 where the family has
/// one. Idempotent per sequence.
pub(super) fn apply_file_spec(runtime_home: &Path, spec: &FileSpec) -> Result<(), RouteAuthError> {
    match &spec.path_family {
        PathFamily::ClaudeConfig => {
            let dir = claude_config_dir_path(runtime_home);
            create_dir(&dir)?;
        }
        PathFamily::ClaudeSeatConfig { seat_id } => {
            // Seat-keyed, never sequence-swept: the dir carries per-seat CLI
            // state (keychain service hashing keys off the config-dir path),
            // so it must survive document sequences unchanged.
            let dir = claude_seat_config_dir_path(runtime_home, seat_id);
            create_dir(&dir)?;
        }
        PathFamily::CodexHome => {
            let dir = prepare_sequence_dir(runtime_home, CODEX_HOME_PREFIX, spec.sequence)?;
            write_private_file(&dir.join(CODEX_CONFIG_FILE_NAME), spec_contents(spec)?)?;
        }
        PathFamily::OpencodeConfig => {
            let dir = prepare_sequence_dir(runtime_home, OPENCODE_CONFIG_PREFIX, spec.sequence)?;
            write_private_file(&dir.join(OPENCODE_CONFIG_FILE_NAME), spec_contents(spec)?)?;
            for sub in [OPENCODE_XDG_CONFIG_SUBDIR, OPENCODE_XDG_DATA_SUBDIR] {
                create_dir(&dir.join(sub))?;
            }
        }
        PathFamily::GrokHome => {
            prepare_sequence_dir(runtime_home, GROK_HOME_PREFIX, spec.sequence)?;
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

/// Create (idempotently) the sequence-keyed directory for a family, removing
/// any sibling dirs of the same family carrying a stale sequence.
fn prepare_sequence_dir(
    runtime_home: &Path,
    prefix: &str,
    sequence: i64,
) -> Result<PathBuf, RouteAuthError> {
    let root = route_auth_root(runtime_home);
    create_dir(&root)?;
    gc_old_sequence_dirs(&root, prefix, sequence)?;
    let dir = sequence_dir_path(runtime_home, prefix, sequence);
    create_dir(&dir)?;
    Ok(dir)
}

/// The fence between the two sequence number spaces this GC can meet on disk.
/// Post-cutover sequences are small counters (1, 2, 3, …; one bump per applied
/// document), so no legitimate counter ever approaches a billion. Pre-cutover
/// `revision` values were ms-since-epoch (~1.75e12 in 2026, and growing), so
/// every legitimate ms-epoch value exceeds this floor by three orders of
/// magnitude. Above-current AND at/over the floor ⇒ pre-cutover residue
/// (reclaim); above-current but under it ⇒ a racing newer materializer's live
/// home (retain).
const OUT_OF_SPACE_SEQUENCE_FLOOR: i64 = 1_000_000_000;

/// Garbage-collect `<prefix>-<rev>` sibling dirs, KEEPING: the current
/// sequence's dir, the immediately-previous sequence's, and any IN-SPACE dir
/// numbered above the current sequence. Everything else is reclaimed —
/// including out-of-space dirs above the current sequence.
///
/// Why keep the immediately-previous dir: a session launched under sequence N-1
/// may still be running when sequence N is materialized. Its isolated home
/// (`codex-home-<N-1>`, `grok-home-<N-1>`, ...) must remain intact so the
/// in-flight process finishes on the old state. Dirs we cannot parse a sequence
/// from at all are left untouched — they are not ours to name.
///
/// Why keep in-space dirs ABOVE the current sequence: launch materialization is
/// NOT serialized with the apply door (the state-file flock covers only the
/// state.json writers; `resolve_launch_route_auth[_rotated]_for_server` reads
/// state.json then applies file specs lock-free), so two concurrent launches
/// straddling an apply can carry sequences N and N+1. If the stale one's GC
/// runs after the fresh one's write, sweeping `> current` would delete
/// `codex-home-<N+1>` — the dir the fresh session's env points into. An
/// in-space above-current dir is therefore a racing newer materializer's home
/// and is retained; the next materialization at or past it sweeps it normally.
///
/// Why OUT-OF-SPACE dirs above current are still reclaimed: `revision` used to
/// be ms-since-epoch, so a pre-cutover install has `codex-home-1785…` dirs on
/// disk while `sequence` now counts from 1; leaving anything `>= current`
/// alone meant those were `>= current` forever and never swept again. What
/// they hold is not an empty directory: the `config.toml` inside is written
/// 0600 and carries the gateway virtual key that was live at that revision.
/// The two spaces are cleanly separable — see [`OUT_OF_SPACE_SEQUENCE_FLOOR`].
fn gc_old_sequence_dirs(
    root: &Path,
    prefix: &str,
    current_sequence: i64,
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
    let mut sequences: Vec<(i64, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(rev_str) = name.strip_prefix(&stale_prefix) else {
            continue;
        };
        let Ok(rev) = rev_str.parse::<i64>() else {
            continue;
        };
        sequences.push((rev, entry.path()));
    }
    // Immediately-previous sequence = greatest sequence strictly below current.
    let previous_sequence = sequences
        .iter()
        .map(|(rev, _)| *rev)
        .filter(|rev| *rev < current_sequence)
        .max();
    for (rev, path) in sequences {
        if rev == current_sequence || Some(rev) == previous_sequence {
            continue;
        }
        // Above current and in-space: a racing newer materializer's live home
        // (see the doc above) — retained, never reclaimed by a stale sweep.
        if rev > current_sequence && rev < OUT_OF_SPACE_SEQUENCE_FLOOR {
            continue;
        }
        let _ = fs::remove_dir_all(path);
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
