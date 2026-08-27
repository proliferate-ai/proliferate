//! Dispatch-level tests for product MCP capability auth: expired tokens defer
//! to session liveness, every rejection is a 403 naming the real cause.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use super::init_seed_repository;
use crate::app::{test_support, AppState};
use crate::{
    api::http::product_mcp::dispatch_product_mcp,
    domains::{agents::installer::seed::AgentSeedStore, sessions::store::SessionStore},
    integrations::mcp::capability_token::{
        McpCapabilityTokenIssuer, McpCapabilityTokenSignature, ProductMcpCapabilityScope,
    },
    integrations::mcp::product_server::PRODUCT_MCP_TOKEN_HEADER_NAME,
    persistence::Db,
};

/// AppState over an in-memory db with one seeded workspace and one session in
/// the given status, ready for product MCP dispatch against the Workspace
/// endpoint. Returns the runtime home so the caller can mint tokens against
/// the same secret file and clean up.
fn product_mcp_dispatch_fixture(label: &str, session_status: &str) -> (AppState, PathBuf, PathBuf) {
    let runtime_home = PathBuf::from(format!("/tmp/anyharness-{label}-{}", uuid::Uuid::new_v4()));
    let repository_path = init_seed_repository(&PathBuf::from(format!(
        "/tmp/anyharness-{label}-repo-{}",
        uuid::Uuid::new_v4()
    )));
    let state = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-1",
        "local",
        &repository_path.to_string_lossy(),
    );
    test_support::insert_session_row(
        &SessionStore::new(state.db.clone()),
        "workspace-1",
        "session-1",
        session_status,
    );
    (state, runtime_home, repository_path)
}

/// An authentic Workspace-scope token whose embedded expiry is already in the
/// past: same secret file the served endpoint loads, negative TTL.
fn mint_expired_workspace_token(runtime_home: &Path) -> String {
    McpCapabilityTokenIssuer::new(
        runtime_home.to_path_buf(),
        "workspace-mcp-token.key",
        McpCapabilityTokenSignature::HmacSha256,
        -60,
    )
    .mint_product_mcp_token(ProductMcpCapabilityScope {
        workspace_id: "workspace-1",
        session_id: "session-1",
        product_mcp_id: crate::domains::agent_operations::mcp::definition::ID,
    })
    .expect("mint expired workspace token")
}

fn product_mcp_token_headers(token: &str) -> axum::http::HeaderMap {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(
        axum::http::HeaderName::from_static(PRODUCT_MCP_TOKEN_HEADER_NAME),
        axum::http::HeaderValue::from_str(token).expect("header value"),
    );
    headers
}

fn tools_list_body() -> serde_json::Value {
    json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })
}

// Regression for the 12h-TTL session death: tokens are minted once at launch
// and delivered as a static header, so any session older than the TTL used to
// lose every product MCP tool. A session that is still open must keep working
// on the strength of durable session state alone.
#[tokio::test(flavor = "current_thread")]
async fn expired_capability_token_keeps_serving_an_open_session() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, runtime_home, repository_path) =
        product_mcp_dispatch_fixture("expired-open", "idle");
    let token = mint_expired_workspace_token(&runtime_home);

    let response = dispatch_product_mcp(
        &state,
        "workspace-1",
        "session-1",
        "workspace",
        product_mcp_token_headers(&token),
        tools_list_body(),
    )
    .await
    .expect("expired token with an open session must still dispatch");

    assert_eq!(response.status(), axum::http::StatusCode::OK);
    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(repository_path);
}

#[tokio::test(flavor = "current_thread")]
async fn expired_capability_token_is_forbidden_once_the_session_closes() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, runtime_home, repository_path) =
        product_mcp_dispatch_fixture("expired-closed", "closed");
    let token = mint_expired_workspace_token(&runtime_home);

    let error = dispatch_product_mcp(
        &state,
        "workspace-1",
        "session-1",
        "workspace",
        product_mcp_token_headers(&token),
        tools_list_body(),
    )
    .await
    .expect_err("expired token with a closed session must be rejected");

    // 403 and a cause-naming detail: 401 would send MCP clients into OAuth
    // discovery and mask the real failure behind a parse error.
    assert_eq!(error.status(), axum::http::StatusCode::FORBIDDEN);
    assert!(error
        .detail()
        .is_some_and(|detail| detail.contains("expired")));
    assert_eq!(error.code(), Some("WORKSPACE_MCP_UNAUTHORIZED"));
    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(repository_path);
}

#[tokio::test(flavor = "current_thread")]
async fn missing_capability_token_is_forbidden_with_named_cause() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, runtime_home, repository_path) =
        product_mcp_dispatch_fixture("missing-token", "idle");

    let error = dispatch_product_mcp(
        &state,
        "workspace-1",
        "session-1",
        "workspace",
        axum::http::HeaderMap::new(),
        tools_list_body(),
    )
    .await
    .expect_err("missing token must be rejected");

    assert_eq!(error.status(), axum::http::StatusCode::FORBIDDEN);
    assert!(error
        .detail()
        .is_some_and(|detail| detail.contains("x-anyharness-product-mcp-token")));
    assert_eq!(error.code(), Some("WORKSPACE_MCP_UNAUTHORIZED"));
    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(repository_path);
}

#[tokio::test(flavor = "current_thread")]
async fn garbage_capability_token_is_forbidden_even_for_an_open_session() {
    let _lock = test_support::lock_env().await;
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let (state, runtime_home, repository_path) =
        product_mcp_dispatch_fixture("garbage-token", "idle");

    let error = dispatch_product_mcp(
        &state,
        "workspace-1",
        "session-1",
        "workspace",
        product_mcp_token_headers("not-a-real-token"),
        tools_list_body(),
    )
    .await
    .expect_err("garbage token must be rejected even though the session is open");

    assert_eq!(error.status(), axum::http::StatusCode::FORBIDDEN);
    assert!(error
        .detail()
        .is_some_and(|detail| detail.contains("malformed or its signature")));
    assert_eq!(error.code(), Some("WORKSPACE_MCP_UNAUTHORIZED"));
    let _ = fs::remove_dir_all(runtime_home);
    let _ = fs::remove_dir_all(repository_path);
}
