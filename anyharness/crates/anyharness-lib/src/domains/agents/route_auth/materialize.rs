//! Switch-time filesystem materialization for gateway routes that need
//! isolated harness state (codex CODEX_HOME, grok/gemini HOME).
//!
//! Bookkeeping is filesystem-only (spec §4): the applied revision is carried in
//! the directory name (`codex-home-<rev>`, `grok-home-<rev>`, ...), so no new
//! SQLite table is introduced. Each materialization garbage-collects sibling
//! dirs for *stale* revisions, then writes the current revision's dir
//! idempotently. This keeps "next process launch after a revision change picks
//! up new state" working with zero schema churn.
//!
//! Cleanup is deliberately conservative: the current revision's dir AND the
//! immediately-previous revision's dir are always kept, so in-flight processes
//! launched under the prior revision keep reading valid isolated state (spec §0
//! decision: "In-flight agent processes finish on old creds; the next process
//! launch picks up new state"). Only revisions strictly older than the
//! immediately-previous one are removed.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::profile::GatewayProfile;
use super::RouteAuthError;

const ROUTE_AUTH_DIR: &str = "agent-auth";

/// Directory family prefixes; the applied revision is appended (`-<rev>`).
const CODEX_HOME_PREFIX: &str = "codex-home";
const GROK_HOME_PREFIX: &str = "grok-home";
const GEMINI_HOME_PREFIX: &str = "gemini-home";
const OPENCODE_CONFIG_PREFIX: &str = "opencode-config";

/// Isolated CLAUDE_CONFIG_DIR family. Claude Code reads `~/.claude` (settings,
/// cached credentials) unless CLAUDE_CONFIG_DIR points elsewhere; an ambient
/// `~/.claude` can otherwise defeat the env sanitization the claude adapter
/// performs (spec §13.3 / HARNESS-MATRIX claude recipe: `CLAUDE_CONFIG_DIR=<iso>`).
/// This dir is stable (not revision-keyed) — it holds no revision-specific
/// content; the launch env vars are authoritative each launch.
const CLAUDE_CONFIG_DIR_NAME: &str = "claude-config";

/// Default model written into the codex gateway config.toml. Codex refuses to
/// launch without a `model` and otherwise falls back to a codex-native default
/// id the gateway does not serve (HARNESS-MATRIX codex recipe: `model = "<default>"`).
/// A gateway-served versioned Anthropic id is used.
const CODEX_DEFAULT_MODEL: &str = "claude-sonnet-4-5-20250929";

fn route_auth_root(runtime_home: &Path) -> PathBuf {
    runtime_home.join(ROUTE_AUTH_DIR)
}

/// Materialize `CODEX_HOME` for the gateway route. Writes config.toml with the
/// proliferate provider (wire_api="responses", env_key=PROLIFERATE_GATEWAY_KEY,
/// base_url=<base_url>/v1). Returns the isolated home dir.
pub(super) fn materialize_codex_home(
    runtime_home: &Path,
    profile: &GatewayProfile,
) -> Result<PathBuf, RouteAuthError> {
    let home = prepare_revision_dir(runtime_home, CODEX_HOME_PREFIX, profile.revision)?;
    let base_url = format!("{}/v1", trim_trailing_slash(&profile.base_url));
    // TOML written by hand (small, deterministic) so the snapshot test can
    // assert exact content without pulling a toml serializer.
    let config = format!(
        "model_provider = \"proliferate\"\n\
         model = \"{CODEX_DEFAULT_MODEL}\"\n\
         \n\
         [model_providers.proliferate]\n\
         name = \"Proliferate Gateway\"\n\
         base_url = \"{base_url}\"\n\
         env_key = \"PROLIFERATE_GATEWAY_KEY\"\n\
         wire_api = \"responses\"\n"
    );
    write_private_file(&home.join("config.toml"), config.as_bytes())?;
    Ok(home)
}

/// Materialize (idempotently) an isolated CLAUDE_CONFIG_DIR so Claude Code does
/// not read an ambient `~/.claude` (which could carry stale provider/auth
/// settings that defeat env sanitization). Used by BOTH the gateway and
/// api_key claude routes. Not revision-keyed: it holds no revision-specific
/// content (the launch env is authoritative), and keeping it stable lets the
/// CLI reuse its own local state across revisions.
pub(super) fn materialize_claude_config_dir(
    runtime_home: &Path,
) -> Result<PathBuf, RouteAuthError> {
    let root = route_auth_root(runtime_home);
    let dir = root.join(CLAUDE_CONFIG_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", dir.display()),
    })?;
    Ok(dir)
}

/// Materialize the OpenCode config file (opencode.json) for the gateway route
/// and return its path (pointed at by OPENCODE_CONFIG). Provider `proliferate`
/// via `@ai-sdk/openai-compatible`, explicit models map (required).
pub(super) fn materialize_opencode_config(
    runtime_home: &Path,
    profile: &GatewayProfile,
    models: &[String],
) -> Result<PathBuf, RouteAuthError> {
    let dir = prepare_revision_dir(runtime_home, OPENCODE_CONFIG_PREFIX, profile.revision)?;
    let base_url = format!("{}/v1", trim_trailing_slash(&profile.base_url));
    let models_map: serde_json::Map<String, serde_json::Value> = models
        .iter()
        .map(|model| (model.clone(), json!({})))
        .collect();
    let config = json!({
        "provider": {
            "proliferate": {
                "npm": "@ai-sdk/openai-compatible",
                "options": {
                    "baseURL": base_url,
                    "apiKey": "{env:PROLIFERATE_GATEWAY_KEY}"
                },
                "models": models_map
            }
        }
    });
    let config_path = dir.join("opencode.json");
    let serialized =
        serde_json::to_vec_pretty(&config).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to serialize opencode config: {error}"),
        })?;
    write_private_file(&config_path, &serialized)?;
    // Isolate XDG so opencode cannot reach the user's global config/auth
    // (HARNESS-MATRIX opencode recipe: XDG_CONFIG_HOME/XDG_DATA_HOME isolated).
    for sub in [OPENCODE_XDG_CONFIG_SUBDIR, OPENCODE_XDG_DATA_SUBDIR] {
        let xdg_dir = dir.join(sub);
        fs::create_dir_all(&xdg_dir).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to create {}: {error}", xdg_dir.display()),
        })?;
    }
    Ok(config_path)
}

/// Isolated XDG subdir names materialized beside the opencode config; the
/// render layer points XDG_CONFIG_HOME/XDG_DATA_HOME at these.
pub(super) const OPENCODE_XDG_CONFIG_SUBDIR: &str = "xdg-config";
pub(super) const OPENCODE_XDG_DATA_SUBDIR: &str = "xdg-data";

/// Materialize an isolated HOME for the grok CLI (it keys config off HOME).
pub(super) fn materialize_grok_home(
    runtime_home: &Path,
    profile: &GatewayProfile,
) -> Result<PathBuf, RouteAuthError> {
    prepare_revision_dir(runtime_home, GROK_HOME_PREFIX, profile.revision)
}

/// Materialize an isolated HOME for the gemini CLI with
/// ~/.gemini/settings.json {security.auth.selectedType = "gemini-api-key"}.
pub(super) fn materialize_gemini_home(
    runtime_home: &Path,
    profile: &GatewayProfile,
) -> Result<PathBuf, RouteAuthError> {
    let home = prepare_revision_dir(runtime_home, GEMINI_HOME_PREFIX, profile.revision)?;
    let gemini_dir = home.join(".gemini");
    fs::create_dir_all(&gemini_dir).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", gemini_dir.display()),
    })?;
    let settings = json!({
        "security": { "auth": { "selectedType": "gemini-api-key" } }
    });
    let serialized =
        serde_json::to_vec_pretty(&settings).map_err(|error| RouteAuthError::Materialize {
            detail: format!("failed to serialize gemini settings: {error}"),
        })?;
    write_private_file(&gemini_dir.join("settings.json"), &serialized)?;
    Ok(home)
}

/// Create (idempotently) the revision-keyed directory for a family, removing
/// any sibling dirs of the same family carrying a different revision.
fn prepare_revision_dir(
    runtime_home: &Path,
    prefix: &str,
    revision: i64,
) -> Result<PathBuf, RouteAuthError> {
    let root = route_auth_root(runtime_home);
    fs::create_dir_all(&root).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", root.display()),
    })?;
    let target_name = format!("{prefix}-{revision}");
    gc_old_revision_dirs(&root, prefix, revision)?;
    let dir = root.join(&target_name);
    fs::create_dir_all(&dir).map_err(|error| RouteAuthError::Materialize {
        detail: format!("failed to create {}: {error}", dir.display()),
    })?;
    Ok(dir)
}

/// Garbage-collect `<prefix>-<rev>` sibling dirs, KEEPING the current revision's
/// dir and the immediately-previous revision's dir. Only dirs strictly older
/// than the immediately-previous revision are removed.
///
/// Why keep the immediately-previous dir: a session launched under revision N-1
/// may still be running when revision N is materialized. Its isolated home
/// (`codex-home-<N-1>`, `grok-home-<N-1>`, ...) must remain intact so the
/// in-flight process finishes on the old state (spec §0). Dirs we cannot parse
/// a revision from, and any revision >= current (shouldn't normally occur), are
/// left untouched as well.
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

fn trim_trailing_slash(url: &str) -> &str {
    url.trim_end_matches('/')
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
