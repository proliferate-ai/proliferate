//! The gen-2 workflow-runs routes: the courier's PUT and the two reads,
//! exactly the ADR runtime-plane API table (the six command POSTs live in
//! `workflow_run_commands`). Reads come from rows; the PUT's reply reads
//! THROUGH the actor mailbox so a 201 body already reflects the first
//! launch. Statuses follow Ruling F: a wrong snapshot (unknown repo root
//! included) is the 400, a placement that conflicts with reality is the 409,
//! and only true infrastructure failures are the retry-safe 503 — always
//! with zero rows inserted, compensating any worktree artifact the failed
//! attempt created.

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use utoipa::ToSchema;

use super::blocking::run_blocking;
use super::error::ApiError;
use super::workflow_run_commands;
use super::workspaces_contract::request_origin_or_api_default;
use crate::app::AppState;
use crate::domains::agents::launch_options::{LaunchSelection, LaunchSelectionUnsupported};
use crate::domains::workflows::definition::{
    InvocationPlacement, InvocationSnapshot, PlacementMode, WorkflowDefinition,
};
use crate::domains::workflows::materialize::{materialize_planned_context, plan_context_docs};
use crate::domains::workflows::projection::{run_view, RunProjection, RunView};
use crate::domains::workflows::store::{NewRunParams, WorkspaceOccupied};
use crate::domains::workspaces::creator_context::WorkspaceCreatorContext;
use crate::domains::workspaces::model::WorkspaceRecord;
use crate::domains::workspaces::workflow_placement::{
    ResolvedWorkflowPlacement, WorkflowPlacementError, WorkflowPlacementRequest,
};
use crate::live::workflows::WorkflowCommandError;
use crate::observability::{
    WORKFLOW_RUN_ACCEPTED_TRACING_TARGET, WORKFLOW_WORKSPACE_MATERIALIZED_TRACING_TARGET,
};

pub(super) const RUN_NOT_FOUND: &str = "WORKFLOW_RUN_NOT_FOUND";
pub(super) const NODE_NOT_FOUND: &str = "WORKFLOW_NODE_NOT_FOUND";
pub(super) const TRANSITION_ILLEGAL: &str = "WORKFLOW_TRANSITION_ILLEGAL";
pub(super) const SNAPSHOT_INVALID: &str = "WORKFLOW_SNAPSHOT_INVALID";
pub(super) const MATERIALIZATION_FAILED: &str = "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED";
/// New in gen-2 (journaled as an ADR amendment): the snapshot is structurally
/// valid but its placement conflicts with reality — a mismatched artifact at
/// the deterministic path, or a workspace already hosting a non-terminal run.
/// Retrying the same snapshot cannot fix it, so it is a 409, never the
/// retry-safe 503.
pub(super) const PLACEMENT_CONFLICT: &str = "WORKFLOW_PLACEMENT_CONFLICT";

/// The workflow-runs route table, merged into the v1 router by `build_router`
/// — the handlers' own module carries it so `router.rs` stays under the
/// max-lines cap.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/workflow-runs", get(list_workflow_runs))
        .route(
            "/workflow-runs/{run_id}",
            get(get_workflow_run).put(put_workflow_run),
        )
        .route(
            "/workflow-runs/{run_id}/nodes/{node_row_id}/approve",
            post(workflow_run_commands::approve_workflow_node),
        )
        .route(
            "/workflow-runs/{run_id}/nodes/{node_row_id}/fail-redo",
            post(workflow_run_commands::fail_redo_workflow_node),
        )
        .route(
            "/workflow-runs/{run_id}/nodes/{node_row_id}/type",
            post(workflow_run_commands::flip_workflow_node_type),
        )
        .route(
            "/workflow-runs/{run_id}/undo-advance",
            post(workflow_run_commands::undo_workflow_advance),
        )
        .route(
            "/workflow-runs/{run_id}/resume",
            post(workflow_run_commands::resume_workflow_run),
        )
        .route(
            "/workflow-runs/{run_id}/adhoc-nodes",
            post(workflow_run_commands::add_workflow_adhoc_node),
        )
        .route(
            "/workflow-runs/{run_id}/cancel",
            post(workflow_run_commands::cancel_workflow_run),
        )
}

/// The PUT body: the frozen invocation snapshot the courier reconstitutes
/// from the control plane's flat invocation response. Extra fields a future
/// courier might forward verbatim (`title`, `definitionRevision`, ...) are
/// tolerated and ignored. `id` is the frozen invocation's own id and becomes
/// the run row's `invocation_id`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunPutRequest {
    pub id: String,
    pub schema_version: u32,
    pub workflow_definition_id: String,
    pub definition: WorkflowDefinition,
    #[serde(default)]
    #[schema(value_type = std::collections::HashMap<String, serde_json::Value>)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    pub placement: InvocationPlacement,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct WorkflowRunsListResponse {
    pub runs: Vec<RunView>,
}

#[derive(Debug, Deserialize)]
pub struct WorkflowRunsListParams {
    pub workspace_id: Option<String>,
}

pub(super) fn map_command_error(error: WorkflowCommandError) -> ApiError {
    match error {
        WorkflowCommandError::RunNotFound => {
            ApiError::not_found("workflow run not found", RUN_NOT_FOUND)
        }
        WorkflowCommandError::Illegal(illegal) => ApiError::conflict(
            format!(
                "illegal workflow transition: command {} refused in run state {}{}: {}",
                illegal.command,
                illegal.run_state,
                illegal
                    .node_state
                    .as_deref()
                    .map(|state| format!(" (node state {state})"))
                    .unwrap_or_default(),
                illegal.detail
            ),
            TRANSITION_ILLEGAL,
        ),
        WorkflowCommandError::Internal(error) => ApiError::internal(error.to_string()),
    }
}

pub(super) async fn load_projection(
    state: &AppState,
    run_id: &str,
) -> Result<RunProjection, ApiError> {
    let store = state.workflow_store.clone();
    let run_id = run_id.to_string();
    run_blocking("workflow_run_detail", move || store.run_detail(&run_id))
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?
        .ok_or_else(|| ApiError::not_found("workflow run not found", RUN_NOT_FOUND))
}

/// The retry-safe 503: zero rows exist and the client may simply re-PUT. The
/// caller-visible detail is scrubbed of absolute local paths (Ruling F); the
/// full error goes to the log at the failure site instead.
fn materialization_unavailable(detail: &str) -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "Workspace materialization failed",
        Some(detail.to_string()),
        Some(MATERIALIZATION_FAILED),
    )
}

/// Ruling F: the typed placement error picks the status — an unknown repo
/// root inside the seam is the snapshot's fault (400), a mismatched artifact
/// is the client-visible 409, an unresolvable base ref or Git failure is the
/// retry-safe 503.
fn map_placement_error(error: WorkflowPlacementError) -> ApiError {
    match error {
        WorkflowPlacementError::RepoRootNotFound => {
            ApiError::bad_request("placement repo root not found", SNAPSHOT_INVALID)
        }
        WorkflowPlacementError::Mismatch(detail) => ApiError::conflict(
            format!("workflow placement conflict: {detail}"),
            PLACEMENT_CONFLICT,
        ),
        WorkflowPlacementError::BaseRefUnresolvable => {
            materialization_unavailable("placement base ref could not be resolved")
        }
        WorkflowPlacementError::Git(error) => {
            tracing::warn!(%error, "workflow placement failed");
            materialization_unavailable("workspace placement failed; see runtime logs")
        }
    }
}

/// A placed workspace plus what compensation must tear down if a later step
/// fails before any row exists — populated only for the worktree mode; a
/// repo-root placement is the user's own checkout and is never torn down.
struct PlacedWorkspace {
    workspace: WorkspaceRecord,
    worktree: Option<ResolvedWorkflowPlacement>,
}

async fn place_workspace(
    state: &AppState,
    run_id: &str,
    placement: &InvocationPlacement,
) -> Result<PlacedWorkspace, ApiError> {
    // Ruling A: `placement.repoConfigId` is the runtime repo-root id,
    // end-to-end. An id this runtime does not know is the snapshot being
    // wrong — the 400 — never a retryable runtime failure.
    let repo_root = {
        let repo_root_service = state.repo_root_service.clone();
        let repo_config_id = placement.repo_config_id.clone();
        run_blocking("workflow_run_repo_root", move || {
            repo_root_service.get_repo_root(&repo_config_id)
        })
        .await?
        .map_err(|error| ApiError::internal(format!("repo root lookup: {error}")))?
        .ok_or_else(|| {
            ApiError::bad_request(
                format!("unknown repo root id {}", placement.repo_config_id),
                SNAPSHOT_INVALID,
            )
        })?
    };

    let workspace_runtime = state.workspace_runtime.clone();
    let run_id = run_id.to_string();
    let mode = placement.mode;
    run_blocking("workflow_run_place", move || match mode {
        PlacementMode::Worktree => {
            let request = WorkflowPlacementRequest::RepositoryWorktree {
                run_id: run_id.clone(),
                repo_root_id: repo_root.id.clone(),
                base_ref: repo_root
                    .default_branch
                    .clone()
                    .unwrap_or_else(|| "HEAD".to_string()),
            };
            let resolved = workspace_runtime.resolve_workflow_placement(&request)?;
            let workspace = workspace_runtime.ensure_workflow_workspace(&resolved)?;
            Ok(PlacedWorkspace {
                workspace,
                worktree: Some(resolved),
            })
        }
        // Ruling B: resolve-or-reuse the workspace already registered at the
        // repo root's path — never a duplicate Local row — stamping Workflow
        // provenance only when this call is the one that creates it.
        PlacementMode::RepoRoot => {
            let origin = request_origin_or_api_default(None, "workflow_run_put");
            let resolution = workspace_runtime
                .resolve_from_path_with_origin_and_creator_context(
                    &repo_root.path,
                    origin,
                    Some(WorkspaceCreatorContext::Workflow {
                        run_id: run_id.clone(),
                    }),
                )
                .map_err(WorkflowPlacementError::Git)?;
            Ok(PlacedWorkspace {
                workspace: resolution.workspace,
                worktree: None,
            })
        }
    })
    .await?
    .map_err(map_placement_error)
}

/// Undo the worktree artifact a failing PUT created before rows existed, so
/// the retry is genuinely fresh (F8 without persistence). No-op for
/// repo-root placements.
async fn compensate_placement(state: &AppState, placed: &PlacedWorkspace) {
    let Some(resolved) = placed.worktree.clone() else {
        return;
    };
    let workspace_runtime = state.workspace_runtime.clone();
    let workspace_id = placed.workspace.id.clone();
    let _ = tokio::task::spawn_blocking(move || {
        workspace_runtime.compensate_workflow_placement(&resolved, &workspace_id)
    })
    .await;
}

/// Fail-fast model admission for a NEW run's snapshot (#1898 defect 1).
///
/// A node's `modelId` was previously unchecked at PUT, so an unservable pick
/// only surfaced minutes later when the chain reached that node — after the
/// upstream nodes had already done their work. This walks every model-bearing
/// node once and refuses the whole PUT, naming the offending node, before any
/// row is inserted.
///
/// It does NOT replace the launch-time check and cannot: the observation is
/// sampled here and the node launches later against a possibly-changed one
/// (`domains/agents/launch_options/validation.rs` stays the authority). So the
/// disposition is deliberately asymmetric — a model the observation
/// AFFIRMATIVELY lacks is fail-closed, while a merely absent or unreadable
/// observation (a cold runtime that has not probed yet) is fail-open and left
/// to the launch check. Rejecting there would fail workflow creation for a
/// reason that has nothing to do with the definition the author wrote.
async fn admit_node_models(
    state: &AppState,
    definition: &WorkflowDefinition,
) -> Result<(), ApiError> {
    let picks: Vec<(String, String, LaunchSelection)> = definition
        .nodes
        .iter()
        .filter_map(|node| {
            let model = node.model.as_ref()?;
            Some((
                node.id.clone(),
                model.agent_kind.clone(),
                LaunchSelection {
                    model_id: model.model_id.clone(),
                    control_values: model.control_values.clone(),
                },
            ))
        })
        .collect();
    if picks.is_empty() {
        return Ok(());
    }
    let service = state.launch_options_service.clone();
    let verdicts = run_blocking("workflow_snapshot_model_admission", move || {
        anyhow::Ok(
            picks
                .into_iter()
                .map(
                    |(node_id, agent_kind, selection): (String, String, LaunchSelection)| {
                        let verdict = service.validate_selection(&agent_kind, &selection);
                        (node_id, agent_kind, verdict)
                    },
                )
                .collect::<Vec<_>>(),
        )
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?;
    for (node_id, agent_kind, verdict) in verdicts {
        match verdict {
            Ok(_) => {}
            // Fail-closed: the observation is present and does not offer this.
            Err(LaunchSelectionUnsupported::Model { model_id, .. }) => {
                return Err(ApiError::bad_request(
                    format!(
                        "invalid snapshot: node {node_id} requests model \
                         '{model_id}' which {agent_kind} does not offer"
                    ),
                    SNAPSHOT_INVALID,
                ));
            }
            Err(LaunchSelectionUnsupported::Control { control_id, .. }) => {
                return Err(ApiError::bad_request(
                    format!(
                        "invalid snapshot: node {node_id} requests control \
                         '{control_id}' which {agent_kind} does not offer"
                    ),
                    SNAPSHOT_INVALID,
                ));
            }
            Err(LaunchSelectionUnsupported::ControlValue {
                control_id, value, ..
            }) => {
                return Err(ApiError::bad_request(
                    format!(
                        "invalid snapshot: node {node_id} requests value '{value}' \
                         for control '{control_id}', which {agent_kind} does not offer"
                    ),
                    SNAPSHOT_INVALID,
                ));
            }
            // Fail-open: nothing authoritative to judge against yet.
            Err(error @ LaunchSelectionUnsupported::ObservationUnavailable { .. })
            | Err(error @ LaunchSelectionUnsupported::Internal(_)) => {
                tracing::info!(
                    node_id = %node_id,
                    agent_kind = %agent_kind,
                    %error,
                    "workflow snapshot model admission deferred to launch",
                );
            }
        }
    }
    Ok(())
}

#[utoipa::path(
    put,
    path = "/v1/workflow-runs/{run_id}",
    request_body = WorkflowRunPutRequest,
    params(("run_id" = String, Path, description = "Client-minted run id (a UUID); the PUT is idempotent on it")),
    responses(
        (status = 201, description = "Run placed and started", body = RunProjection),
        (status = 200, description = "Idempotent replay: the existing run, untouched", body = RunProjection),
        (status = 400, description = "WORKFLOW_SNAPSHOT_INVALID (malformed body, non-UUID run id, unknown repo root id)"),
        (status = 409, description = "WORKFLOW_PLACEMENT_CONFLICT, zero rows inserted"),
        (status = 503, description = "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED, zero rows inserted"),
    ),
    tag = "workflow-runs"
)]
pub async fn put_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
    body: Result<Json<serde_json::Value>, JsonRejection>,
) -> Result<(StatusCode, Json<RunProjection>), ApiError> {
    // A body that is not even JSON gets the same 400 ProblemDetails as a
    // parseable-but-invalid snapshot, never axum's bare rejection text.
    let Json(body) = body.map_err(|rejection| {
        ApiError::bad_request(format!("invalid snapshot: {rejection}"), SNAPSHOT_INVALID)
    })?;
    // The run id names filesystem artifacts (the `workflow/<runId>` branch
    // and the managed `workflows/<runId>` worktree): only a client-minted
    // UUID may reach those laws.
    if uuid::Uuid::try_parse(&run_id).is_err() {
        return Err(ApiError::bad_request(
            format!("run id {run_id} is not a UUID"),
            SNAPSHOT_INVALID,
        ));
    }
    // Verbatim-custody seam: the stored definition column is re-emitted from
    // the delivered body's `definition` subtree, never re-serialized from the
    // parsed struct (serde_json's map ordering makes it key-sorted, which is
    // journaled; `deny_unknown_fields` on the definition means no loss).
    let definition_json = body
        .get("definition")
        .map(|definition| definition.to_string())
        .ok_or_else(|| {
            ApiError::bad_request("invalid snapshot: missing definition", SNAPSHOT_INVALID)
        })?;
    let request: WorkflowRunPutRequest = serde_json::from_value(body).map_err(|error| {
        ApiError::bad_request(format!("invalid snapshot: {error}"), SNAPSHOT_INVALID)
    })?;
    let snapshot = InvocationSnapshot {
        schema_version: request.schema_version,
        workflow_definition_id: request.workflow_definition_id,
        definition: request.definition,
        arguments: request.arguments,
        placement: request.placement,
    };
    let chain = snapshot
        .validate()
        .map_err(|error| ApiError::bad_request(error.detail, SNAPSHOT_INVALID))?;

    // Idempotent replay: an existing run id returns its projection untouched
    // (and rematerializes the actor if the runtime restarted since).
    {
        let store = state.workflow_store.clone();
        let existing_run_id = run_id.clone();
        let existing = run_blocking("workflow_run_replay_check", move || {
            store.run_detail(&existing_run_id)
        })
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
        if existing.is_some() {
            tracing::info!(
                target: WORKFLOW_RUN_ACCEPTED_TRACING_TARGET,
                run_id = %run_id,
                definition_id = %snapshot.workflow_definition_id,
                outcome = "replayed",
                "workflow run accepted",
            );
            let projection = state
                .workflow_manager
                .start_run_synced(&run_id)
                .await
                .map_err(map_command_error)?;
            return Ok((StatusCode::OK, Json(projection)));
        }
    }

    // Model admission runs only on the create path, and only after the replay
    // return above: an existing run keeps its verbatim custody even if its
    // frozen picks no longer resolve on this machine.
    admit_node_models(&state, &snapshot.definition).await?;

    // Disk before rows: placement, workspace, exclude entry, and context docs
    // all succeed before one row exists — a failure past this point
    // compensates the artifact it created, so the retry starts fresh.
    let placed = place_workspace(&state, &run_id, &snapshot.placement).await?;

    // The one-live-run pre-check (Ruling B), before this PUT touches the
    // workspace's checkout; the store re-enforces it inside the insert
    // transaction against races.
    {
        let store = state.workflow_store.clone();
        let workspace_id = placed.workspace.id.clone();
        let occupant = run_blocking("workflow_run_occupancy", move || {
            store.non_terminal_run_for_workspace(&workspace_id)
        })
        .await?
        .map_err(|error| ApiError::internal(error.to_string()))?;
        if let Some(occupant_run_id) = occupant {
            tracing::info!(
                target: WORKFLOW_RUN_ACCEPTED_TRACING_TARGET,
                run_id = %run_id,
                definition_id = %snapshot.workflow_definition_id,
                outcome = "conflict",
                occupant_run_id = %occupant_run_id,
                "workflow run accepted",
            );
            compensate_placement(&state, &placed).await;
            return Err(ApiError::conflict(
                format!("workspace already hosts non-terminal workflow run {occupant_run_id}"),
                PLACEMENT_CONFLICT,
            ));
        }
    }

    let doc_count = {
        let planned_docs = plan_context_docs(&snapshot, &chain);
        let doc_count = planned_docs.len();
        let templates = snapshot.definition.doc_templates.clone();
        let workspace_path = placed.workspace.path.clone();
        let materialize_run_id = run_id.clone();
        let materialized = run_blocking("workflow_run_materialize", move || {
            materialize_planned_context(
                std::path::Path::new(&workspace_path),
                &materialize_run_id,
                &planned_docs,
                &templates,
            )
        })
        .await?;
        if let Err(error) = materialized {
            tracing::warn!(run_id = %run_id, %error, "workflow context materialization failed");
            compensate_placement(&state, &placed).await;
            return Err(materialization_unavailable(
                "context materialization failed; see runtime logs",
            ));
        }
        doc_count
    };

    // One transaction: run + node + doc rows. A racing PUT of the same run id
    // loses gracefully — `created: false` — and answers the replay 200.
    let definition_id = snapshot.workflow_definition_id.clone();
    let created = {
        let store = state.workflow_store.clone();
        let params = NewRunParams {
            run_id: run_id.clone(),
            invocation_id: request.id,
            workspace_id: placed.workspace.id.clone(),
            snapshot,
            definition_json,
        };
        let inserted = run_blocking("workflow_run_insert", move || {
            store.create_run_with_first_node(params)
        })
        .await?;
        match inserted {
            Ok(created) => created,
            Err(error) => {
                compensate_placement(&state, &placed).await;
                return Err(match error.downcast_ref::<WorkspaceOccupied>() {
                    Some(occupied) => {
                        tracing::info!(
                            target: WORKFLOW_RUN_ACCEPTED_TRACING_TARGET,
                            run_id = %run_id,
                            definition_id = %definition_id,
                            outcome = "conflict",
                            "workflow run accepted",
                        );
                        ApiError::conflict(occupied.to_string(), PLACEMENT_CONFLICT)
                    }
                    None => {
                        tracing::warn!(run_id = %run_id, %error, "workflow run insert failed");
                        ApiError::internal("workflow run insert failed".to_string())
                    }
                });
            }
        }
    };

    // Emitted only after the insert transaction commits, so a workspace that
    // loses the occupancy race and gets compensated away never reports a
    // materialization it no longer has.
    tracing::info!(
        target: WORKFLOW_WORKSPACE_MATERIALIZED_TRACING_TARGET,
        run_id = %run_id,
        workspace_id = %placed.workspace.id,
        doc_count = doc_count,
        "workflow run workspace materialized",
    );
    tracing::info!(
        target: WORKFLOW_RUN_ACCEPTED_TRACING_TARGET,
        run_id = %run_id,
        definition_id = %definition_id,
        outcome = if created.created { "created" } else { "replayed" },
        "workflow run accepted",
    );

    // The reply reads THROUGH the actor mailbox, so the body already
    // reflects the first node's launch instead of racing it.
    let status = if created.created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    let projection = state
        .workflow_manager
        .start_run_synced(&run_id)
        .await
        .map_err(map_command_error)?;
    Ok((status, Json(projection)))
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs/{run_id}",
    responses(
        (status = 200, description = "The run projected from rows", body = RunProjection),
        (status = 404, description = "WORKFLOW_RUN_NOT_FOUND"),
    ),
    tag = "workflow-runs"
)]
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Path(run_id): Path<String>,
) -> Result<Json<RunProjection>, ApiError> {
    Ok(Json(load_projection(&state, &run_id).await?))
}

#[utoipa::path(
    get,
    path = "/v1/workflow-runs",
    params(("workspace_id" = Option<String>, Query, description = "Restrict to one workspace")),
    responses(
        (status = 200, description = "Run rows, newest first", body = WorkflowRunsListResponse),
    ),
    tag = "workflow-runs"
)]
pub async fn list_workflow_runs(
    State(state): State<AppState>,
    Query(params): Query<WorkflowRunsListParams>,
) -> Result<Json<WorkflowRunsListResponse>, ApiError> {
    let store = state.workflow_store.clone();
    let runs = run_blocking("workflow_runs_list", move || match params.workspace_id {
        Some(workspace_id) => store.runs_for_workspace(&workspace_id),
        None => store.all_runs(),
    })
    .await?
    .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(WorkflowRunsListResponse {
        runs: runs.iter().map(run_view).collect(),
    }))
}
