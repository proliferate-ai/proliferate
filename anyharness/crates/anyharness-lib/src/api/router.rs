use axum::{
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
    agents, cowork, files, git, health, hosting, model_registries, processes, provider_configs,
    repo_roots, sessions, terminals, workspaces,
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
        .route("/workspaces/{workspace_id}", get(workspaces::get_workspace))
        .route("/repo-roots", get(repo_roots::list_repo_roots))
        .route("/repo-roots/{repo_root_id}", get(repo_roots::get_repo_root))
        .route("/cowork", get(cowork::get_cowork_status))
        .route("/cowork/enable", post(cowork::enable_cowork))
        .route(
            "/cowork/threads",
            get(cowork::list_cowork_threads).post(cowork::create_cowork_thread),
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
            "/terminals/{terminal_id}/resize",
            post(terminals::resize_terminal),
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
        // Sessions
        .route("/sessions", post(sessions::create_session))
        .route("/sessions", get(sessions::list_sessions))
        .route("/sessions/{session_id}", get(sessions::get_session))
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
        .route(
            "/sessions/{session_id}/pending-prompts/{seq}",
            patch(sessions::edit_pending_prompt).delete(sessions::delete_pending_prompt),
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
        // Permissions
        .route(
            "/sessions/{session_id}/permissions/{request_id}/resolve",
            post(sessions::resolve_permission),
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use serde_json::Value;
    use tower::util::ServiceExt;

    use super::build_router;
    use crate::{
        app::{test_support, AppState},
        persistence::Db,
        sessions::{model::SessionRecord, store::SessionStore},
    };

    fn test_state(require_bearer_auth: bool) -> AppState {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("expected unix timestamp")
            .as_nanos();
        let runtime_home = PathBuf::from(format!("/tmp/anyharness-router-test-{unique_suffix}"));
        AppState::new(
            runtime_home,
            "http://127.0.0.1:8457".to_string(),
            Db::open_in_memory().expect("expected in-memory db"),
            require_bearer_auth,
        )
        .expect("expected app state")
    }

    #[tokio::test]
    async fn health_route_remains_public_when_bearer_auth_is_configured() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(Some("secret-token"));
        let app = build_router(test_state(false));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn protected_routes_require_bearer_auth_when_token_is_configured() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(Some("secret-token"));
        let app = build_router(test_state(false));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/workspaces")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn protected_routes_allow_matching_bearer_auth_when_token_is_configured() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(Some("secret-token"));
        let app = build_router(test_state(false));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/workspaces")
                    .header(header::AUTHORIZATION, "Bearer secret-token")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn raw_notification_history_route_returns_persisted_notifications() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        let state = test_state(false);
        state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                     VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                    rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
                )?;
                Ok(())
            })
            .expect("seed workspace");
        let store = SessionStore::new(state.db.clone());
        store
            .insert(&SessionRecord {
                id: "session-1".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
                native_session_id: Some("native-1".to_string()),
                requested_model_id: None,
                current_model_id: None,
                requested_mode_id: None,
                current_mode_id: None,
                title: None,
                thinking_level_id: None,
                thinking_budget_tokens: None,
                status: "idle".to_string(),
                created_at: "2026-03-25T00:00:00Z".to_string(),
                updated_at: "2026-03-25T00:00:00Z".to_string(),
                last_prompt_at: None,
                closed_at: None,
                dismissed_at: None,
                mcp_bindings_ciphertext: None,
                system_prompt_append: None,
            })
            .expect("insert session");
        store
            .append_raw_notification(
                "session-1",
                "agent_message_chunk",
                "2026-03-25T00:00:01Z",
                r#"{"sessionId":"native-1","update":{"sessionUpdate":"agent_message_chunk"}}"#,
            )
            .expect("insert raw notification");

        let app = build_router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/sessions/session-1/raw-notifications")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let payload: Value = serde_json::from_slice(&body).expect("parse response json");
        let items = payload.as_array().expect("raw notifications array");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["notificationKind"], "agent_message_chunk");
        assert_eq!(items[0]["notification"]["sessionId"], "native-1");
    }

    #[tokio::test]
    async fn restore_route_returns_cold_visible_session_without_live_handle() {
        let _lock = test_support::ENV_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("expected env mutex");
        let _guard = test_support::set_bearer_token_env(None);
        let state = test_state(false);
        state
            .db
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                     VALUES (?1, 'repo', '/tmp/workspace', '/tmp/workspace', ?2, ?2)",
                    rusqlite::params!["workspace-1", "2026-03-25T00:00:00Z"],
                )?;
                Ok(())
            })
            .expect("seed workspace");
        let store = SessionStore::new(state.db.clone());
        store
            .insert(&SessionRecord {
                id: "session-restore".to_string(),
                workspace_id: "workspace-1".to_string(),
                agent_kind: "claude".to_string(),
                native_session_id: Some("native-restore".to_string()),
                requested_model_id: None,
                current_model_id: None,
                requested_mode_id: None,
                current_mode_id: None,
                title: Some("Restorable".to_string()),
                thinking_level_id: None,
                thinking_budget_tokens: None,
                status: "idle".to_string(),
                created_at: "2026-03-25T00:00:00Z".to_string(),
                updated_at: "2026-03-25T01:00:00Z".to_string(),
                last_prompt_at: None,
                closed_at: None,
                dismissed_at: Some("2026-03-25T01:00:00Z".to_string()),
                mcp_bindings_ciphertext: None,
                system_prompt_append: None,
            })
            .expect("insert dismissed session");

        let app = build_router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/workspaces/workspace-1/sessions/restore")
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let payload: Value = serde_json::from_slice(&body).expect("parse response json");
        assert_eq!(payload["id"], "session-restore");
        assert_eq!(payload["dismissedAt"], Value::Null);
        assert_eq!(payload["executionSummary"]["phase"], "idle");
        assert_eq!(payload["executionSummary"]["hasLiveHandle"], false);
    }
}
