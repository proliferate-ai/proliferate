use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

use anyharness_contract::v1::{
    RuntimeConfigExternalScope, RuntimeConfigManifest, RuntimeConfigRevision,
    RuntimeDirectAttachAuthConfig, RuntimeJwtVerificationKey,
};
use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tower::util::ServiceExt;
use uuid::Uuid;

use super::router::build_router;
use crate::{
    app::{test_support, AppState},
    domains::{
        agents::seed::AgentSeedStore,
        cowork::mcp::auth::{LEGACY_CAPABILITY_HEADER_NAME, SECRET_FILE_NAME},
    },
    integrations::mcp::capability_token::{McpCapabilityTokenIssuer, McpCapabilityTokenSignature},
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

fn seed_workspace(state: &AppState, workspace_id: &str, path: &str) {
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO workspaces (id, kind, path, source_repo_root_path, created_at, updated_at)
                 VALUES (?1, 'worktree', ?2, ?2, ?3, ?3)",
                rusqlite::params![workspace_id, path, "2026-03-25T00:00:00Z"],
            )?;
            Ok(())
        })
        .expect("seed workspace");
}

fn configure_direct_attach_auth(state: &AppState, target_id: &str) {
    state.auth_manager.apply_runtime_config(
        &RuntimeConfigRevision {
            id: "rev-direct-attach".to_string(),
            sequence: 1,
            content_hash: "sha256:direct-attach".to_string(),
            external_scope: Some(RuntimeConfigExternalScope {
                provider: "proliferate-cloud".to_string(),
                id: "profile-1".to_string(),
                target_id: Some(target_id.to_string()),
            }),
        },
        &RuntimeConfigManifest {
            mcp_servers: Vec::new(),
            mcp_binding_summaries: Vec::new(),
            skills: Vec::new(),
            artifacts: Vec::new(),
            direct_attach_auth: Some(RuntimeDirectAttachAuthConfig {
                issuer: "https://api.test.proliferate".to_string(),
                audience: "anyharness".to_string(),
                target_id: Some(target_id.to_string()),
                verification_keys: vec![RuntimeJwtVerificationKey {
                    kid: "test-kid".to_string(),
                    algorithm: "RS256".to_string(),
                    public_key_pem: TEST_PUBLIC_KEY.to_string(),
                }],
            }),
            warnings: Vec::new(),
        },
    );
}

fn direct_attach_token(workspace_id: &str, session_id: Option<&str>, jti: &str) -> String {
    let now = chrono::Utc::now().timestamp();
    let mut claims = json!({
        "iss": "https://api.test.proliferate",
        "aud": "anyharness",
        "sub": "user-1",
        "exp": now + 1200,
        "nbf": now - 5,
        "iat": now,
        "jti": jti,
        "org_id": "org-1",
        "target_id": "target-1",
        "cloud_workspace_id": "cloud-workspace-1",
        "anyharness_workspace_id": workspace_id,
        "claim_id": "claim-1",
        "permissions": ["read", "write", "control"],
    });
    if let Some(session_id) = session_id {
        claims["anyharness_session_id"] = json!(session_id);
    }
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-kid".to_string());
    encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).expect("test private key"),
    )
    .expect("sign direct attach token")
}

fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

const TEST_PRIVATE_KEY: &str = r#"-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDWDDceH/FIgRwh
otxNut5v/a30ZzoVe9EMNB1R/FHKth2O18U++zxw3bXoA10CALuWUhP0mUgN2WZh
noEVqCZUkj1KKbXILsRFdMzmAq+8xPdMiItcZdxYdqVsgF2W0MapFwiOszgv7fqE
LgJnk7PBLoTzwPLgpb80GdCh9tJmzt0E5T8//OuqwfUO2iykuzAGKMKubiexfLIZ
HdY11+/8NGGb1PZnUqyW7l52qFZVxaZuhYpms0xDnzHkSSsoWztifN/32GhCntzh
4pRZV31hbXnhtN0xxTCz/2sNc9EmLuqzN1vSpGpFXT/xxlYpUe1A88eaqHdpOuHb
PnQ/zjuvAgMBAAECggEAKdOoP6BBT4g/PYlsIFpYVi0NvZkgXgtcbdSPODKkrwaI
Xx3l4ulIRcvlXImvtpD7FyRB1wXO8TneykulcNxzZQpQpLni1lPhMath0L6Mpcgd
hRyXkv4qoTTKHZo1758reuZP20bFP4Ry9DpjaOcRdLoI6/Lz4xcwdldnEAdB1SnS
n3a1Nzz7QjjGRa2f+h2mo74TpP3mv6Jc+iZd0YWfQs1JcsiNDh28r8UDGnxB25iM
hC9BhHw0Ly9K024yjk2liMbgsDA23wo7KyBgg3JFqfNXVlRfLW02O/lp/kkuEuYo
0xRP7ApY2dPtkbC1L8U5IOeWSL/896+8TLjKOTUAnQKBgQD3xOuWuOuijYnVeOWe
yVxZNLeIdR00PS2glTBINSEuW1thVfnOjWKRT8scrX0j7DC4KENuvONzZ3JcWr+X
qnmY2wfi1G3b443mU5McZS41YpDkW8slMpEvi/PZ4YOT1ehbIiQb3f8iSabjK1Gv
5Kn9ysdHaFmbgMw+NiKghjMO2wKBgQDdKIVA+zRgumOFfrWLA3ew/91I6kFk4tIM
t69Ok8U5LdrntDXF25TL/315RIdkq3rr9gDoOYEnV6mzVIYbsUqOCoMfUdWnGkoF
HIHew9wtnU+jz/suAtBDDyozwUyTTu6ARQqDpOu1JPIiVSCvQQolxX/OABFvlFdA
WzHG6V4MvQKBgQDK3P2zs4ai2lZfZZREFUQ6edJHtPQLYIfqMhyNEosvZHeGU5ms
R9DLf1SjD10lu24MalMD6T4lsC5PdbHnIRpcUAG99AZbAo6dZhJOLn3OEfzmLE5B
D40WK/WlkGJl+b88VtDPzEzoKvushjxk0sloVc4iJksv6h3QVgy1+Ar3/wKBgQCs
91wAjndQj3X2mjryFiwuSm6O8Gdkt+EAAUkic3/0UGC8hrznmeyt/4vqpCYgHd1t
XmEnPpI8attWXezlC6v7m00h2ab3oh/yD3GjABvbsQTwYWFZgunPCLVA9RUmwLzX
pSer/fg7HEIjh+CgMIX3NJfYTUVVtvbmZmxv3WSpIQKBgQCDtIRI5q0P/RImEp4h
Wno58XSZDnHUhof02dPCPPOZyAWuicNjZ9OxpUDaJUziDub1OaypKd0Za/OlA03q
/6qxmLJlovxRgvxZnpnv27oStvH84H3JFlaFc1RFqKr67KbyWf/fwxEGSK1IOLk4
XQQBYX0ud0uD/Bf8nur29MM9Iw==
-----END PRIVATE KEY-----"#;

const TEST_PUBLIC_KEY: &str = r#"-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1gw3Hh/xSIEcIaLcTbre
b/2t9Gc6FXvRDDQdUfxRyrYdjtfFPvs8cN216ANdAgC7llIT9JlIDdlmYZ6BFagm
VJI9Sim1yC7ERXTM5gKvvMT3TIiLXGXcWHalbIBdltDGqRcIjrM4L+36hC4CZ5Oz
wS6E88Dy4KW/NBnQofbSZs7dBOU/P/zrqsH1DtospLswBijCrm4nsXyyGR3WNdfv
/DRhm9T2Z1Kslu5edqhWVcWmboWKZrNMQ58x5EkrKFs7Ynzf99hoQp7c4eKUWVd9
YW154bTdMcUws/9rDXPRJi7qszdb0qRqRV0/8cZWKVHtQPPHmqh3aTrh2z50P847
rwIDAQAB
-----END PUBLIC KEY-----"#;

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
async fn scoped_direct_attach_jwt_filters_workspaces_and_honors_revocation() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(Some("worker-secret"));
    let state = test_state(false);
    seed_workspace(&state, "workspace-claimed", "/tmp/claimed-workspace");
    seed_workspace(&state, "workspace-other", "/tmp/other-workspace");
    configure_direct_attach_auth(&state, "target-1");
    let app = build_router(state);
    let token = direct_attach_token("workspace-claimed", None, "jti-claimed");

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/workspaces")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
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
    let workspaces = payload.as_array().expect("workspace list");
    assert_eq!(workspaces.len(), 1);
    assert_eq!(workspaces[0]["id"], "workspace-claimed");

    let worker_only_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/v1/runtime-config")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    assert_eq!(worker_only_response.status(), StatusCode::FORBIDDEN);

    let revoke_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/v1/auth/revoked-jtis")
                .header(header::AUTHORIZATION, "Bearer worker-secret")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "jtiHashes": [sha256_hex("jti-claimed")],
                        "expiresAt": chrono::Utc::now().timestamp() + 1200,
                    })
                    .to_string(),
                ))
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    assert_eq!(revoke_response.status(), StatusCode::OK);

    let revoked_response = app
        .oneshot(
            Request::builder()
                .uri("/v1/workspaces")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .expect("expected request"),
        )
        .await
        .expect("expected response");
    assert_eq!(revoked_response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn legacy_cowork_mcp_route_uses_product_mcp_auth_errors() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let app = build_router(test_state(false));

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workspaces/workspace-1/cowork/sessions/session-1/mcp")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }).to_string(),
                ))
                .expect("expected request"),
        )
        .await
        .expect("expected response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("read response body");
    let payload: Value = serde_json::from_slice(&body).expect("parse response json");
    assert_eq!(payload["code"], "COWORK_MCP_UNAUTHORIZED");
}

#[tokio::test]
async fn legacy_cowork_mcp_route_accepts_legacy_capability_token() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let state = test_state(false);
    let legacy_token = McpCapabilityTokenIssuer::new(
        state.runtime_home.clone(),
        SECRET_FILE_NAME,
        McpCapabilityTokenSignature::LegacySha256Dot,
        60,
    )
    .mint_workspace_session_token("workspace-1", "session-1")
    .expect("expected legacy token");
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/workspaces/workspace-1/cowork/sessions/session-1/mcp")
                .header(header::CONTENT_TYPE, "application/json")
                .header(LEGACY_CAPABILITY_HEADER_NAME, legacy_token)
                .body(Body::from(
                    json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize" }).to_string(),
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
    assert_eq!(
        payload["result"]["serverInfo"]["name"],
        "proliferate-cowork"
    );
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
            agent_auth_scope: None,
            required_agent_auth_revision: None,
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
            agent_auth_scope: None,
            required_agent_auth_revision: None,
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
