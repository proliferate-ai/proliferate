use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;

use super::{
    file_mode, find_codex_rollout_path, read_file_relative_to_home, AgentArtifactFileData,
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
