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
    let snapshot = anyharness.backfill_snapshot(workspace_id).await?;
    let request = backfill_request(&snapshot);
    let mut mapped_workspace_count = 0;
    let mut mapped_session_count = 0;
    for chunk in backfill_chunks(request) {
        let response = cloud
            .upload_backfill(&identity.worker_token, &chunk)
            .await?;
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
        store.upsert_sync_mappings(&workspace_mappings, &session_mappings)?;
        mapped_workspace_count += response.mapped_workspaces.len();
        mapped_session_count += response.mapped_sessions.len();
    }
    info!(
        mapped_workspace_count,
        mapped_session_count, "worker backfill completed"
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
            branch: workspace
                .current_branch
                .clone()
                .or_else(|| workspace.original_branch.clone())
                .or_else(|| repo_root.and_then(|repo| repo.default_branch.clone())),
            base_branch: workspace
                .original_branch
                .clone()
                .or_else(|| repo_root.and_then(|repo| repo.default_branch.clone())),
        }),
        updated_at: Some(workspace.updated_at.clone()),
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
