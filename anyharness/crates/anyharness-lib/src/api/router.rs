use axum::{
    extract::DefaultBodyLimit,
    extract::State,
    http::{header, HeaderMap, Request},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, patch, post, put},
    Router,
};
use subtle::ConstantTimeEq;
use url::form_urlencoded;

use super::http::{
    agents, cowork, files, git, health, hosting, mobility, model_registries, plans, processes,
    provider_configs, replay, repo_roots, reviews, sessions, subagents, terminals,
    workspace_naming, workspaces, worktrees,
};
use super::sse::sessions as sse_sessions;
use super::ws::terminals as ws_terminals;
use crate::api::http::error::ApiError;
use crate::app::AppState;

pub fn build_router(state: AppState) -> Router {
    let v1 = Router::new()
        // Agents
        .route("/agents", get(agents::list_agents))
        .route(
            "/agents/reconcile",
            get(agents::get_reconcile_status).post(agents::reconcile_agents),
        )
        .route("/agents/{kind}", get(agents::get_agent))
        .route("/agents/{kind}/install", post(agents::install_agent))
        .route(
            "/agents/{kind}/login/start",
            post(agents::start_agent_login),
        )
        // Provider configs
        .route(
            "/provider-configs",
            get(provider_configs::list_provider_configs),
        )
        .route(
            "/model-registries",
            get(model_registries::list_model_registries),
        )
        .route(
            "/model-registries/{kind}",
            get(model_registries::get_model_registry),
        )
        // Workspaces
        .route(
            "/workspaces",
            get(workspaces::list_workspaces).post(workspaces::create_workspace),
        )
        .route("/workspaces/resolve", post(workspaces::resolve_workspace))
        .route("/workspaces/worktrees", post(workspaces::create_worktree))
        .route(
            "/workspaces/{workspace_id}",
            get(workspaces::get_workspace).delete(workspaces::purge_workspace),
        )
        .route(
            "/workspaces/{workspace_id}/purge/preflight",
            get(workspaces::purge_workspace_preflight),
        )
        .route(
            "/workspaces/{workspace_id}/purge/retry",
            post(workspaces::retry_purge_workspace),
        )
        .route(
            "/worktrees/inventory",
            get(worktrees::get_worktree_inventory),
        )
        .route(
            "/worktrees/orphans/prune",
            post(worktrees::prune_orphan_worktree),
        )
        .route(
            "/worktrees/retention-policy",
            get(worktrees::get_worktree_retention_policy)
                .put(worktrees::update_worktree_retention_policy),
        )
        .route(
            "/worktrees/retention/run",
            post(worktrees::run_worktree_retention),
        )
        .route(
            "/workspaces/{workspace_id}/retire/preflight",
            get(workspaces::retire_workspace_preflight),
        )
        .route(
            "/workspaces/{workspace_id}/retire",
            post(workspaces::retire_workspace),
        )
        .route(
            "/workspaces/{workspace_id}/retire/cleanup-retry",
            post(workspaces::retry_retire_cleanup),
        )
        .route(
            "/repo-roots",
            get(repo_roots::list_repo_roots).post(repo_roots::resolve_repo_root),
        )
        .route("/repo-roots/resolve", post(repo_roots::resolve_repo_root))
        .route("/repo-roots/{repo_root_id}", get(repo_roots::get_repo_root))
        .route(
            "/repo-roots/{repo_root_id}/git/branches",
            get(repo_roots::list_repo_root_git_branches),
        )
        .route(
            "/repo-roots/{repo_root_id}/files/file",
            get(repo_roots::read_repo_root_file),
        )
        .route(
            "/repo-roots/{repo_root_id}/detect-setup",
            get(repo_roots::detect_repo_root_setup),
        )
        .route(
            "/repo-roots/{repo_root_id}/mobility/prepare-destination",
            post(repo_roots::prepare_repo_root_mobility_destination),
        )
        .route("/cowork", get(cowork::get_cowork_status))
        .route("/cowork/enable", post(cowork::enable_cowork))
        .route(
            "/cowork/threads",
            get(cowork::list_cowork_threads).post(cowork::create_cowork_thread),
        )
        .route(
            "/cowork/sessions/{session_id}/managed-workspaces",
            get(cowork::get_cowork_managed_workspaces),
        )
        .route(
            "/workspaces/{workspace_id}/cowork/manifest",
            get(cowork::get_cowork_manifest),
        )
        .route(
            "/workspaces/{workspace_id}/cowork/artifacts/{artifact_id}",
            get(cowork::get_cowork_artifact),
        )
        .route(
            "/workspaces/{workspace_id}/cowork/sessions/{session_id}/mcp",
            get(cowork::get_cowork_mcp_endpoint).post(cowork::post_cowork_mcp_endpoint),
        )
        .route(
            "/workspaces/{workspace_id}/sessions/{session_id}/subagents/mcp",
            get(subagents::get_subagents_mcp_endpoint).post(subagents::post_subagents_mcp_endpoint),
        )
        .route(
            "/workspaces/{workspace_id}/sessions/{session_id}/reviews/mcp",
            get(reviews::get_reviews_mcp_endpoint).post(reviews::post_reviews_mcp_endpoint),
        )
        .route(
            "/workspaces/{workspace_id}/sessions/{session_id}/workspace-naming/mcp",
            get(workspace_naming::get_workspace_naming_mcp_endpoint)
                .post(workspace_naming::post_workspace_naming_mcp_endpoint),
        )
        .route(
            "/workspaces/{workspace_id}/display-name",
            patch(workspaces::update_workspace_display_name),
        )
        .route(
            "/workspaces/{workspace_id}/detect-setup",
            get(workspaces::detect_project_setup),
        )
        .route(
            "/workspaces/{workspace_id}/setup-status",
            get(workspaces::get_setup_status),
        )
        .route(
            "/workspaces/{workspace_id}/setup-rerun",
            post(workspaces::rerun_setup),
        )
        .route(
            "/workspaces/{workspace_id}/setup-start",
            post(workspaces::start_setup),
        )
        .route(
            "/workspaces/{workspace_id}/session-launch",
            get(workspaces::get_workspace_session_launch_catalog),
        )
        .route(
            "/workspaces/{workspace_id}/sessions/restore",
            post(sessions::restore_dismissed_session),
        )
        .route(
            "/workspaces/{workspace_id}/plans",
            get(plans::list_workspace_plans),
        )
        .route(
            "/workspaces/{workspace_id}/plans/{plan_id}",
            get(plans::get_plan),
        )
        .route(
            "/workspaces/{workspace_id}/plans/{plan_id}/document",
            get(plans::get_plan_document),
        )
        .route(
            "/workspaces/{workspace_id}/plans/{plan_id}/approve",
            post(plans::approve_plan),
        )
        .route(
            "/workspaces/{workspace_id}/plans/{plan_id}/reject",
            post(plans::reject_plan),
        )
        .route(
            "/workspaces/{workspace_id}/plans/{plan_id}/handoff",
            post(plans::handoff_plan),
        )
        .route(
            "/workspaces/{workspace_id}/plans/{plan_id}/review",
            post(reviews::start_plan_review),
        )
        .route(
            "/workspaces/{workspace_id}/reviews/code",
            post(reviews::start_code_review),
        )
        .route(
            "/workspaces/{workspace_id}/mobility/preflight",
            post(mobility::preflight_workspace_mobility),
        )
        .route(
            "/workspaces/{workspace_id}/mobility/runtime-state",
            put(mobility::update_workspace_mobility_runtime_state),
        )
        .route(
            "/workspaces/{workspace_id}/mobility/export",
            post(mobility::export_workspace_mobility_archive),
        )
        .route(
            "/workspaces/{workspace_id}/mobility/install",
            post(mobility::install_workspace_mobility_archive).layer(DefaultBodyLimit::max(
                mobility::MAX_MOBILITY_ARCHIVE_BODY_BYTES,
            )),
        )
        .route(
            "/workspaces/{workspace_id}/mobility/destroy-source",
            post(mobility::destroy_workspace_mobility_source),
        )
        // Workspace files
        .route(
            "/workspaces/{workspace_id}/files/entries",
            get(files::list_entries),
        )
        .route(
            "/workspaces/{workspace_id}/files/search",
            get(files::search_files),
        )
        .route(
            "/workspaces/{workspace_id}/files/file",
            get(files::read_file),
        )
        .route(
            "/workspaces/{workspace_id}/files/file",
            put(files::write_file),
        )
        .route(
            "/workspaces/{workspace_id}/files/stat",
            get(files::stat_file),
        )
        // Git (workspace-scoped)
        .route(
            "/workspaces/{workspace_id}/git/status",
            get(git::get_git_status),
        )
        .route(
            "/workspaces/{workspace_id}/git/diff",
            get(git::get_git_diff),
        )
        .route(
            "/workspaces/{workspace_id}/git/diff/branch-files",
            get(git::list_git_branch_diff_files),
        )
        .route(
            "/workspaces/{workspace_id}/git/branches",
            get(git::list_git_branches),
        )
        .route(
            "/workspaces/{workspace_id}/git/rename-branch",
            post(git::rename_branch),
        )
        .route(
            "/workspaces/{workspace_id}/git/stage",
            post(git::stage_paths),
        )
        .route(
            "/workspaces/{workspace_id}/git/unstage",
            post(git::unstage_paths),
        )
        .route("/workspaces/{workspace_id}/git/commit", post(git::commit))
        .route("/workspaces/{workspace_id}/git/push", post(git::push))
        // Hosting (workspace-scoped, GitHub CLI-backed)
        .route(
            "/workspaces/{workspace_id}/hosting/pull-requests/current",
            get(hosting::get_current_pull_request),
        )
        .route(
            "/workspaces/{workspace_id}/hosting/pull-requests",
            post(hosting::create_pull_request),
        )
        // Terminals (workspace-scoped, interactive PTY shells)
        .route(
            "/workspaces/{workspace_id}/terminals",
            get(terminals::list_terminals),
        )
        .route(
            "/workspaces/{workspace_id}/terminals",
            post(terminals::create_terminal),
        )
        .route("/terminals/{terminal_id}", get(terminals::get_terminal))
        .route(
            "/terminals/{terminal_id}/title",
            patch(terminals::update_terminal_title),
        )
        .route(
            "/terminals/{terminal_id}/resize",
            post(terminals::resize_terminal),
        )
        .route(
            "/terminals/{terminal_id}/commands",
            post(terminals::start_terminal_command),
        )
        .route(
            "/terminal-command-runs/{command_run_id}",
            get(terminals::get_terminal_command_run),
        )
        .route(
            "/terminals/{terminal_id}",
            delete(terminals::delete_terminal),
        )
        // Terminal WebSocket (bidirectional PTY I/O)
        .route(
            "/terminals/{terminal_id}/ws",
            get(ws_terminals::terminal_ws),
        )
        // Processes (workspace-scoped, one-shot commands)
        .route(
            "/workspaces/{workspace_id}/processes/run",
            post(processes::run_command),
        )
        // Replay
        .route(
            "/replay/recordings",
            get(replay::list_replay_recordings).post(replay::export_replay_recording),
        )
        .route("/replay/sessions", post(replay::create_replay_session))
        .route(
            "/replay/sessions/{session_id}/advance",
            post(replay::advance_replay_session),
        )
        // Sessions
        .route("/sessions", post(sessions::create_session))
        .route("/sessions", get(sessions::list_sessions))
        .route("/sessions/{session_id}", get(sessions::get_session))
        .route(
            "/sessions/{session_id}/subagents",
            get(subagents::get_session_subagents),
        )
        .route(
            "/sessions/{session_id}/reviews",
            get(reviews::get_session_reviews),
        )
        .route(
            "/reviews/{review_run_id}/assignments/{assignment_id}/critique",
            get(reviews::get_review_assignment_critique),
        )
        .route(
            "/reviews/{review_run_id}/assignments/{assignment_id}/retry",
            post(reviews::retry_review_assignment),
        )
        .route("/reviews/{review_run_id}/stop", post(reviews::stop_review))
        .route(
            "/reviews/{review_run_id}/send-feedback",
            post(reviews::send_review_feedback),
        )
        .route(
            "/reviews/{review_run_id}/revision-ready",
            post(reviews::mark_review_revision_ready),
        )
        .route(
            "/sessions/{session_id}/title",
            patch(sessions::update_session_title),
        )
        .route(
            "/sessions/{session_id}/live-config",
            get(sessions::get_live_session_config),
        )
        .route(
            "/sessions/{session_id}/config-options",
            post(sessions::set_session_config_option),
        )
        .route(
            "/sessions/{session_id}/prompt",
            post(sessions::prompt_session),
        )
        .route("/sessions/{session_id}/fork", post(sessions::fork_session))
        .route(
            "/sessions/{session_id}/pending-prompts/{seq}",
            patch(sessions::edit_pending_prompt).delete(sessions::delete_pending_prompt),
        )
        .route(
            "/sessions/{session_id}/prompt-attachments/{attachment_id}",
            get(sessions::get_prompt_attachment),
        )
        .route(
            "/sessions/{session_id}/resume",
            post(sessions::resume_session),
        )
        .route(
            "/sessions/{session_id}/cancel",
            post(sessions::cancel_session),
        )
        .route(
            "/sessions/{session_id}/close",
            post(sessions::close_session),
        )
        .route(
            "/sessions/{session_id}/dismiss",
            post(sessions::dismiss_session),
        )
        .route(
            "/sessions/{session_id}/events",
            get(sessions::list_session_events),
        )
        .route(
            "/sessions/{session_id}/raw-notifications",
            get(sessions::list_session_raw_notifications),
        )
        // Interactions
        .route(
            "/sessions/{session_id}/interactions/{request_id}/resolve",
            post(sessions::resolve_interaction),
        )
        .route(
            "/sessions/{session_id}/interactions/{request_id}/mcp-url/reveal",
            post(sessions::reveal_mcp_elicitation_url),
        )
        // SSE
        .route(
            "/sessions/{session_id}/stream",
            get(sse_sessions::stream_session),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_bearer_auth,
        ));

    Router::new()
        .route("/health", get(health::get_health))
        .nest("/v1", v1)
        .with_state(state)
}

async fn require_bearer_auth(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, ApiError> {
    let Some(expected_token) = state.bearer_token.as_deref() else {
        return Ok(next.run(request).await);
    };

    let provided = extract_bearer_token(request.headers(), request.uri().query());
    if !bearer_tokens_match(provided.as_deref(), expected_token) {
        return Err(ApiError::unauthorized(
            "A valid bearer token is required for this AnyHarness runtime.",
            "UNAUTHORIZED",
        ));
    }

    Ok(next.run(request).await)
}

fn bearer_tokens_match(provided: Option<&str>, expected: &str) -> bool {
    let provided_bytes = provided.unwrap_or("").as_bytes();
    let expected_bytes = expected.as_bytes();
    bool::from(provided_bytes.ct_eq(expected_bytes))
}

fn extract_bearer_token(headers: &HeaderMap, query: Option<&str>) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        if let Some(token) = value.strip_prefix("Bearer ") {
            let trimmed = token.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_owned());
            }
        }
    }

    query.and_then(|query| {
        form_urlencoded::parse(query.as_bytes()).find_map(|(key, value)| {
            if key == "access_token" && !value.is_empty() {
                Some(value.into_owned())
            } else {
                None
            }
        })
    })
}
