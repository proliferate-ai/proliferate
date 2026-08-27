use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde_json::json;

use super::{proliferate_home_dir_name, test_support, AppState};
use crate::{
    domains::{
        agent_operations::mcp::auth::WorkspaceMcpAuth, agents::installer::seed::AgentSeedStore,
        sessions::store::SessionStore,
    },
    integrations::mcp::product_server::{ProductMcpAuthHeader, ProductMcpRequestContext},
    persistence::Db,
};

mod completion_delivery_crash_tests;
mod product_mcp_auth_tests;

fn run_git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .expect("spawn git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn init_seed_repository(path: &Path) -> PathBuf {
    fs::create_dir_all(path).expect("create repository path");
    // Canonicalize so seeded repo-root paths match what the workspace runtime
    // resolves from git. On macOS `/tmp` is a symlink into `/private/tmp`,
    // which otherwise hides same-checkout matches that Linux CI sees.
    let path = path.canonicalize().expect("canonicalize repository path");
    run_git(&path, &["init", "-b", "main"]);
    run_git(&path, &["config", "user.email", "workspace@example.com"]);
    run_git(&path, &["config", "user.name", "Workspace Test"]);
    fs::write(path.join("README.md"), "seed\n").expect("write repository seed");
    run_git(&path, &["add", "README.md"]);
    run_git(&path, &["commit", "-m", "seed"]);
    path
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_allows_missing_bearer_token_when_not_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let state = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-no-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");

    assert_eq!(state.bearer_token, None);
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_missing_bearer_token_when_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-required-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        true,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected missing bearer token error");

    assert_eq!(
        error.to_string(),
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_blank_bearer_token_when_required() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(Some("   "));
    let _data_key_guard = test_support::set_data_key_env(None);

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-blank-token"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        true,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected blank bearer token error");

    assert_eq!(
        error.to_string(),
        "ANYHARNESS_BEARER_TOKEN is required when --require-bearer-auth is set, but the \
environment variable is missing or empty. Refusing to start without authentication."
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_rejects_invalid_data_key() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(Some("not-base64"));

    let error = AppState::new(
        PathBuf::from("/tmp/anyharness-app-state-invalid-data-key"),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .err()
    .expect("expected invalid data key error");

    assert!(
        error
            .to_string()
            .starts_with("Invalid ANYHARNESS_DATA_KEY:"),
        "unexpected error: {error}"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_wires_integration_gateway_extension_to_served_runtime_home() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);

    // Regression: the extension used to be constructed with
    // default_runtime_home(), so serving with --runtime-home never picked up
    // the worker-written integration-gateway.json dotfile.
    let runtime_home = PathBuf::from("/tmp/anyharness-app-state-gateway-home");
    let state = AppState::new(
        runtime_home.clone(),
        "http://127.0.0.1:8457".to_string(),
        Db::open_in_memory().expect("expected in-memory db"),
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("expected app state");

    assert_eq!(
        state
            .integration_gateway_session_launch_extension
            .runtime_home(),
        runtime_home.as_path()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn app_state_launches_and_serves_workspace_mcp_for_an_eligible_session() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let runtime_home = PathBuf::from(format!(
        "/tmp/anyharness-workspace-serving-receipt-{}",
        uuid::Uuid::new_v4()
    ));
    let repository_path = init_seed_repository(&PathBuf::from(format!(
        "/tmp/anyharness-workspace-serving-repo-{}",
        uuid::Uuid::new_v4()
    )));
    let second_repository_path = init_seed_repository(&PathBuf::from(format!(
        "/tmp/anyharness-workspace-serving-repo-2-{}",
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
    test_support::seed_scripted_claude_launch_options(&state.launch_options_service);
    test_support::seed_workspace_with_repo_root(
        &state.db,
        "workspace-1",
        "local",
        &repository_path.to_string_lossy(),
    );
    // The create probe targets a second repository: workspace-1 is an active
    // local workspace at the first checkout, and the duplicate-local gate
    // rejects a second local workspace at a checkout an active one owns.
    test_support::seed_repo_root(
        &state.db,
        "repo-root-2",
        &second_repository_path.to_string_lossy(),
    );
    test_support::insert_session_row(
        &SessionStore::new(state.db.clone()),
        "workspace-1",
        "session-1",
        "idle",
    );

    let endpoint = state
        .product_mcp_endpoint_registry
        .get_by_route_slug("workspace")
        .expect("Workspace serving endpoint");
    assert_eq!(
        state.session_runtime.product_mcp_launch_ids(),
        ["workspace", "reviews", "cowork"]
    );
    let auth = WorkspaceMcpAuth::new(runtime_home.clone());
    let token = auth
        .mint_capability_token("workspace-1", "session-1")
        .expect("mint explicit Workspace capability");
    let context =
        ProductMcpRequestContext::new("workspace-1", "session-1", endpoint.definition().id);
    assert!(endpoint
        .validate_capability_token(ProductMcpAuthHeader::Product { value: &token }, &context,)
        .expect("validate explicit Workspace capability")
        .is_valid());
    let created = endpoint
        .dispatch(
            context,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "create_workspace",
                    "arguments": {
                        "repositoryId": "repo-root-2",
                        "creationMode": "local",
                        "displayName": "Created by agent"
                    }
                }
            }),
        )
        .await
        .expect("dispatch Workspace endpoint")
        .expect("Workspace response");
    assert_eq!(
        created["result"]["structuredContent"]["workspace"]["kind"],
        "local"
    );
    let created_workspace = &created["result"]["structuredContent"]["workspace"];
    assert_eq!(created_workspace["origin"]["kind"], "system");
    assert_eq!(created_workspace["origin"]["entrypoint"], "local_runtime");
    assert_eq!(created_workspace["creatorContext"]["kind"], "agent");
    assert_eq!(
        created_workspace["creatorContext"]["sourceSessionId"],
        "session-1"
    );
    assert_eq!(
        created_workspace["creatorContext"]["sourceSessionWorkspaceId"],
        "workspace-1"
    );
    let created_workspace_id = created_workspace["identity"]["workspaceId"]
        .as_str()
        .expect("created workspace id")
        .to_string();
    let durable_created = state
        .workspace_runtime
        .get_workspace(&created_workspace_id)
        .expect("read durable created workspace")
        .expect("durable created workspace");
    assert_eq!(
        created_workspace["origin"],
        serde_json::to_value(
            durable_created
                .origin
                .as_ref()
                .expect("durable created origin")
                .to_contract()
        )
        .expect("serialize user API origin")
    );
    assert_eq!(
        created_workspace["creatorContext"],
        serde_json::to_value(
            durable_created
                .creator_context
                .as_ref()
                .expect("durable created context")
                .to_contract()
        )
        .expect("serialize user API creator context")
    );
    let listed = endpoint
        .dispatch(
            ProductMcpRequestContext::new("workspace-1", "session-1", endpoint.definition().id),
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": { "name": "list_workspaces", "arguments": {} }
            }),
        )
        .await
        .expect("dispatch Workspace list")
        .expect("Workspace list response");
    let listed_workspaces = listed["result"]["structuredContent"]["workspaces"]
        .as_array()
        .expect("workspace list");
    assert_eq!(listed_workspaces.len(), 2);
    assert!(listed_workspaces
        .iter()
        .any(|workspace| { workspace["identity"]["workspaceId"] == "workspace-1" }));
    let listed_created = listed_workspaces
        .iter()
        .find(|workspace| workspace["identity"]["workspaceId"] == created_workspace_id)
        .expect("created workspace in MCP list");
    assert_eq!(listed_created["origin"], created_workspace["origin"]);
    assert_eq!(
        listed_created["creatorContext"],
        created_workspace["creatorContext"]
    );

    let workspace_options = endpoint
        .dispatch(
            ProductMcpRequestContext::new("workspace-1", "session-1", endpoint.definition().id),
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": { "name": "list_workspace_options", "arguments": {} }
            }),
        )
        .await
        .expect("dispatch Workspace options")
        .expect("Workspace options response");
    let repository = workspace_options["result"]["structuredContent"]["repositories"]
        .as_array()
        .expect("repository options")
        .iter()
        .find(|repository| repository["repositoryId"] == "repo-root-workspace-1")
        .expect("seeded repository option");
    assert_eq!(repository["availability"]["state"], "present");
    let creation_modes = workspace_options["result"]["structuredContent"]["creationModes"]
        .as_array()
        .expect("creation modes");
    assert!(creation_modes.iter().any(|mode| mode["mode"] == "worktree"));
    assert!(creation_modes.iter().any(|mode| mode["mode"] == "local"));

    let launch_options = endpoint
        .dispatch(
            ProductMcpRequestContext::new("workspace-1", "session-1", endpoint.definition().id),
            json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "list_agent_launch_options",
                    "arguments": { "workspaceId": "workspace-1" }
                }
            }),
        )
        .await
        .expect("dispatch agent launch options")
        .expect("agent launch options response");
    assert_eq!(
        launch_options["result"]["structuredContent"]["workspace"]["workspaceId"],
        "workspace-1"
    );
    let observed_claude = launch_options["result"]["structuredContent"]["launchOptions"]
        .as_array()
        .expect("target-observed launch options")
        .iter()
        .find(|response| response["harnessKind"] == "claude")
        .expect("seeded Claude launch options")
        .clone();
    assert_eq!(observed_claude["state"], "observed");
    assert!(observed_claude["options"]["models"]
        .as_array()
        .is_some_and(|models| models.iter().any(|model| model["id"] == "haiku")));
    assert!(
        launch_options["result"]["structuredContent"]["presentation"]
            .as_array()
            .is_some_and(|harnesses| harnesses
                .iter()
                .any(|harness| harness["harnessKind"] == "claude"))
    );

    let config_options = endpoint
        .dispatch(
            ProductMcpRequestContext::new("workspace-1", "session-1", endpoint.definition().id),
            json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "list_agent_config_options",
                    "arguments": { "agentId": "session-1" }
                }
            }),
        )
        .await
        .expect("dispatch agent config options")
        .expect("agent config options response");
    assert_eq!(
        config_options["result"]["structuredContent"]["agent"]["sessionId"],
        "session-1"
    );
    assert_eq!(
        config_options["result"]["structuredContent"]["workspace"]["workspaceId"],
        "workspace-1"
    );
    assert!(!state
        .agent_operations
        .runtime_identity()
        .as_str()
        .contains("/tmp/"));
    let _ = fs::remove_dir_all(repository_path);
    let _ = fs::remove_dir_all(second_repository_path);
    let _ = fs::remove_dir_all(runtime_home);
}

#[test]
fn proliferate_home_dir_name_uses_local_dir_for_debug_builds() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(None);

    assert_eq!(proliferate_home_dir_name(true), ".proliferate-local");
}

#[test]
fn proliferate_home_dir_name_uses_local_dir_when_env_is_set() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(Some("1"));

    assert_eq!(proliferate_home_dir_name(false), ".proliferate-local");
}

#[test]
fn proliferate_home_dir_name_uses_production_dir_for_release_without_env() {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("expected env mutex");
    let _dev_guard = test_support::set_proliferate_dev_env(None);

    assert_eq!(proliferate_home_dir_name(false), ".proliferate");
}
