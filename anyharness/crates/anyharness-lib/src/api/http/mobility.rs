use anyharness_contract::v1::{
    DestroyWorkspaceMobilitySourceRequest, DestroyWorkspaceMobilitySourceResponse,
    ExportWorkspaceMobilityArchiveRequest, InstallWorkspaceMobilityArchiveRequest,
    InstallWorkspaceMobilityArchiveResponse, MobilityPendingConfigChangeRecord,
    MobilityPendingPromptRecord, MobilityPromptAttachmentRecord, MobilitySessionEventRecord,
    MobilitySessionLinkCompletionRecord, MobilitySessionLinkRecord,
    MobilitySessionLinkWakeScheduleRecord, MobilitySessionLiveConfigSnapshotRecord,
    MobilitySessionRawNotificationRecord, MobilitySessionRecord,
    UpdateWorkspaceMobilityRuntimeStateRequest, WorkspaceMobilityArchive, WorkspaceMobilityBlocker,
    WorkspaceMobilityFileEntry, WorkspaceMobilityPreflightResponse, WorkspaceMobilityRuntimeState,
    WorkspaceMobilitySessionBundle, WorkspaceMobilitySessionCandidate,
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::time::Instant;

use super::blocking::run_blocking;
use super::error::ApiError;
use super::latency::{latency_trace_fields, LatencyRequestContext};
use crate::app::AppState;
use crate::mobility::model::{
    ImportedWorkspaceArchiveSummary, MobilityBlocker, MobilityFileData, MobilitySessionCandidate,
    WorkspaceMobilityArchiveData, WorkspaceMobilityPreflightResult,
    WorkspaceMobilitySessionBundleData, MAX_MOBILITY_FILE_BYTES,
};
use crate::mobility::service::MobilityError;
use crate::sessions::extensions::SessionTurnOutcome;
use crate::sessions::links::model::{
    SessionLinkRecord, SessionLinkRelation, SessionLinkWorkspaceRelation,
};
use crate::sessions::model::{
    PendingConfigChangeRecord, PendingPromptRecord, PromptAttachmentKind, PromptAttachmentRecord,
    PromptAttachmentState, SessionEventRecord, SessionLiveConfigSnapshotRecord,
    SessionRawNotificationRecord, SessionRecord,
};
use crate::sessions::subagents::model::{SubagentCompletionRecord, SubagentWakeScheduleRecord};
use crate::workspaces::access_gate::WorkspaceAccessError;
use crate::workspaces::access_model::WorkspaceAccessMode;

pub const MAX_MOBILITY_ARCHIVE_BODY_BYTES: usize =
    crate::mobility::model::MAX_MOBILITY_ARCHIVE_BODY_BYTES;

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/preflight",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    responses(
        (status = 200, description = "Workspace mobility preflight", body = WorkspaceMobilityPreflightResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn preflight_workspace_mobility(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceMobilityPreflightResponse>, ApiError> {
    let latency = LatencyRequestContext::from_headers(&headers);
    let latency_fields = latency_trace_fields(latency.as_ref());
    let started = Instant::now();
    tracing::info!(
        session_id = tracing::field::Empty,
        workspace_id = %workspace_id,
        flow_id = ?latency_fields.flow_id,
        flow_kind = ?latency_fields.flow_kind,
        flow_source = ?latency_fields.flow_source,
        prompt_id = ?latency_fields.prompt_id,
        "[workspace-latency] mobility.http.preflight.request_received"
    );
    let result = state
        .mobility_service
        .preflight_workspace(&workspace_id, &[])
        .await
        .map_err(map_mobility_error)?;
    tracing::info!(
        session_id = tracing::field::Empty,
        workspace_id = %workspace_id,
        can_move = result.can_move,
        blocker_count = result.blockers.len(),
        warning_count = result.warnings.len(),
        archive_estimated_bytes = result.archive_estimated_bytes.unwrap_or_default(),
        elapsed_ms = started.elapsed().as_millis() as u64,
        flow_id = ?latency_fields.flow_id,
        flow_kind = ?latency_fields.flow_kind,
        flow_source = ?latency_fields.flow_source,
        prompt_id = ?latency_fields.prompt_id,
        "[workspace-latency] mobility.http.preflight.completed"
    );
    Ok(Json(to_contract_preflight(result)))
}

#[utoipa::path(
    put,
    path = "/v1/workspaces/{workspace_id}/mobility/runtime-state",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = UpdateWorkspaceMobilityRuntimeStateRequest,
    responses(
        (status = 200, description = "Workspace mobility runtime state", body = WorkspaceMobilityRuntimeState),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn update_workspace_mobility_runtime_state(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<UpdateWorkspaceMobilityRuntimeStateRequest>,
) -> Result<Json<WorkspaceMobilityRuntimeState>, ApiError> {
    let record = state
        .workspace_access_gate
        .set_runtime_state(
            &workspace_id,
            WorkspaceAccessMode::from_contract(req.mode),
            req.handoff_op_id,
        )
        .map_err(map_access_error)?;
    Ok(Json(record.to_contract()))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/export",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = ExportWorkspaceMobilityArchiveRequest,
    responses(
        (status = 200, description = "Workspace mobility archive", body = WorkspaceMobilityArchive),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn export_workspace_mobility_archive(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<ExportWorkspaceMobilityArchiveRequest>,
) -> Result<Json<WorkspaceMobilityArchive>, ApiError> {
    assert_workspace_mode(&state, &workspace_id, WorkspaceAccessMode::FrozenForHandoff)?;
    let mobility_service = state.mobility_service.clone();
    let archive = run_blocking("mobility_export", move || {
        mobility_service.export_workspace_archive(&workspace_id, &req.exclude_paths)
    })
    .await?
    .map_err(map_mobility_error)?;

    Ok(Json(to_contract_archive(archive)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/install",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = InstallWorkspaceMobilityArchiveRequest,
    responses(
        (status = 200, description = "Archive installed", body = InstallWorkspaceMobilityArchiveResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn install_workspace_mobility_archive(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(req): Json<InstallWorkspaceMobilityArchiveRequest>,
) -> Result<Json<InstallWorkspaceMobilityArchiveResponse>, ApiError> {
    state
        .workspace_access_gate
        .assert_can_mutate_for_workspace(&workspace_id)
        .map_err(map_access_error)?;
    let mobility_service = state.mobility_service.clone();
    let operation_id = req.operation_id;
    let archive = from_contract_archive(req.archive, &workspace_id)?;
    let summary = run_blocking("mobility_install", move || {
        mobility_service.install_workspace_archive(&workspace_id, &archive, operation_id.as_deref())
    })
    .await?
    .map_err(map_mobility_error)?;

    Ok(Json(to_contract_install_summary(summary)))
}

#[utoipa::path(
    post,
    path = "/v1/workspaces/{workspace_id}/mobility/destroy-source",
    params(("workspace_id" = String, Path, description = "Workspace ID")),
    request_body = DestroyWorkspaceMobilitySourceRequest,
    responses(
        (status = 200, description = "Destroyed the old workspace source materialization", body = DestroyWorkspaceMobilitySourceResponse),
        (status = 404, description = "Workspace not found", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "mobility"
)]
pub async fn destroy_workspace_mobility_source(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(_req): Json<DestroyWorkspaceMobilitySourceRequest>,
) -> Result<Json<DestroyWorkspaceMobilitySourceResponse>, ApiError> {
    assert_workspace_mode(&state, &workspace_id, WorkspaceAccessMode::RemoteOwned)?;
    let mobility_service = state.mobility_service.clone();
    let workspace_id_for_destroy = workspace_id.clone();
    let summary = run_blocking("mobility_destroy_source", move || {
        mobility_service.destroy_source_workspace(&workspace_id_for_destroy)
    })
    .await?
    .map_err(map_mobility_error)?;

    Ok(Json(DestroyWorkspaceMobilitySourceResponse {
        workspace_id,
        deleted_session_ids: summary.deleted_session_ids,
        closed_terminal_ids: summary.closed_terminal_ids,
        source_destroyed: summary.source_destroyed,
    }))
}

fn map_access_error(error: WorkspaceAccessError) -> ApiError {
    match error {
        WorkspaceAccessError::WorkspaceNotFound(id) => {
            ApiError::not_found(format!("workspace not found: {id}"), "WORKSPACE_NOT_FOUND")
        }
        WorkspaceAccessError::SessionNotFound(id) => {
            ApiError::not_found(format!("session not found: {id}"), "SESSION_NOT_FOUND")
        }
        WorkspaceAccessError::TerminalNotFound(id) => {
            ApiError::not_found(format!("terminal not found: {id}"), "TERMINAL_NOT_FOUND")
        }
        WorkspaceAccessError::MutationBlocked { workspace_id, mode } => ApiError::conflict(
            format!(
                "workspace {workspace_id} is not writable while mode={}",
                mode.as_str()
            ),
            "WORKSPACE_MUTATION_BLOCKED",
        ),
        WorkspaceAccessError::LiveSessionStartBlocked { workspace_id, mode } => ApiError::conflict(
            format!(
                "workspace {workspace_id} cannot start live sessions while mode={}",
                mode.as_str()
            ),
            "WORKSPACE_LIVE_SESSION_BLOCKED",
        ),
    }
}

fn assert_workspace_mode(
    state: &AppState,
    workspace_id: &str,
    expected_mode: WorkspaceAccessMode,
) -> Result<(), ApiError> {
    let runtime_state = state
        .workspace_access_gate
        .runtime_state(workspace_id)
        .map_err(map_access_error)?;
    if runtime_state.mode == expected_mode {
        return Ok(());
    }

    Err(ApiError::conflict(
        format!(
            "workspace {workspace_id} must be in {} mode, found {}",
            expected_mode.as_str(),
            runtime_state.mode.as_str()
        ),
        "WORKSPACE_MOBILITY_MODE_MISMATCH",
    ))
}

fn map_mobility_error(error: MobilityError) -> ApiError {
    match error {
        MobilityError::WorkspaceNotFound(_) => {
            ApiError::not_found("Workspace not found".to_string(), "WORKSPACE_NOT_FOUND")
        }
        MobilityError::BaseCommitMismatch { archive, destination } => ApiError::conflict(
            format!(
                "Destination workspace HEAD did not match archive base commit (destination={destination}, archive={archive})"
            ),
            "MOBILITY_BASE_COMMIT_MISMATCH",
        ),
        MobilityError::SessionAlreadyExists(session_id) => ApiError::conflict(
            format!("Session already exists in destination workspace: {session_id}"),
            "MOBILITY_SESSION_EXISTS",
        ),
        MobilityError::NotGitWorkspace(detail)
        | MobilityError::Invalid(detail)
        | MobilityError::SizeLimitExceeded(detail) => {
            ApiError::bad_request(detail, "MOBILITY_INVALID")
        }
        MobilityError::DestinationConflict(detail) => {
            ApiError::conflict(detail, "MOBILITY_DESTINATION_CONFLICT")
        }
        MobilityError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

fn to_contract_preflight(
    result: WorkspaceMobilityPreflightResult,
) -> WorkspaceMobilityPreflightResponse {
    WorkspaceMobilityPreflightResponse {
        workspace_id: result.workspace_id,
        can_move: result.can_move,
        runtime_state: result.runtime_state.to_contract(),
        branch_name: result.branch_name,
        base_commit_sha: result.base_commit_sha,
        archive_estimated_bytes: result.archive_estimated_bytes,
        blockers: result
            .blockers
            .into_iter()
            .map(to_contract_blocker)
            .collect(),
        sessions: result
            .sessions
            .into_iter()
            .map(to_contract_session_candidate)
            .collect(),
        warnings: result.warnings,
    }
}

fn to_contract_blocker(blocker: MobilityBlocker) -> WorkspaceMobilityBlocker {
    WorkspaceMobilityBlocker {
        code: blocker.code,
        message: blocker.message,
        session_id: blocker.session_id,
    }
}

fn to_contract_session_candidate(
    candidate: MobilitySessionCandidate,
) -> WorkspaceMobilitySessionCandidate {
    WorkspaceMobilitySessionCandidate {
        session_id: candidate.session.id,
        agent_kind: candidate.session.agent_kind,
        native_session_id: candidate.session.native_session_id,
        supported: candidate.supported,
        reason: candidate.reason,
    }
}

fn to_contract_install_summary(
    summary: ImportedWorkspaceArchiveSummary,
) -> InstallWorkspaceMobilityArchiveResponse {
    InstallWorkspaceMobilityArchiveResponse {
        workspace_id: summary.workspace_id,
        source_workspace_path: summary.source_workspace_path,
        base_commit_sha: summary.base_commit_sha,
        imported_session_ids: summary.imported_session_ids,
        applied_file_count: summary.applied_file_count,
        deleted_file_count: summary.deleted_file_count,
        imported_agent_artifact_count: summary.imported_agent_artifact_count,
    }
}

fn to_contract_archive(archive: WorkspaceMobilityArchiveData) -> WorkspaceMobilityArchive {
    WorkspaceMobilityArchive {
        source_workspace_path: archive.source_workspace_path,
        repo_root_path: archive.repo_root_path,
        branch_name: archive.branch_name,
        base_commit_sha: archive.base_commit_sha,
        files: archive.files.into_iter().map(to_contract_file).collect(),
        deleted_paths: archive.deleted_paths,
        sessions: archive
            .sessions
            .into_iter()
            .map(to_contract_session_bundle)
            .collect(),
        session_links: archive
            .session_links
            .into_iter()
            .map(to_contract_session_link)
            .collect(),
        session_link_completions: archive
            .session_link_completions
            .into_iter()
            .map(to_contract_session_link_completion)
            .collect(),
        session_link_wake_schedules: archive
            .session_link_wake_schedules
            .into_iter()
            .map(to_contract_session_link_wake_schedule)
            .collect(),
    }
}

fn to_contract_file(file: MobilityFileData) -> WorkspaceMobilityFileEntry {
    WorkspaceMobilityFileEntry {
        relative_path: file.relative_path,
        mode: file.mode,
        content_base64: STANDARD.encode(file.content),
    }
}

fn to_contract_session_bundle(
    bundle: WorkspaceMobilitySessionBundleData,
) -> WorkspaceMobilitySessionBundle {
    WorkspaceMobilitySessionBundle {
        session: to_contract_session_record(bundle.session),
        live_config_snapshot: bundle
            .live_config_snapshot
            .map(to_contract_live_config_snapshot),
        pending_config_changes: bundle
            .pending_config_changes
            .into_iter()
            .map(to_contract_pending_config_change)
            .collect(),
        pending_prompts: bundle
            .pending_prompts
            .into_iter()
            .map(to_contract_pending_prompt)
            .collect(),
        prompt_attachments: bundle
            .prompt_attachments
            .into_iter()
            .map(to_contract_prompt_attachment)
            .collect(),
        events: bundle.events.into_iter().map(to_contract_event).collect(),
        raw_notifications: bundle
            .raw_notifications
            .into_iter()
            .map(to_contract_raw_notification)
            .collect(),
        agent_artifacts: bundle
            .agent_artifacts
            .into_iter()
            .map(to_contract_file)
            .collect(),
    }
}

fn to_contract_session_record(record: SessionRecord) -> MobilitySessionRecord {
    MobilitySessionRecord {
        id: record.id,
        agent_kind: record.agent_kind,
        native_session_id: record.native_session_id,
        requested_model_id: record.requested_model_id,
        current_model_id: record.current_model_id,
        requested_mode_id: record.requested_mode_id,
        current_mode_id: record.current_mode_id,
        title: record.title,
        thinking_level_id: record.thinking_level_id,
        thinking_budget_tokens: record.thinking_budget_tokens,
        status: record.status,
        created_at: record.created_at,
        updated_at: record.updated_at,
        last_prompt_at: record.last_prompt_at,
        closed_at: record.closed_at,
        dismissed_at: record.dismissed_at,
        system_prompt_append: record.system_prompt_append,
        subagents_enabled: record.subagents_enabled,
        origin: record
            .origin
            .as_ref()
            .map(crate::origin::OriginContext::to_contract),
    }
}

fn to_contract_session_link(record: SessionLinkRecord) -> MobilitySessionLinkRecord {
    MobilitySessionLinkRecord {
        id: record.id,
        relation: record.relation.as_str().to_string(),
        parent_session_id: record.parent_session_id,
        child_session_id: record.child_session_id,
        workspace_relation: record.workspace_relation.as_str().to_string(),
        label: record.label,
        created_by_turn_id: record.created_by_turn_id,
        created_by_tool_call_id: record.created_by_tool_call_id,
        created_at: record.created_at,
    }
}

fn to_contract_session_link_completion(
    record: SubagentCompletionRecord,
) -> MobilitySessionLinkCompletionRecord {
    MobilitySessionLinkCompletionRecord {
        completion_id: record.completion_id,
        session_link_id: record.session_link_id,
        child_turn_id: record.child_turn_id,
        child_last_event_seq: record.child_last_event_seq,
        outcome: record.outcome.as_str().to_string(),
        parent_event_seq: record.parent_event_seq,
        parent_prompt_seq: record.parent_prompt_seq,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn to_contract_session_link_wake_schedule(
    record: SubagentWakeScheduleRecord,
) -> MobilitySessionLinkWakeScheduleRecord {
    MobilitySessionLinkWakeScheduleRecord {
        session_link_id: record.session_link_id,
    }
}

fn to_contract_live_config_snapshot(
    record: SessionLiveConfigSnapshotRecord,
) -> MobilitySessionLiveConfigSnapshotRecord {
    MobilitySessionLiveConfigSnapshotRecord {
        session_id: record.session_id,
        source_seq: record.source_seq,
        raw_config_options_json: record.raw_config_options_json,
        normalized_controls_json: record.normalized_controls_json,
        prompt_capabilities_json: record.prompt_capabilities_json,
        updated_at: record.updated_at,
    }
}

fn to_contract_pending_config_change(
    record: PendingConfigChangeRecord,
) -> MobilityPendingConfigChangeRecord {
    MobilityPendingConfigChangeRecord {
        session_id: record.session_id,
        config_id: record.config_id,
        value: record.value,
        queued_at: record.queued_at,
    }
}

fn to_contract_pending_prompt(record: PendingPromptRecord) -> MobilityPendingPromptRecord {
    let content_parts = record.prompt_payload().content_parts();
    MobilityPendingPromptRecord {
        session_id: record.session_id,
        seq: record.seq,
        prompt_id: record.prompt_id,
        text: record.text,
        content_parts,
        blocks_json: record.blocks_json,
        queued_at: record.queued_at,
    }
}

fn to_contract_prompt_attachment(record: PromptAttachmentRecord) -> MobilityPromptAttachmentRecord {
    MobilityPromptAttachmentRecord {
        attachment_id: record.attachment_id,
        session_id: record.session_id,
        state: record.state.as_str().to_string(),
        kind: record.kind.as_str().to_string(),
        mime_type: record.mime_type,
        display_name: record.display_name,
        source_uri: record.source_uri,
        size_bytes: record.size_bytes.max(0) as u64,
        sha256: record.sha256,
        content_base64: STANDARD.encode(record.content),
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn to_contract_event(record: SessionEventRecord) -> MobilitySessionEventRecord {
    MobilitySessionEventRecord {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        event_type: record.event_type,
        turn_id: record.turn_id,
        item_id: record.item_id,
        payload_json: record.payload_json,
    }
}

fn to_contract_raw_notification(
    record: SessionRawNotificationRecord,
) -> MobilitySessionRawNotificationRecord {
    MobilitySessionRawNotificationRecord {
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        payload_json: record.payload_json,
    }
}

fn from_contract_archive(
    archive: WorkspaceMobilityArchive,
    workspace_id: &str,
) -> Result<WorkspaceMobilityArchiveData, ApiError> {
    Ok(WorkspaceMobilityArchiveData {
        source_workspace_path: archive.source_workspace_path,
        repo_root_path: archive.repo_root_path,
        branch_name: archive.branch_name,
        base_commit_sha: archive.base_commit_sha,
        files: archive
            .files
            .into_iter()
            .map(from_contract_file)
            .collect::<Result<Vec<_>, _>>()?,
        deleted_paths: archive.deleted_paths,
        sessions: archive
            .sessions
            .into_iter()
            .map(|bundle| from_contract_session_bundle(bundle, workspace_id))
            .collect::<Result<Vec<_>, _>>()?,
        session_links: archive
            .session_links
            .into_iter()
            .map(from_contract_session_link)
            .collect::<Result<Vec<_>, _>>()?,
        session_link_completions: archive
            .session_link_completions
            .into_iter()
            .map(from_contract_session_link_completion)
            .collect::<Result<Vec<_>, _>>()?,
        session_link_wake_schedules: archive
            .session_link_wake_schedules
            .into_iter()
            .map(from_contract_session_link_wake_schedule)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn from_contract_file(file: WorkspaceMobilityFileEntry) -> Result<MobilityFileData, ApiError> {
    let content = STANDARD.decode(file.content_base64).map_err(|error| {
        ApiError::bad_request(
            format!(
                "Invalid base64 archive content for {}: {error}",
                file.relative_path
            ),
            "MOBILITY_INVALID_ARCHIVE",
        )
    })?;
    if content.len() > MAX_MOBILITY_FILE_BYTES {
        return Err(ApiError::bad_request(
            format!(
                "Archive file {} exceeded the {} byte limit",
                file.relative_path, MAX_MOBILITY_FILE_BYTES
            ),
            "MOBILITY_INVALID_ARCHIVE",
        ));
    }
    Ok(MobilityFileData {
        relative_path: file.relative_path,
        mode: file.mode,
        content,
    })
}

fn from_contract_session_bundle(
    bundle: WorkspaceMobilitySessionBundle,
    workspace_id: &str,
) -> Result<WorkspaceMobilitySessionBundleData, ApiError> {
    Ok(WorkspaceMobilitySessionBundleData {
        session: from_contract_session_record(bundle.session, workspace_id),
        live_config_snapshot: bundle
            .live_config_snapshot
            .map(from_contract_live_config_snapshot),
        pending_config_changes: bundle
            .pending_config_changes
            .into_iter()
            .map(from_contract_pending_config_change)
            .collect(),
        pending_prompts: bundle
            .pending_prompts
            .into_iter()
            .map(from_contract_pending_prompt)
            .collect(),
        prompt_attachments: bundle
            .prompt_attachments
            .into_iter()
            .map(from_contract_prompt_attachment)
            .collect::<Result<Vec<_>, _>>()?,
        events: bundle.events.into_iter().map(from_contract_event).collect(),
        raw_notifications: bundle
            .raw_notifications
            .into_iter()
            .map(from_contract_raw_notification)
            .collect(),
        agent_artifacts: bundle
            .agent_artifacts
            .into_iter()
            .map(from_contract_file)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn from_contract_session_record(
    record: MobilitySessionRecord,
    workspace_id: &str,
) -> SessionRecord {
    SessionRecord {
        id: record.id,
        workspace_id: workspace_id.to_string(),
        agent_kind: record.agent_kind,
        native_session_id: record.native_session_id,
        requested_model_id: record.requested_model_id,
        current_model_id: record.current_model_id,
        requested_mode_id: record.requested_mode_id,
        current_mode_id: record.current_mode_id,
        title: record.title,
        thinking_level_id: record.thinking_level_id,
        thinking_budget_tokens: record.thinking_budget_tokens,
        status: record.status,
        created_at: record.created_at,
        updated_at: record.updated_at,
        last_prompt_at: record.last_prompt_at,
        closed_at: record.closed_at,
        dismissed_at: record.dismissed_at,
        // MCP bindings are workspace-local encrypted state; sessions rebind after handoff.
        mcp_bindings_ciphertext: None,
        mcp_binding_summaries_json: None,
        system_prompt_append: record.system_prompt_append,
        subagents_enabled: record.subagents_enabled,
        origin: record
            .origin
            .map(crate::origin::OriginContext::from_contract),
    }
}

fn from_contract_session_link(
    record: MobilitySessionLinkRecord,
) -> Result<SessionLinkRecord, ApiError> {
    Ok(SessionLinkRecord {
        id: record.id,
        relation: SessionLinkRelation::parse(&record.relation).map_err(|error| {
            ApiError::bad_request(error.to_string(), "MOBILITY_INVALID_ARCHIVE")
        })?,
        parent_session_id: record.parent_session_id,
        child_session_id: record.child_session_id,
        workspace_relation: SessionLinkWorkspaceRelation::parse(&record.workspace_relation)
            .map_err(|error| {
                ApiError::bad_request(error.to_string(), "MOBILITY_INVALID_ARCHIVE")
            })?,
        label: record.label,
        created_by_turn_id: record.created_by_turn_id,
        created_by_tool_call_id: record.created_by_tool_call_id,
        created_at: record.created_at,
    })
}

fn from_contract_session_link_completion(
    record: MobilitySessionLinkCompletionRecord,
) -> Result<SubagentCompletionRecord, ApiError> {
    Ok(SubagentCompletionRecord {
        completion_id: record.completion_id,
        session_link_id: record.session_link_id,
        child_turn_id: record.child_turn_id,
        child_last_event_seq: record.child_last_event_seq,
        outcome: parse_mobility_completion_outcome(&record.outcome)?,
        parent_event_seq: record.parent_event_seq,
        parent_prompt_seq: record.parent_prompt_seq,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

fn from_contract_session_link_wake_schedule(
    record: MobilitySessionLinkWakeScheduleRecord,
) -> Result<SubagentWakeScheduleRecord, ApiError> {
    Ok(SubagentWakeScheduleRecord {
        session_link_id: record.session_link_id,
    })
}

fn parse_mobility_completion_outcome(value: &str) -> Result<SessionTurnOutcome, ApiError> {
    match value {
        "completed" => Ok(SessionTurnOutcome::Completed),
        "failed" => Ok(SessionTurnOutcome::Failed),
        "cancelled" => Ok(SessionTurnOutcome::Cancelled),
        other => Err(ApiError::bad_request(
            format!("Invalid subagent wake outcome: {other}"),
            "MOBILITY_INVALID_ARCHIVE",
        )),
    }
}

fn from_contract_live_config_snapshot(
    record: MobilitySessionLiveConfigSnapshotRecord,
) -> SessionLiveConfigSnapshotRecord {
    SessionLiveConfigSnapshotRecord {
        session_id: record.session_id,
        source_seq: record.source_seq,
        raw_config_options_json: record.raw_config_options_json,
        normalized_controls_json: record.normalized_controls_json,
        prompt_capabilities_json: record.prompt_capabilities_json,
        updated_at: record.updated_at,
    }
}

fn from_contract_pending_config_change(
    record: MobilityPendingConfigChangeRecord,
) -> PendingConfigChangeRecord {
    PendingConfigChangeRecord {
        session_id: record.session_id,
        config_id: record.config_id,
        value: record.value,
        queued_at: record.queued_at,
    }
}

fn from_contract_pending_prompt(record: MobilityPendingPromptRecord) -> PendingPromptRecord {
    PendingPromptRecord {
        session_id: record.session_id,
        seq: record.seq,
        prompt_id: record.prompt_id,
        text: record.text,
        blocks_json: record.blocks_json,
        provenance_json: None,
        queued_at: record.queued_at,
    }
}

fn from_contract_prompt_attachment(
    record: MobilityPromptAttachmentRecord,
) -> Result<PromptAttachmentRecord, ApiError> {
    let content = STANDARD.decode(record.content_base64).map_err(|_| {
        ApiError::bad_request("Invalid prompt attachment content", "INVALID_ARCHIVE")
    })?;
    if record.size_bytes != content.len() as u64 {
        return Err(ApiError::bad_request(
            "Prompt attachment size does not match decoded content",
            "INVALID_ARCHIVE",
        ));
    }
    Ok(PromptAttachmentRecord {
        attachment_id: record.attachment_id,
        session_id: record.session_id,
        state: PromptAttachmentState::parse(&record.state),
        kind: PromptAttachmentKind::parse(&record.kind),
        mime_type: record.mime_type,
        display_name: record.display_name,
        source_uri: record.source_uri,
        size_bytes: record.size_bytes.try_into().unwrap_or(i64::MAX),
        sha256: record.sha256,
        content,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

fn from_contract_event(record: MobilitySessionEventRecord) -> SessionEventRecord {
    SessionEventRecord {
        id: 0,
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        event_type: record.event_type,
        turn_id: record.turn_id,
        item_id: record.item_id,
        payload_json: record.payload_json,
    }
}

fn from_contract_raw_notification(
    record: MobilitySessionRawNotificationRecord,
) -> SessionRawNotificationRecord {
    SessionRawNotificationRecord {
        id: 0,
        session_id: record.session_id,
        seq: record.seq,
        timestamp: record.timestamp,
        notification_kind: record.notification_kind,
        payload_json: record.payload_json,
    }
}
