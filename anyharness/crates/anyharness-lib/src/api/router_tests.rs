use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;
use uuid::Uuid;

use super::router::build_router;
use crate::{
    agents::seed::AgentSeedStore,
    app::{test_support, AppState},
    persistence::Db,
    sessions::{model::SessionRecord, store::SessionStore},
    terminals::model::{CreateTerminalOptions, TerminalPurpose},
    workspaces::{
        access_model::{WorkspaceAccessMode, WorkspaceAccessRecord},
        access_store::WorkspaceAccessStore,
    },
};

struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(prefix: &str) -> Self {
        let path = env::temp_dir().join(format!("anyharness-{prefix}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

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
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state")
}

fn init_repo(path: &Path) {
    run_git(path, ["init", "-b", "main"]);
    run_git(path, ["config", "user.email", "codex@example.com"]);
    run_git(path, ["config", "user.name", "Codex"]);
    fs::write(path.join("README.md"), "seed\n").expect("write seed file");
    run_git(path, ["add", "README.md"]);
    run_git(path, ["commit", "-m", "Initial commit"]);
}

fn run_git<const N: usize>(cwd: &Path, args: [&str; N]) {
    let output = std::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
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
async fn repo_root_resolve_route_accepts_post_and_persists_repo_root() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("repo-root-resolve");
    init_repo(repo_root.path());
    let state = test_state(false);
    let app = build_router(state.clone());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/repo-roots/resolve")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "path": repo_root.path().display().to_string() }).to_string(),
                ))
                .expect("expected request"),
        )
        .await
        .expect("expected response");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    let canonical_path = fs::canonicalize(repo_root.path())
        .expect("canonicalize repo root")
        .display()
        .to_string();
    assert_eq!(payload["path"], canonical_path);
    assert_repo_root_persisted(&state, &canonical_path, &payload);
}

#[tokio::test]
async fn legacy_repo_root_post_route_still_resolves_repo_root() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("repo-root-legacy-resolve");
    init_repo(repo_root.path());
    let state = test_state(false);
    let app = build_router(state.clone());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/repo-roots")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "path": repo_root.path().display().to_string() }).to_string(),
                ))
                .expect("expected request"),
        )
        .await
        .expect("expected response");

    assert_eq!(response.status(), StatusCode::OK);

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    let canonical_path = fs::canonicalize(repo_root.path())
        .expect("canonicalize repo root")
        .display()
        .to_string();
    assert_eq!(payload["path"], canonical_path);
    assert_repo_root_persisted(&state, &canonical_path, &payload);
}

#[tokio::test]
async fn repo_root_file_read_route_reads_text_files() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("repo-root-read-file");
    init_repo(repo_root.path());
    fs::create_dir_all(repo_root.path().join("dir")).expect("create dir");
    fs::write(repo_root.path().join("dir/file name.txt"), "tracked\n").expect("write file");
    let state = test_state(false);
    let app = build_router(state);

    let resolve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/repo-roots/resolve")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "path": repo_root.path().display().to_string() }).to_string(),
                ))
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    assert_eq!(resolve_response.status(), StatusCode::OK);
    let body = to_bytes(resolve_response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let repo_payload: Value = serde_json::from_slice(&body).expect("parse response json");
    let repo_root_id = repo_payload["id"].as_str().expect("repo root id");

    let response = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/v1/repo-roots/{repo_root_id}/files/file?path=dir%2Ffile%20name.txt"
                ))
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
    assert_eq!(payload["path"], "dir/file name.txt");
    assert_eq!(payload["content"], "tracked\n");
    assert_eq!(payload["isText"], true);
    assert_eq!(payload["tooLarge"], false);
}

#[tokio::test]
async fn repo_root_file_read_route_rejects_unsafe_paths() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("repo-root-read-unsafe-file");
    init_repo(repo_root.path());
    let state = test_state(false);
    let app = build_router(state);

    let resolve_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/repo-roots/resolve")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "path": repo_root.path().display().to_string() }).to_string(),
                ))
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    let body = to_bytes(resolve_response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let repo_payload: Value = serde_json::from_slice(&body).expect("parse response json");
    let repo_root_id = repo_payload["id"].as_str().expect("repo root id");

    for path in ["..%2Fsecret", "%2Ftmp%2Fsecret", ".git%2Fconfig"] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!(
                        "/v1/repo-roots/{repo_root_id}/files/file?path={path}"
                    ))
                    .body(Body::empty())
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let payload: Value = serde_json::from_slice(&body).expect("parse response json");
        assert_eq!(payload["code"], "INVALID_FILE_PATH");
    }
}

#[tokio::test]
async fn terminal_create_tolerates_missing_workspace_repo_root_id() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("terminal-no-repo-root");
    init_repo(repo_root.path());
    let state = test_state(false);
    let workspace_path = repo_root.path().display().to_string();

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', ?2, ?2, ?3, ?3)",
                rusqlite::params![
                    "workspace-without-repo-root",
                    workspace_path,
                    "2026-03-25T00:00:00Z"
                ],
            )?;
            Ok(())
        })
        .expect("seed workspace");

    let app = build_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workspaces/workspace-without-repo-root/terminals")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "cols": 80, "rows": 24 }).to_string()))
                .expect("expected request"),
        )
        .await
        .expect("expected response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    let terminal_id = payload["id"].as_str().expect("terminal id");
    assert_eq!(payload["title"], "Terminal");
    assert_eq!(payload["purpose"], "general");
    state
        .terminal_service
        .close_terminal(terminal_id)
        .await
        .expect("close terminal");
}

#[tokio::test]
async fn terminal_title_route_updates_and_validates_title() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("terminal-title-update");
    init_repo(repo_root.path());
    let state = test_state(false);
    let workspace_path = repo_root.path().display().to_string();

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', ?2, ?2, ?3, ?3)",
                rusqlite::params!["workspace-title", workspace_path, "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

    let terminal = state
        .terminal_service
        .create_terminal(
            "workspace-title",
            &workspace_path,
            CreateTerminalOptions {
                cwd: None,
                shell: Some("/bin/sh".to_string()),
                title: Some("Run".to_string()),
                purpose: TerminalPurpose::Run,
                env: Vec::new(),
                startup_command: None,
                startup_command_env: Vec::new(),
                startup_command_timeout_ms: None,
                cols: 80,
                rows: 24,
            },
        )
        .await
        .expect("create terminal");

    let app = build_router(state.clone());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/terminals/{}/title", terminal.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "title": "  Dev server  " }).to_string()))
                .expect("expected request"),
        )
        .await
        .expect("expected response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    assert_eq!(payload["title"], "Dev server");
    assert_eq!(payload["purpose"], "run");

    for title in ["   ".to_string(), "x".repeat(161)] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/v1/terminals/{}/title", terminal.id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(json!({ "title": title }).to_string()))
                    .expect("expected request"),
            )
            .await
            .expect("expected response");

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read response body");
        let payload: Value = serde_json::from_slice(&body).expect("parse response json");
        assert_eq!(payload["code"], "INVALID_TERMINAL_TITLE");
    }

    let access_store = WorkspaceAccessStore::new(state.db.clone());
    access_store
        .upsert(&WorkspaceAccessRecord {
            workspace_id: "workspace-title".to_string(),
            mode: WorkspaceAccessMode::FrozenForHandoff,
            handoff_op_id: Some("handoff-1".to_string()),
            updated_at: "2026-03-25T00:00:01Z".to_string(),
        })
        .expect("freeze workspace");
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri(format!("/v1/terminals/{}/title", terminal.id))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "title": "Blocked" }).to_string()))
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    assert_eq!(payload["code"], "WORKSPACE_MUTATION_BLOCKED");
    access_store
        .delete("workspace-title")
        .expect("unfreeze workspace");

    let response = app
        .oneshot(
            Request::builder()
                .method("PATCH")
                .uri("/v1/terminals/missing-terminal/title")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "title": "Missing" }).to_string()))
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    state
        .terminal_service
        .close_terminal(&terminal.id)
        .await
        .expect("close terminal");
}

#[tokio::test]
async fn workspace_mobility_preflight_warns_for_active_terminals_without_blocking() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let repo_root = TempDirGuard::new("mobility-terminal-warning");
    init_repo(repo_root.path());
    let state = test_state(false);
    let workspace_path = repo_root.path().display().to_string();

    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'repo', ?2, ?2, ?3, ?3)",
                rusqlite::params!["workspace-1", workspace_path, "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");

    let terminal = state
        .terminal_service
        .create_terminal(
            "workspace-1",
            &workspace_path,
            CreateTerminalOptions {
                cwd: None,
                shell: Some("/bin/sh".to_string()),
                title: None,
                purpose: TerminalPurpose::General,
                env: Vec::new(),
                startup_command: None,
                startup_command_env: Vec::new(),
                startup_command_timeout_ms: None,
                cols: 80,
                rows: 24,
            },
        )
        .await
        .expect("create terminal");

    let app = build_router(state.clone());
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workspaces/workspace-1/mobility/preflight")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    state
        .terminal_service
        .close_terminal(&terminal.id)
        .await
        .expect("close terminal");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    assert_eq!(payload["canMove"], true);
    assert_eq!(
        payload["blockers"]
            .as_array()
            .map(std::vec::Vec::len)
            .unwrap_or(0),
        0
    );
    let warnings = payload["warnings"].as_array().expect("warnings array");
    assert!(
        warnings.iter().any(|warning| {
            warning
                .as_str()
                .is_some_and(|text| text.contains("force-closed after the move commits"))
        }),
        "expected terminal warning, got {warnings:?}"
    );
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
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
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
            mcp_binding_summaries_json: None,
            mcp_binding_policy: crate::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
            system_prompt_append: None,
            subagents_enabled: true,
            action_capabilities_json: None,
            origin: None,
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

fn assert_repo_root_persisted(state: &AppState, canonical_path: &str, payload: &Value) {
    let stored = state
        .repo_root_service
        .find_by_path(canonical_path)
        .expect("load repo root by path")
        .expect("repo root should be persisted");
    assert_eq!(payload["id"], stored.id);
    assert_eq!(payload["path"], stored.path);
}
