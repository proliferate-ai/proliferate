//! Tier-1 tests for the gen-2 workflow-runs routes: a real router over a real
//! `AppState`, real SQLite, a real git repository placed through the real
//! workspace seam, and the house scripted ACP agent behind the sessions the
//! actor launches. Requests go through tower `oneshot` exactly as production
//! serves them.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use axum::body::{to_bytes, Body};
use axum::http::{header, Method, Request, StatusCode};
use serde_json::{json, Value};
use tower::util::ServiceExt;

use super::router::build_router;
use crate::app::{test_support, AppState};
use crate::domains::repo_roots::model::CreateRepoRootInput;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, temp_runtime_home, write_scripted_agent,
    EnvVarGuard, ScriptedAgent,
};
use crate::domains::workflows::model::{WorkflowNodeStatus, WorkflowRunStatus};
use crate::domains::workspaces::managed_root::{
    canonical_managed_worktrees_root, ANYHARNESS_WORKTREES_ROOT_ENV,
};
use crate::persistence::Db;

/// Set-and-restore for env vars the fixture must pin but `EnvVarGuard` (which
/// is constructor-private to the scripted-agent module) does not cover.
struct PinnedEnvVar {
    name: &'static str,
    previous: Option<std::ffi::OsString>,
}

impl PinnedEnvVar {
    fn set(name: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let previous = std::env::var_os(name);
        std::env::set_var(name, value);
        Self { name, previous }
    }
}

impl Drop for PinnedEnvVar {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var(self.name, value),
            None => std::env::remove_var(self.name),
        }
    }
}

struct RouteFixture {
    state: AppState,
    script: ScriptedAgent,
    repo_root_id: String,
    runtime_home: PathBuf,
    _worktrees_root: PinnedEnvVar,
    _agent_env: (EnvVarGuard, EnvVarGuard),
    _data_key: test_support::DataKeyEnvGuard,
    _bearer: test_support::BearerTokenEnvGuard,
    _env_lock: std::sync::MutexGuard<'static, ()>,
}

impl Drop for RouteFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.runtime_home);
    }
}

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "wf2")
        .env("GIT_AUTHOR_EMAIL", "wf2@test")
        .env("GIT_COMMITTER_NAME", "wf2")
        .env("GIT_COMMITTER_EMAIL", "wf2@test")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn fixture(label: &str) -> RouteFixture {
    let env_lock = test_support::lock_env();
    let bearer = test_support::set_bearer_token_env(None);
    let data_key = test_support::set_data_key_env(None);
    let runtime_home = temp_runtime_home(label);
    let script = write_scripted_agent(&runtime_home);
    let agent_env = install_scripted_agent_env(&script);
    // Pin the managed worktrees root inside this fixture's temp tree so the
    // deterministic `<root>/workflows/<run_id>` paths never leak outside it.
    let worktrees_root = runtime_home.join("worktrees");
    std::fs::create_dir_all(&worktrees_root).expect("worktrees root");
    let worktrees_root = PinnedEnvVar::set(ANYHARNESS_WORKTREES_ROOT_ENV, &worktrees_root);

    let db = Db::open_in_memory().expect("in-memory db");
    let state = build_state(&runtime_home, db, false);

    // A real repository with one commit: the placement seam resolves the base
    // OID from it and cuts the run worktree.
    let repo_dir = runtime_home.join("origin-repo");
    std::fs::create_dir_all(&repo_dir).expect("repo dir");
    git(&repo_dir, &["init", "-b", "main"]);
    std::fs::write(repo_dir.join("README.md"), "# wf2\n").expect("seed file");
    git(&repo_dir, &["add", "."]);
    git(&repo_dir, &["commit", "-m", "initial"]);
    let repo_root = state
        .repo_root_service
        .ensure_repo_root(CreateRepoRootInput {
            kind: "local".into(),
            path: repo_dir.to_string_lossy().to_string(),
            display_name: None,
            default_branch: Some("main".into()),
            remote_provider: None,
            remote_owner: None,
            remote_repo_name: None,
            remote_url: None,
        })
        .expect("repo root");

    RouteFixture {
        state,
        script,
        repo_root_id: repo_root.id,
        runtime_home,
        _worktrees_root: worktrees_root,
        _agent_env: agent_env,
        _data_key: data_key,
        _bearer: bearer,
        _env_lock: env_lock,
    }
}

impl RouteFixture {
    async fn request(&self, method: Method, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        let request = match body {
            Some(body) => request
                .body(Body::from(serde_json::to_vec(&body).expect("body")))
                .expect("request"),
            None => request.body(Body::empty()).expect("request"),
        };
        let response = build_router(self.state.clone())
            .oneshot(request)
            .await
            .expect("response");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body bytes");
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).expect("json body")
        };
        (status, value)
    }

    fn snapshot(&self, definition: Value) -> Value {
        json!({
            "schemaVersion": 2,
            "workflowDefinitionId": "wd-route",
            "definition": definition,
            "arguments": {},
            "placement": { "repoConfigId": self.repo_root_id, "mode": "worktree" },
        })
    }

    async fn wait_for_run(
        &self,
        run_id: &str,
        what: &str,
        condition: impl Fn(&crate::domains::workflows::transition::RunState) -> bool,
    ) {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        loop {
            let state = self
                .state
                .workflow_store
                .load_run_state(run_id)
                .expect("load run state")
                .expect("run exists");
            if condition(&state) {
                return;
            }
            if tokio::time::Instant::now() > deadline {
                panic!(
                    "timed out waiting for {what}; run={:?} nodes={:?}",
                    state.run.status,
                    state
                        .nodes
                        .iter()
                        .map(|node| (node.definition_node_id.clone(), node.status))
                        .collect::<Vec<_>>()
                );
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn wait_for_control(&self, name: &str) {
        let path = self.script.control_dir.join(name);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        while !path.exists() {
            if tokio::time::Instant::now() > deadline {
                panic!("timed out waiting for scripted-agent control file {name}");
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    fn touch_control(&self, name: &str) {
        std::fs::write(self.script.control_dir.join(name), "").expect("control file");
    }
}

fn single_node_definition(prompt: &str) -> Value {
    json!({
        "schemaVersion": 2,
        "nodes": [
            { "id": "solo", "type": "agent", "title": "Solo", "prompt": prompt }
        ],
        "edges": [],
        "inputs": [],
        "docTemplates": [
            { "slug": "notes", "producingNodeId": "solo", "body": "# Notes\n" }
        ],
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn put_places_a_run_idempotently_and_the_wire_shape_holds() {
    let fixture = fixture("wf-route-put");
    let body = fixture.snapshot(single_node_definition("blocking turn"));

    let (status, projection) = fixture
        .request(Method::PUT, "/v1/workflow-runs/run-route", Some(body.clone()))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");

    // The wire contract, field-for-field: `{ run, nodes[], docs[] }`,
    // camelCase, RAW definition/arguments strings, explicit nulls.
    assert_eq!(projection["run"]["id"], "run-route");
    assert_eq!(projection["run"]["invocationId"], "run-route");
    assert_eq!(projection["run"]["status"], "running");
    assert!(projection["run"]["definitionJson"].is_string());
    assert!(projection["run"]["argumentsJson"].is_string());
    assert!(projection["run"]["completedAt"].is_null());
    assert_eq!(projection["nodes"][0]["runId"], "run-route");
    assert_eq!(projection["nodes"][0]["definitionNodeId"], "solo");
    assert!(projection["nodes"][0].get("promptId").is_some());
    assert_eq!(projection["docs"][0]["runId"], "run-route");
    assert_eq!(projection["docs"][0]["filename"], "00-notes.md");

    // Disk before rows: the run worktree exists under the managed root with
    // the seeded context doc and the shared exclude entry.
    let managed_root =
        canonical_managed_worktrees_root(&fixture.runtime_home).expect("root");
    let workspace_root = managed_root.join("workflows/run-route");
    assert!(workspace_root.is_dir(), "run worktree materialized");
    let seeded = workspace_root.join(".proliferate/context/00-notes.md");
    assert_eq!(
        std::fs::read_to_string(&seeded).expect("seeded doc"),
        "# Notes\n"
    );
    let exclude = std::fs::read_to_string(
        fixture.runtime_home.join("origin-repo/.git/info/exclude"),
    )
    .expect("exclude file");
    assert!(exclude.lines().any(|line| line.trim() == "/.proliferate/"));

    // The node is holding its turn; the idempotent replay returns the same
    // run untouched with a 200 and mints nothing new.
    fixture.wait_for_control("turn-seen").await;
    let (status, replay) = fixture
        .request(Method::PUT, "/v1/workflow-runs/run-route", Some(body))
        .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["run"]["id"], "run-route");
    assert_eq!(replay["run"]["workspaceId"], projection["run"]["workspaceId"]);
    assert_eq!(
        replay["nodes"][0]["id"], projection["nodes"][0]["id"],
        "replay returns the stored rows, not fresh ones"
    );

    fixture.touch_control("release-turn");
    fixture
        .wait_for_run("run-route", "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn put_rejects_an_invalid_snapshot_with_zero_rows() {
    let fixture = fixture("wf-route-invalid");
    let body = fixture.snapshot(json!({
        "schemaVersion": 2,
        "nodes": [
            { "id": "solo", "type": "agent", "title": "Solo", "prompt": "read @doc:ghost" }
        ],
        "edges": [],
        "inputs": [],
        "docTemplates": [],
    }));

    let (status, problem) = fixture
        .request(Method::PUT, "/v1/workflow-runs/run-invalid", Some(body))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_SNAPSHOT_INVALID");

    let (status, problem) = fixture
        .request(Method::GET, "/v1/workflow-runs/run-invalid", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_RUN_NOT_FOUND");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn put_maps_placement_failure_to_503_with_zero_rows() {
    let fixture = fixture("wf-route-503");
    let mut body = fixture.snapshot(single_node_definition("never launches"));
    body["placement"]["repoConfigId"] = json!("ghost-repo-config");

    let (status, problem) = fixture
        .request(Method::PUT, "/v1/workflow-runs/run-unplaceable", Some(body))
        .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_WORKSPACE_MATERIALIZATION_FAILED");

    let (status, _) = fixture
        .request(Method::GET, "/v1/workflow-runs/run-unplaceable", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "zero rows inserted");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reads_project_from_rows_and_the_list_envelope_filters() {
    let fixture = fixture("wf-route-reads");
    let (status, problem) = fixture
        .request(Method::GET, "/v1/workflow-runs/run-missing", None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_RUN_NOT_FOUND");

    let body = fixture.snapshot(single_node_definition("blocking turn"));
    let (status, projection) = fixture
        .request(Method::PUT, "/v1/workflow-runs/run-listed", Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");
    let workspace_id = projection["run"]["workspaceId"].as_str().expect("workspace id");

    let (status, fetched) = fixture
        .request(Method::GET, "/v1/workflow-runs/run-listed", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fetched["run"]["id"], "run-listed");

    let (status, listed) = fixture
        .request(
            Method::GET,
            &format!("/v1/workflow-runs?workspace_id={workspace_id}"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed["runs"][0]["id"], "run-listed");

    let (status, empty) = fixture
        .request(Method::GET, "/v1/workflow-runs?workspace_id=elsewhere", None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(empty["runs"].as_array().map(Vec::len), Some(0));

    fixture.wait_for_control("turn-seen").await;
    fixture.touch_control("release-turn");
    fixture
        .wait_for_run("run-listed", "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn commands_return_projections_and_map_the_error_codes() {
    let fixture = fixture("wf-route-commands");
    let body = fixture.snapshot(json!({
        "schemaVersion": 2,
        "nodes": [
            { "id": "review", "type": "human_in_loop", "title": "Review", "prompt": "summarize" },
            { "id": "ship", "type": "agent", "title": "Ship", "prompt": "ship it" }
        ],
        "edges": [ { "from": "review", "to": "ship" } ],
        "inputs": [],
        "docTemplates": [],
    }));
    let (status, projection) = fixture
        .request(Method::PUT, "/v1/workflow-runs/run-cmd", Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{projection}");

    // Commands on ghosts: unknown run 404s with the run code, unknown node
    // 404s with the node code.
    let (status, problem) = fixture
        .request(
            Method::POST,
            "/v1/workflow-runs/run-ghost/nodes/whatever/approve",
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_RUN_NOT_FOUND");
    let (status, problem) = fixture
        .request(
            Method::POST,
            "/v1/workflow-runs/run-cmd/nodes/ghost-node/approve",
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(problem["code"], "WORKFLOW_NODE_NOT_FOUND");

    fixture
        .wait_for_run("run-cmd", "gate parks", |state| {
            state.run.status == WorkflowRunStatus::AwaitingHuman
        })
        .await;
    let state = fixture
        .state
        .workflow_store
        .load_run_state("run-cmd")
        .expect("load")
        .expect("run");
    let gate = state
        .nodes
        .iter()
        .find(|node| node.definition_node_id.as_deref() == Some("review"))
        .expect("gate row");
    assert_eq!(gate.status, WorkflowNodeStatus::AwaitingHuman);

    // Approve answers with the fresh projection: the gate is completed in the
    // response body itself, no follow-up read.
    let (status, projection) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/run-cmd/nodes/{}/approve", gate.id),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{projection}");
    let approved = projection["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .find(|node| node["id"] == json!(gate.id))
        .expect("gate in projection");
    assert_eq!(approved["status"], "completed");

    // A second approve is the transition table's refusal: 409 naming the
    // command and the state it was refused in.
    let (status, problem) = fixture
        .request(
            Method::POST,
            &format!("/v1/workflow-runs/run-cmd/nodes/{}/approve", gate.id),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{problem}");
    assert_eq!(problem["code"], "WORKFLOW_TRANSITION_ILLEGAL");
    let detail = problem["detail"].as_str().expect("detail");
    assert!(detail.contains("approve_gate"), "{detail}");

    fixture
        .wait_for_run("run-cmd", "run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}
