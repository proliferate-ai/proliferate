use std::collections::HashMap;

use serde_json::Value;
use tracing::info;

use crate::{
    anyharness_client::{
        backfill::{
            AnyHarnessBackfillSnapshot, AnyHarnessPendingInteraction, AnyHarnessRepoRoot,
            AnyHarnessSession, AnyHarnessWorkspace,
        },
        AnyHarnessClient,
    },
    cloud_client::{
        backfill::{
            WorkerBackfillPendingInteraction, WorkerBackfillRepoRef, WorkerBackfillRequest,
            WorkerBackfillSession, WorkerBackfillWorkspace,
        },
        CloudClient,
    },
    error::WorkerError,
    identity::credentials::WorkerIdentity,
    store::WorkerStore,
};

#[derive(Debug, Clone)]
pub struct BackfillResult {
    pub mapped_workspace_count: usize,
    pub mapped_session_count: usize,
}

const MAX_WORKSPACES_PER_BACKFILL: usize = 200;
const MAX_SESSIONS_PER_BACKFILL: usize = 500;
const MAX_PENDING_INTERACTIONS_PER_SESSION: usize = 100;

pub async fn backfill_exposed_workspace(
    store: &WorkerStore,
    anyharness: &AnyHarnessClient,
    cloud: &CloudClient,
    identity: &WorkerIdentity,
    workspace_id: Option<&str>,
) -> Result<BackfillResult, WorkerError> {
    info!(
        workspace_id = workspace_id.unwrap_or("<all>"),
        "worker backfill starting"
    );
    let snapshot = anyharness.backfill_snapshot(workspace_id).await?;
    let request = backfill_request(&snapshot);
    let requested_workspace_count = request.workspaces.len();
    let requested_session_count = request.sessions.len();
    let chunks = backfill_chunks(request);
    let chunk_count = chunks.len();
    info!(
        workspace_id = workspace_id.unwrap_or("<all>"),
        requested_workspace_count,
        requested_session_count,
        chunk_count,
        "worker backfill snapshot prepared"
    );
    let mut mapped_workspace_count = 0;
    let mut mapped_session_count = 0;
    for (chunk_index, chunk) in chunks.into_iter().enumerate() {
        let chunk_workspace_count = chunk.workspaces.len();
        let chunk_session_count = chunk.sessions.len();
        info!(
            workspace_id = workspace_id.unwrap_or("<all>"),
            chunk_index,
            chunk_count,
            chunk_workspace_count,
            chunk_session_count,
            "worker backfill uploading chunk"
        );
        let response = cloud
            .upload_backfill(&identity.worker_token, &chunk)
            .await?;
        info!(
            workspace_id = workspace_id.unwrap_or("<all>"),
            chunk_index,
            mapped_workspace_count = response.mapped_workspaces.len(),
            mapped_session_count = response.mapped_sessions.len(),
            "worker backfill chunk mapped"
        );
        let workspace_mappings = response
            .mapped_workspaces
            .iter()
            .map(|mapping| {
                (
                    mapping.workspace_id.clone(),
                    mapping.cloud_workspace_id.clone(),
                )
            })
            .collect::<Vec<_>>();
        let session_mappings = response
            .mapped_sessions
            .iter()
            .map(|mapping| (mapping.session_id.clone(), mapping.workspace_id.clone()))
            .collect::<Vec<_>>();
        store.upsert_tail_mappings(&workspace_mappings, &session_mappings)?;
        mapped_workspace_count += response.mapped_workspaces.len();
        mapped_session_count += response.mapped_sessions.len();
    }
    info!(
        workspace_id = workspace_id.unwrap_or("<all>"),
        requested_workspace_count,
        requested_session_count,
        mapped_workspace_count,
        mapped_session_count,
        "worker backfill completed"
    );
    Ok(BackfillResult {
        mapped_workspace_count,
        mapped_session_count,
    })
}

fn backfill_chunks(request: WorkerBackfillRequest) -> Vec<WorkerBackfillRequest> {
    let mut chunks = Vec::new();
    for workspaces in request.workspaces.chunks(MAX_WORKSPACES_PER_BACKFILL) {
        chunks.push(WorkerBackfillRequest {
            workspaces: workspaces.to_vec(),
            sessions: Vec::new(),
        });
    }
    for sessions in request.sessions.chunks(MAX_SESSIONS_PER_BACKFILL) {
        chunks.push(WorkerBackfillRequest {
            workspaces: Vec::new(),
            sessions: sessions.to_vec(),
        });
    }
    if chunks.is_empty() {
        chunks.push(WorkerBackfillRequest {
            workspaces: Vec::new(),
            sessions: Vec::new(),
        });
    }
    chunks
}

fn backfill_request(snapshot: &AnyHarnessBackfillSnapshot) -> WorkerBackfillRequest {
    let workspaces = snapshot
        .workspaces
        .iter()
        .map(|workspace| workspace_payload(workspace, &snapshot.repo_roots_by_id))
        .collect();
    let workspace_ids = snapshot
        .workspaces
        .iter()
        .map(|workspace| workspace.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let sessions = snapshot
        .sessions
        .iter()
        .filter(|session| workspace_ids.contains(session.workspace_id.as_str()))
        .map(session_payload)
        .collect();
    WorkerBackfillRequest {
        workspaces,
        sessions,
    }
}

fn workspace_payload(
    workspace: &AnyHarnessWorkspace,
    repo_roots_by_id: &HashMap<String, AnyHarnessRepoRoot>,
) -> WorkerBackfillWorkspace {
    let repo_root = repo_roots_by_id.get(&workspace.repo_root_id);
    WorkerBackfillWorkspace {
        workspace_id: workspace.id.clone(),
        display_name: workspace.display_name.clone().or_else(|| {
            repo_root
                .and_then(|repo| repo.display_name.clone())
                .or_else(|| Some(workspace.id.clone()))
        }),
        path: Some(workspace.path.clone()),
        repo: Some(WorkerBackfillRepoRef {
            provider: repo_root.and_then(|repo| repo.remote_provider.clone()),
            owner: repo_root.and_then(|repo| repo.remote_owner.clone()),
            name: repo_root.and_then(|repo| repo.remote_repo_name.clone()),
            branch: workspace_live_branch(workspace, repo_root),
            base_branch: normalize_branch(workspace.original_branch.as_deref()).or_else(|| {
                repo_root.and_then(|repo| normalize_branch(repo.default_branch.as_deref()))
            }),
        }),
        updated_at: Some(workspace.updated_at.clone()),
    }
}

fn workspace_live_branch(
    workspace: &AnyHarnessWorkspace,
    repo_root: Option<&AnyHarnessRepoRoot>,
) -> Option<String> {
    let current_branch = normalize_branch(workspace.current_branch.as_deref());
    if workspace.kind == "worktree" {
        return current_branch;
    }

    current_branch
        .or_else(|| normalize_branch(workspace.original_branch.as_deref()))
        .or_else(|| repo_root.and_then(|repo| normalize_branch(repo.default_branch.as_deref())))
}

fn normalize_branch(branch: Option<&str>) -> Option<String> {
    let branch = branch?.trim();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch.to_string())
    }
}

fn session_payload(session: &AnyHarnessSession) -> WorkerBackfillSession {
    let phase = session
        .execution_summary
        .as_ref()
        .map(|summary| summary.phase.clone());
    let pending_interactions = session
        .execution_summary
        .as_ref()
        .map(|summary| {
            summary
                .pending_interactions
                .iter()
                .take(MAX_PENDING_INTERACTIONS_PER_SESSION)
                .map(pending_interaction_payload)
                .collect()
        })
        .unwrap_or_default();
    WorkerBackfillSession {
        session_id: session.id.clone(),
        workspace_id: Some(session.workspace_id.clone()),
        native_session_id: session.native_session_id.clone(),
        source_agent_kind: Some(session.agent_kind.clone()),
        title: session.title.clone(),
        status: Some(session.status.clone()),
        phase,
        live_config: session.live_config.clone(),
        last_event_seq: 0,
        last_event_at: Some(session.updated_at.clone()),
        started_at: Some(session.created_at.clone()),
        ended_at: session.closed_at.clone(),
        pending_interactions,
    }
}

fn pending_interaction_payload(
    interaction: &AnyHarnessPendingInteraction,
) -> WorkerBackfillPendingInteraction {
    WorkerBackfillPendingInteraction {
        request_id: interaction.request_id.clone(),
        kind: Some(interaction.kind.clone()),
        title: Some(interaction.title.clone()),
        description: interaction.description.clone(),
        payload: object_or_wrapped(interaction.payload.clone()),
    }
}

fn object_or_wrapped(value: Value) -> Option<Value> {
    match value {
        Value::Null => None,
        Value::Object(_) => Some(value),
        other => Some(serde_json::json!({ "value": other })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worktree_backfill_keeps_detached_base_out_of_live_branch() {
        let repo_root = repo_root();
        let payload = workspace_payload(
            &workspace("worktree", None, Some("feature/base")),
            &HashMap::from([(repo_root.id.clone(), repo_root)]),
        );

        let repo = payload.repo.expect("repo payload");
        assert_eq!(repo.branch, None);
        assert_eq!(repo.base_branch.as_deref(), Some("feature/base"));
    }

    #[test]
    fn worktree_backfill_ignores_head_live_branch() {
        let repo_root = repo_root();
        let payload = workspace_payload(
            &workspace("worktree", Some("HEAD"), Some("feature/base")),
            &HashMap::from([(repo_root.id.clone(), repo_root)]),
        );

        let repo = payload.repo.expect("repo payload");
        assert_eq!(repo.branch, None);
        assert_eq!(repo.base_branch.as_deref(), Some("feature/base"));
    }

    #[test]
    fn worktree_backfill_uses_current_branch_when_attached() {
        let repo_root = repo_root();
        let payload = workspace_payload(
            &workspace("worktree", Some("codex/otter"), Some("codex/otter")),
            &HashMap::from([(repo_root.id.clone(), repo_root)]),
        );

        let repo = payload.repo.expect("repo payload");
        assert_eq!(repo.branch.as_deref(), Some("codex/otter"));
        assert_eq!(repo.base_branch.as_deref(), Some("codex/otter"));
    }

    fn repo_root() -> AnyHarnessRepoRoot {
        AnyHarnessRepoRoot {
            id: "repo-root-1".to_string(),
            display_name: Some("proliferate".to_string()),
            default_branch: Some("main".to_string()),
            remote_provider: Some("github".to_string()),
            remote_owner: Some("proliferate-ai".to_string()),
            remote_repo_name: Some("proliferate".to_string()),
        }
    }

    fn workspace(
        kind: &str,
        current_branch: Option<&str>,
        original_branch: Option<&str>,
    ) -> AnyHarnessWorkspace {
        AnyHarnessWorkspace {
            id: "workspace-1".to_string(),
            kind: kind.to_string(),
            repo_root_id: "repo-root-1".to_string(),
            path: "/workspace".to_string(),
            original_branch: original_branch.map(str::to_string),
            current_branch: current_branch.map(str::to_string),
            display_name: None,
            creator_context: None,
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }
}
