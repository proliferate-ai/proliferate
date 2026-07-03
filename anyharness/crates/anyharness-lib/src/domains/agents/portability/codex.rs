use std::fs;
use std::path::{Component, Path, PathBuf};

use anyhow::Context;

use super::{
    file_mode, find_codex_rollout_path, read_file_relative_to_home,
    resolve_home_relative_artifact_path, write_artifact_file, AgentArtifactFileData,
};
use crate::domains::sessions::model::SessionRecord;

pub(super) fn collect_codex_artifacts(
    home_dir: &Path,
    runtime_home: Option<&Path>,
    session: &SessionRecord,
) -> anyhow::Result<Vec<AgentArtifactFileData>> {
    let Some(native_session_id) = session.native_session_id.as_deref() else {
        return Ok(Vec::new());
    };

    let roots = codex_artifact_roots(home_dir, runtime_home);
    for root in &roots {
        if let Some(rollout_path) = find_codex_rollout_path(&root.sessions_root, native_session_id)?
        {
            return Ok(vec![read_codex_file(root, home_dir, &rollout_path)?]);
        }
    }

    tracing::warn!(
        session_id = %session.id,
        native_session_id = %native_session_id,
        sessions_roots = ?roots.iter().map(|root| root.sessions_root.display().to_string()).collect::<Vec<_>>(),
        "Codex rollout file missing; continuing without portable Codex artifacts"
    );
    Ok(Vec::new())
}

pub(super) fn delete_codex_artifacts(
    home_dir: &Path,
    runtime_home: Option<&Path>,
    session: &SessionRecord,
) -> anyhow::Result<()> {
    let Some(native_session_id) = session.native_session_id.as_deref() else {
        return Ok(());
    };

    for root in codex_artifact_roots(home_dir, runtime_home) {
        if let Some(rollout_path) = find_codex_rollout_path(&root.sessions_root, native_session_id)?
        {
            fs::remove_file(&rollout_path)
                .with_context(|| format!("removing agent artifact {}", rollout_path.display()))?;
        }
    }

    Ok(())
}

/// Install collected Codex rollouts into EVERY `CODEX_HOME` the destination
/// runtime may resolve, mirroring collect's [`codex_artifact_roots`] (install
/// was previously asymmetric — it only wrote `~/.codex/sessions`):
///
/// - `<runtime_home>/agent-auth/codex-local` — the session-layer `CODEX_HOME`
///   (`sessions::runtime::launch_env::prepare_local_codex_home`). This is the
///   home a native launch uses AND the home an api_key route-authed launch
///   uses: the codex api_key route sets only `OPENAI_API_KEY` and does NOT
///   override `CODEX_HOME` (`route_auth::render::render_api_key`), so the
///   codex-local value from the session layer survives the
///   workspace→session→route_auth merge (`driver::process::merge_spawn_env`).
///   Every cloud-sandbox Codex session in the migration path is api_key-routed
///   (the e2e seeds `route-selections/<harness>/cloud` with `route=api_key`),
///   so this is the root a route-authed sandbox launch actually scans.
/// - `~/.codex` — native/unrouted destinations reading the ambient home
///   (today's behavior, still correct).
///
/// Without the codex-local mirror a migrated Codex rollout is written only to
/// `~/.codex` but the route-authed launch reads `codex-local`, so `resume`
/// finds nothing and silently starts a fresh native session — the exact loss
/// this preserve-native install mode exists to prevent (the Codex twin of the
/// Claude `CLAUDE_CONFIG_DIR` gap fixed in b0e0495bf).
///
/// The gateway codex route DOES override `CODEX_HOME` to a revision-scoped
/// `codex-home-<rev>` (`render::render_codex_gateway` →
/// `materialize::materialize_codex_home`), but that dir is created lazily at
/// launch and garbage-collected per revision — it cannot be pre-seeded at
/// install time, and collect's [`codex_artifact_roots`] does not scan it
/// either, so gateway-codex migration is symmetrically out of scope on both
/// the collect and install sides (a pre-existing limitation, not a regression).
pub(super) fn install_codex_artifacts(
    home_dir: &Path,
    runtime_home: Option<&Path>,
    files: &[AgentArtifactFileData],
) -> anyhow::Result<()> {
    for root in codex_artifact_roots(home_dir, runtime_home) {
        install_codex_artifacts_under_home(&root.codex_home, files)?;
    }
    Ok(())
}

/// Write each collected rollout under one `CODEX_HOME` root. Collected rollout
/// paths are always rooted at `.codex/…` (`read_codex_file`); re-root them as
/// `…` directly under `codex_home` (which stands in for the `.codex` root), so
/// `.codex/sessions/<...>` lands at `<codex_home>/sessions/<...>`. Paths not
/// under `.codex/` are skipped (nothing collected produces them). The
/// `sessions` allowed-prefix preserves the path-traversal guarantee of
/// [`resolve_home_relative_artifact_path`] for the new destination — a `..`
/// component or an escape above `sessions/` fails the install loudly.
fn install_codex_artifacts_under_home(
    codex_home: &Path,
    files: &[AgentArtifactFileData],
) -> anyhow::Result<()> {
    let allowed_prefix = Path::new("sessions");
    for file in files {
        let Some(under_home) = strip_codex_root_component(Path::new(&file.relative_path)) else {
            continue;
        };
        let target = resolve_home_relative_artifact_path(
            codex_home,
            &under_home.to_string_lossy(),
            allowed_prefix,
        )?;
        write_artifact_file(&target, file)?;
    }
    Ok(())
}

/// Re-root a collected `.codex/sessions/…` rollout path as `sessions/…` for
/// placement directly under a `CODEX_HOME` root (which stands in for `.codex`).
/// Returns `None` for any path not under `.codex/` — there is nothing to
/// install.
fn strip_codex_root_component(relative_path: &Path) -> Option<PathBuf> {
    let mut components = relative_path.components();
    match components.next() {
        Some(Component::Normal(first)) if first == ".codex" => {
            Some(components.as_path().to_path_buf())
        }
        _ => None,
    }
}

struct CodexArtifactRoot {
    codex_home: PathBuf,
    sessions_root: PathBuf,
}

fn codex_artifact_roots(home_dir: &Path, runtime_home: Option<&Path>) -> Vec<CodexArtifactRoot> {
    let mut roots = Vec::new();
    if let Some(runtime_home) = runtime_home {
        let codex_home = runtime_home.join("agent-auth").join("codex-local");
        roots.push(CodexArtifactRoot {
            sessions_root: codex_home.join("sessions"),
            codex_home,
        });
    }
    let codex_home = home_dir.join(".codex");
    roots.push(CodexArtifactRoot {
        sessions_root: codex_home.join("sessions"),
        codex_home,
    });
    roots
}

fn read_codex_file(
    root: &CodexArtifactRoot,
    home_dir: &Path,
    path: &Path,
) -> anyhow::Result<AgentArtifactFileData> {
    if path.starts_with(home_dir) {
        return read_file_relative_to_home(home_dir, path);
    }

    let content = fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let relative_to_codex_home = path
        .strip_prefix(&root.codex_home)
        .with_context(|| format!("stripping Codex home prefix from {}", path.display()))?;
    Ok(AgentArtifactFileData {
        relative_path: Path::new(".codex")
            .join(relative_to_codex_home)
            .to_string_lossy()
            .to_string(),
        mode: file_mode(path)?,
        content,
    })
}
