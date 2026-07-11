use std::path::PathBuf;
use std::sync::Mutex;

use anyharness_contract::v1::{
    ExecutionBinding, RepositoryObjectFormat, SchemaVersion, SourceKind, WorkflowTarget,
};
use uuid::Uuid;

use crate::app::{test_support, AppState};
use crate::domains::agents::installer::seed::AgentSeedStore;
use crate::domains::workflows::delivery::{content_hash_excluding, DeliveryIdentity};
use crate::domains::workflows::service::WorkflowServiceError;
use crate::persistence::Db;

#[derive(Debug, PartialEq, Eq)]
struct SideEffects {
    runs: i64,
    steps: i64,
    observations: i64,
    effects: i64,
    sessions: i64,
}

fn state() -> AppState {
    let _lock = test_support::ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("environment lock");
    let _bearer_guard = test_support::set_bearer_token_env(None);
    let _data_key_guard = test_support::set_data_key_env(None);
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    AppState::new(
        PathBuf::from(format!("/tmp/anyharness-wf-id-{}", Uuid::new_v4())),
        "http://127.0.0.1:8457".to_string(),
        db,
        false,
        AgentSeedStore::not_configured_dev(),
    )
    .expect("build app state")
}

fn side_effects(state: &AppState) -> SideEffects {
    state
        .db
        .with_conn(|conn| {
            Ok(SideEffects {
                runs: conn.query_row("SELECT COUNT(*) FROM workflow_runs", [], |row| row.get(0))?,
                steps: conn.query_row("SELECT COUNT(*) FROM workflow_step_runs", [], |row| {
                    row.get(0)
                })?,
                observations: conn.query_row(
                    "SELECT COUNT(*) FROM workflow_observations",
                    [],
                    |row| row.get(0),
                )?,
                effects: conn.query_row("SELECT COUNT(*) FROM workflow_effects", [], |row| {
                    row.get(0)
                })?,
                sessions: conn.query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?,
            })
        })
        .expect("count workflow side effects")
}

fn valid_delivery() -> (String, DeliveryIdentity, ExecutionBinding) {
    const RUN_ID: &str = "11111111-1111-4111-8111-111111111111";
    const WORKFLOW_ID: &str = "22222222-2222-4222-8222-222222222222";
    const VERSION_ID: &str = "33333333-3333-4333-8333-333333333333";
    const COMMIT: &str = "1111111111111111111111111111111111111111";
    let mut plan = serde_json::json!({
        "planVersion": 1,
        "planHash": "",
        "run_id": RUN_ID,
        "workflow_id": WORKFLOW_ID,
        "workflow_version_id": VERSION_ID,
        "version_n": 1,
        "trigger_kind": "manual",
        "target_mode": "local",
        "sourceIntent": {"kind": "local_commit", "resolvedCommit": COMMIT},
        "isolation": "workspace",
        "sessions": {},
        "inputs": {},
        "steps": []
    });
    let plan_hash = content_hash_excluding(&plan, "planHash").unwrap();
    plan["planHash"] = serde_json::Value::String(plan_hash.clone());
    let mut binding = ExecutionBinding {
        schema_version: SchemaVersion::<1>,
        target: WorkflowTarget::Local,
        source_kind: SourceKind::LocalCommit,
        repository_object_format: RepositoryObjectFormat::Sha1,
        base_commit_oid: COMMIT.to_string(),
        checkpoint_id: None,
        checkpoint_content_hash: None,
        workspace_id: "workspace-1".to_string(),
        workspace_generation: 1,
        materialization_id: "materialization-1".to_string(),
        executor_id: "executor-1".to_string(),
        executor_generation: 1,
        binding_hash: String::new(),
    };
    let value = serde_json::to_value(&binding).unwrap();
    binding.binding_hash = content_hash_excluding(&value, "bindingHash").unwrap();
    let identity = DeliveryIdentity {
        run_id: RUN_ID.to_string(),
        plan_hash,
        binding_hash: binding.binding_hash.clone(),
        execution_generation: 1,
    };
    (serde_json::to_string(&plan).unwrap(), identity, binding)
}

#[tokio::test(flavor = "current_thread")]
async fn valid_preflight_has_zero_persistence_or_runtime_side_effects() {
    let state = state();
    let before = side_effects(&state);
    let (plan, identity, binding) = valid_delivery();
    state
        .workflow_manager
        .preflight_delivery(&plan, "workspace-1", 1, &identity, &binding)
        .expect("identity preflight");
    assert_eq!(side_effects(&state), before);
    assert!(state
        .workflow_manager
        .get_run("11111111-1111-4111-8111-111111111111")
        .unwrap()
        .is_none());
}

fn seed_historical_run(state: &AppState, status: &str) {
    state
        .db
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO workflow_runs (
                run_id, workspace_id, plan_json, plan_hash, binding_hash,
                execution_generation, status, step_cursor, created_at, updated_at
             ) VALUES (?1, 'workspace-1', '{}', ?2, ?3, 1, ?4, 0, ?5, ?5)",
                rusqlite::params![
                    "historical-run",
                    format!("sha256:{}", "a".repeat(64)),
                    format!("sha256:{}", "b".repeat(64)),
                    status,
                    "2026-07-11T00:00:00Z",
                ],
            )?;
            Ok(())
        })
        .expect("seed historical workflow run");
}

#[tokio::test]
async fn startup_pass_keeps_complete_legacy_running_row_parked() {
    let state = state();
    seed_historical_run(&state, "running");
    let before = side_effects(&state);
    state.workflow_manager.clone().spawn_startup_pass();
    tokio::task::yield_now().await;
    tokio::task::yield_now().await;
    assert_eq!(side_effects(&state), before);
    let run = state
        .workflow_manager
        .get_run("historical-run")
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(
        run.status,
        anyharness_contract::v1::WorkflowRunStatus::Running
    );
    assert!(run.session_ids.is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn approval_recovery_gate_has_zero_mutation_after_identity_commit() {
    let state = state();
    seed_historical_run(&state, "waiting_approval");
    let before = side_effects(&state);
    assert!(matches!(
        state
            .workflow_manager
            .resolve_approval("historical-run", true),
        Err(WorkflowServiceError::FinalEnvelopeRequired)
    ));
    assert_eq!(side_effects(&state), before);
    let run = state
        .workflow_manager
        .get_run("historical-run")
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(
        run.status,
        anyharness_contract::v1::WorkflowRunStatus::WaitingApproval
    );
}

#[tokio::test(flavor = "current_thread")]
async fn cancel_gate_has_zero_mutation_for_unproven_nonterminal_row() {
    let state = state();
    seed_historical_run(&state, "running");
    let before = side_effects(&state);
    assert!(matches!(
        state.workflow_manager.cancel("historical-run").await,
        Err(WorkflowServiceError::FinalEnvelopeRequired)
    ));
    assert_eq!(side_effects(&state), before);
    let run = state
        .workflow_manager
        .get_run("historical-run")
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(
        run.status,
        anyharness_contract::v1::WorkflowRunStatus::Running
    );
}

#[test]
fn manager_source_contains_no_actor_activation_edge() {
    let source = include_str!("manager.rs");
    assert!(!source.contains("spawn_actor"));
    assert!(!source.contains("drive_run("));
    assert!(!source.contains("create_run_with_identity("));
}
