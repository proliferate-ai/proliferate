//! WS5a tests: strict delivery-identity acceptance, the durable observation
//! outbox (append/ACK/replay ordering, whole-snapshot ObservedRun revisions),
//! attempt durability, and restart rehydration (T1-WF-RUNTIME-01 groundwork).

use std::collections::VecDeque;
use std::sync::Mutex;

use anyharness_contract::v1::workflows_v2::{ObservedRun, ObservedStepStatus};
use anyharness_contract::v1::{WorkflowRunStatus, WorkflowStepStatus};

use super::engine::{CancelToken, StepExecContext, StepOutcome, WorkflowStepExecutor};
use super::model::WorkflowObservationRecord;
use super::plan::PlanStep;
use super::service::{WorkflowService, WorkflowServiceError};
use super::store::WorkflowStore;
use crate::app::test_support;
use crate::persistence::Db;

fn service_on(db: &Db) -> WorkflowService {
    WorkflowService::new(WorkflowStore::new(db.clone()))
}

fn test_service() -> WorkflowService {
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/workspace-1");
    service_on(&db)
}

/// A two-step plan carrying the full delivery identity (spec §5.3).
fn identity_plan(plan_hash: &str, binding_hash: &str, generation: i64) -> String {
    format!(
        r#"{{
            "run_id": "run-1",
            "plan_hash": "{plan_hash}",
            "binding_hash": "{binding_hash}",
            "execution_generation": {generation},
            "sessions": {{ "main": {{ "harness": "claude", "session_binding": "fresh" }} }},
            "steps": [
                {{ "key": "0.-.0", "slot": "main", "kind": "shell.run", "command": "a" }},
                {{ "key": "0.-.1", "slot": "main", "kind": "shell.run", "command": "b" }}
            ]
        }}"#
    )
}

fn legacy_plan(run_id: &str) -> String {
    format!(
        r#"{{
            "run_id": "{run_id}",
            "sessions": {{ "main": {{ "harness": "claude", "session_binding": "fresh" }} }},
            "steps": [
                {{ "key": "0.-.0", "slot": "main", "kind": "shell.run", "command": "a" }},
                {{ "key": "0.-.1", "slot": "main", "kind": "shell.run", "command": "b" }}
            ]
        }}"#
    )
}

struct ScriptedExecutor {
    outcomes: Mutex<VecDeque<StepOutcome>>,
}

impl ScriptedExecutor {
    fn script(outcomes: Vec<StepOutcome>) -> Self {
        Self {
            outcomes: Mutex::new(outcomes.into_iter().collect()),
        }
    }
}

#[async_trait::async_trait]
impl WorkflowStepExecutor for ScriptedExecutor {
    async fn execute_step(&self, _step: &PlanStep, _ctx: &StepExecContext) -> StepOutcome {
        self.outcomes
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(StepOutcome::Completed {
                output: serde_json::json!({}),
            })
    }
}

fn parse_snapshot(record: &WorkflowObservationRecord) -> ObservedRun {
    serde_json::from_str(&record.canonical_snapshot_json)
        .expect("outbox rows hold valid ObservedRun v2 snapshots")
}

// ---------------------------------------------------------------------------
// Strict acceptance (spec §5.3)
// ---------------------------------------------------------------------------

#[test]
fn identity_fields_are_persisted_on_the_run() {
    let service = test_service();
    let (run, created) = service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 1), "workspace-1")
        .expect("create");
    assert!(created);
    assert_eq!(run.plan_hash.as_deref(), Some("sha256:aaa"));
    assert_eq!(run.binding_hash.as_deref(), Some("sha256:bbb"));
    assert_eq!(run.execution_generation, Some(1));
}

#[test]
fn redelivery_with_the_same_identity_is_idempotent() {
    let service = test_service();
    let plan = identity_plan("sha256:aaa", "sha256:bbb", 1);
    let (_, created) = service.create_run_idempotent(&plan, "workspace-1").expect("create");
    assert!(created);
    let (run, created_again) = service
        .create_run_idempotent(&plan, "workspace-1")
        .expect("redeliver");
    assert!(!created_again, "same complete identity is idempotent");
    assert_eq!(run.run_id, "run-1");
    // The idempotent redelivery appended no extra observation.
    assert_eq!(
        service.replay_observations_from("run-1", 1).expect("replay").len(),
        1
    );
}

#[test]
fn conflicting_plan_hash_is_rejected() {
    let service = test_service();
    service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 1), "workspace-1")
        .expect("create");
    let error = service
        .create_run_idempotent(&identity_plan("sha256:DIFFERENT", "sha256:bbb", 1), "workspace-1")
        .expect_err("conflicting plan_hash must reject");
    assert!(matches!(
        error,
        WorkflowServiceError::DeliveryIdentityConflict { field: "plan_hash" }
    ));
}

#[test]
fn conflicting_binding_hash_and_generation_are_rejected() {
    let service = test_service();
    service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 1), "workspace-1")
        .expect("create");
    let error = service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:OTHER", 1), "workspace-1")
        .expect_err("conflicting binding_hash must reject");
    assert!(matches!(
        error,
        WorkflowServiceError::DeliveryIdentityConflict { field: "binding_hash" }
    ));
    let error = service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 2), "workspace-1")
        .expect_err("conflicting generation must reject");
    assert!(matches!(
        error,
        WorkflowServiceError::DeliveryIdentityConflict {
            field: "execution_generation"
        }
    ));
}

#[test]
fn conflict_rejection_leaves_the_stored_run_untouched() {
    let service = test_service();
    service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 1), "workspace-1")
        .expect("create");
    let _ = service
        .create_run_idempotent(&identity_plan("sha256:x", "sha256:bbb", 1), "workspace-1")
        .expect_err("conflict");
    let run = service.get_run("run-1").expect("get").expect("run exists");
    assert_eq!(run.plan_hash.as_deref(), Some("sha256:aaa"));
    // No observation was appended by the rejected delivery.
    assert_eq!(
        service.replay_observations_from("run-1", 1).expect("replay").len(),
        1
    );
}

#[test]
fn legacy_plans_without_identity_stay_idempotent_and_unasserted() {
    // DENY-PATH: a legacy delivery (no identity fields) keeps today's exact
    // behavior — idempotent on run_id, nothing asserted, nothing rejected.
    let service = test_service();
    let plan = legacy_plan("run-legacy");
    let (run, created) = service.create_run_idempotent(&plan, "workspace-1").expect("create");
    assert!(created);
    assert_eq!(run.plan_hash, None);
    assert_eq!(run.binding_hash, None);
    assert_eq!(run.execution_generation, None);
    let (_, created_again) = service
        .create_run_idempotent(&plan, "workspace-1")
        .expect("legacy redelivery");
    assert!(!created_again);
    // A later identity-bearing delivery against a stored LEGACY run asserts
    // nothing either (absent stored side): WS2c owns the backfill story.
    let with_identity = identity_plan("sha256:aaa", "sha256:bbb", 1)
        .replace("\"run_id\": \"run-1\"", "\"run_id\": \"run-legacy\"");
    let (_, created_third) = service
        .create_run_idempotent(&with_identity, "workspace-1")
        .expect("identity-vs-legacy is not a conflict");
    assert!(!created_third);
}

// ---------------------------------------------------------------------------
// Observation outbox ordering (spec §5.4)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn revisions_are_strictly_sequential_whole_snapshots() {
    let service = test_service();
    service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 1), "workspace-1")
        .expect("create");
    let executor = ScriptedExecutor::script(vec![]);
    let cancel = CancelToken::new();
    let progress =
        crate::live::workflows::actor::drive_run(&service, &executor, "run-1", &cancel).await;
    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );

    let rows = service.replay_observations_from("run-1", 1).expect("replay");
    assert!(!rows.is_empty());
    // Strictly sequential: 1..=N with no skips, in order.
    for (idx, row) in rows.iter().enumerate() {
        assert_eq!(row.revision, idx as i64 + 1, "no skipped/reordered revisions");
        let snapshot = parse_snapshot(row);
        assert_eq!(snapshot.revision, row.revision, "snapshot self-describes its revision");
        assert_eq!(snapshot.run_id, "run-1");
        assert_eq!(snapshot.plan_hash, "sha256:aaa");
        assert_eq!(snapshot.binding_hash, "sha256:bbb");
        assert_eq!(snapshot.execution_generation, 1);
    }
    // Revision 1 observes the accepted delivery: both steps pending, cursor at
    // the first step's stable key.
    let first = parse_snapshot(&rows[0]);
    assert_eq!(first.observed_state, "running");
    assert_eq!(first.global_cursor, "0.-.0");
    assert_eq!(first.steps.len(), 2);
    assert!(first
        .steps
        .iter()
        .all(|step| step.status == ObservedStepStatus::Pending));
    assert_eq!(first.steps[0].step_key, "0.-.0");
    assert_eq!(first.steps[1].step_key, "0.-.1");
    // The terminal revision observes the completed run past the plan end.
    let last = parse_snapshot(rows.last().unwrap());
    assert_eq!(last.observed_state, "completed");
    assert_eq!(last.quiescence_state, "quiescent");
    assert_eq!(last.global_cursor, "end");
    assert!(last
        .steps
        .iter()
        .all(|step| step.status == ObservedStepStatus::Completed));
    assert!(last.steps.iter().all(|step| step.attempt == 1));
}

#[tokio::test]
async fn reporter_seam_walks_lowest_unacked_in_order_and_replay_is_identical_bytes() {
    let service = test_service();
    service
        .create_run_idempotent(&identity_plan("sha256:aaa", "sha256:bbb", 1), "workspace-1")
        .expect("create");
    let executor = ScriptedExecutor::script(vec![]);
    let cancel = CancelToken::new();
    crate::live::workflows::actor::drive_run(&service, &executor, "run-1", &cancel).await;

    let all = service.replay_observations_from("run-1", 1).expect("replay");
    let total = all.len() as i64;

    // get_next_report returns revisions 1..N in order as each is acked.
    let mut reported = Vec::new();
    while let Some(next) = service.get_next_report("run-1").expect("next") {
        // Un-acked retry returns the SAME row (identical canonical bytes).
        let again = service.get_next_report("run-1").expect("next again").unwrap();
        assert_eq!(again.revision, next.revision);
        assert_eq!(again.canonical_snapshot_json, next.canonical_snapshot_json);
        assert!(service.ack_observation("run-1", next.revision).expect("ack"));
        reported.push(next);
    }
    assert_eq!(reported.len() as i64, total);
    for (idx, row) in reported.iter().enumerate() {
        assert_eq!(row.revision, idx as i64 + 1);
    }
    // Duplicate ACK is a no-op, never an error.
    assert!(!service.ack_observation("run-1", 1).expect("duplicate ack"));
    // Replay (post-ACK) returns the identical bytes that were reported, and
    // includes acked rows (reconnect resync reads the durable outbox, not the
    // ack bits).
    let replayed = service.replay_observations_from("run-1", 1).expect("replay");
    assert_eq!(replayed.len(), reported.len());
    for (replayed_row, reported_row) in replayed.iter().zip(&reported) {
        assert_eq!(replayed_row.revision, reported_row.revision);
        assert_eq!(
            replayed_row.canonical_snapshot_json, reported_row.canonical_snapshot_json,
            "replay returns byte-identical snapshots"
        );
        assert!(replayed_row.acked);
    }
    // Replay-from mid-stream honors the inclusive lower bound.
    let tail = service.replay_observations_from("run-1", 3).expect("replay tail");
    assert_eq!(tail.len() as i64, total - 2);
    assert_eq!(tail[0].revision, 3);
}

#[test]
fn duplicate_append_at_the_same_revision_fails() {
    let service = test_service();
    service
        .create_run_idempotent(&legacy_plan("run-dup"), "workspace-1")
        .expect("create");
    // Creation appended revision 1. A manual insert at revision 1 must hit the
    // (run_id, revision) uniqueness constraint — the outbox is immutable.
    let error = service
        .store()
        .with_tx_anyhow(|tx| {
            WorkflowStore::insert_observation_at_revision_tx(
                tx,
                &WorkflowObservationRecord {
                    run_id: "run-dup".to_string(),
                    revision: 1,
                    canonical_snapshot_json: "{}".to_string(),
                    created_at: "2026-07-10T00:00:00Z".to_string(),
                    acked: false,
                },
            )
            .map_err(Into::into)
        })
        .expect_err("duplicate (run_id, revision) must fail");
    assert!(error.to_string().to_lowercase().contains("unique"));
}

#[tokio::test]
async fn attempts_are_durable_before_execution_and_survive_retries() {
    // A retry-twice step: the attempt counter on the step-run row (and in the
    // observed snapshots) must show each attempt was persisted BEFORE the
    // executor ran, and the failing attempts stay visible in the revisions.
    let db = Db::open_in_memory().expect("open db");
    test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/w1");
    let service = service_on(&db);
    let plan = r#"{
        "run_id": "run-retry",
        "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
        "steps": [
            { "key": "0.-.0", "slot": "main", "kind": "shell.run", "command": "flaky",
              "on_fail": { "kind": "retry", "n": 2 } }
        ]
    }"#;
    service.create_run_idempotent(plan, "workspace-1").expect("create");
    let executor = ScriptedExecutor::script(vec![
        StepOutcome::Failed {
            code: "nonzero_exit".to_string(),
            message: None,
            output: None,
        },
        StepOutcome::Failed {
            code: "nonzero_exit".to_string(),
            message: None,
            output: None,
        },
        StepOutcome::Completed {
            output: serde_json::json!({ "ok": true }),
        },
    ]);
    let cancel = CancelToken::new();
    crate::live::workflows::actor::drive_run(&service, &executor, "run-retry", &cancel).await;

    let (_, steps) = service.get_run_with_steps("run-retry").expect("get").expect("run");
    assert_eq!(steps[0].attempt, 3, "third attempt succeeded");
    assert_eq!(steps[0].status, WorkflowStepStatus::Completed);

    // The outbox observed every attempt's begin_step (attempt stamped while the
    // step was running — i.e. persisted before the executor's outcome landed).
    let rows = service.replay_observations_from("run-retry", 1).expect("replay");
    let running_attempts: Vec<i64> = rows
        .iter()
        .map(parse_snapshot)
        .filter(|snapshot| snapshot.steps[0].status == ObservedStepStatus::Running)
        .map(|snapshot| snapshot.steps[0].attempt)
        .collect();
    assert_eq!(running_attempts, vec![1, 2, 3]);
}

// ---------------------------------------------------------------------------
// Restart rehydration (reopen the store on the same SQLite file)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn restart_rehydration_reconstructs_cursor_attempts_sessions_and_outbox() {
    let home = std::env::temp_dir().join(format!("anyharness-ws5a-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&home).expect("mkdir");

    let plan = r#"{
        "run_id": "run-restart",
        "plan_hash": "sha256:ph",
        "binding_hash": "sha256:bh",
        "execution_generation": 1,
        "sessions": { "main": { "harness": "claude", "session_binding": "fresh" } },
        "steps": [
            { "key": "0.-.0", "slot": "main", "kind": "shell.run", "command": "a" },
            { "key": "0.-.1", "slot": "main", "kind": "shell.run", "command": "b" },
            { "key": "0.-.2", "slot": "main", "kind": "shell.run", "command": "c" }
        ]
    }"#;

    let (pre_rows, pre_next_report) = {
        let db = Db::open(&home).expect("open db");
        test_support::seed_workspace_with_repo_root(&db, "workspace-1", "local", "/tmp/w1");
        let service = service_on(&db);
        service.create_run_idempotent(plan, "workspace-1").expect("create");
        service
            .set_session_for_slot("run-restart", "main", "sess-1")
            .expect("bind slot session");
        // Drive exactly one step, then "crash" (drop everything mid-run).
        let executor = ScriptedExecutor::script(vec![StepOutcome::Completed {
            output: serde_json::json!({ "step": "a" }),
        }]);
        let cancel = CancelToken::new();
        let progress = service
            .run_next_step("run-restart", &executor, &cancel)
            .await
            .expect("run one step");
        assert_eq!(progress, crate::domains::workflows::engine::EngineProgress::Advanced);
        let rows = service.replay_observations_from("run-restart", 1).expect("replay");
        let next = service.get_next_report("run-restart").expect("next").expect("row");
        (rows, next)
    };

    // Reopen the same SQLite file: everything must come back exactly.
    let db = Db::open(&home).expect("reopen db");
    let service = service_on(&db);

    let (run, steps) = service
        .get_run_with_steps("run-restart")
        .expect("get")
        .expect("run survived restart");
    assert_eq!(run.status, WorkflowRunStatus::Running);
    assert_eq!(run.step_cursor, 1, "cursor restored at the second step");
    assert_eq!(run.plan_hash.as_deref(), Some("sha256:ph"));
    assert_eq!(run.binding_hash.as_deref(), Some("sha256:bh"));
    assert_eq!(run.execution_generation, Some(1));
    assert_eq!(run.session_ids.get("main").map(String::as_str), Some("sess-1"));
    assert_eq!(steps[0].status, WorkflowStepStatus::Completed);
    assert_eq!(steps[0].attempt, 1, "attempt restored");
    assert_eq!(steps[1].status, WorkflowStepStatus::Pending);

    // The outbox replays byte-identically across the restart, and the reporter
    // resumes from the same lowest-unacked row.
    let post_rows = service.replay_observations_from("run-restart", 1).expect("replay");
    assert_eq!(post_rows, pre_rows, "outbox identical after reopen");
    let next = service.get_next_report("run-restart").expect("next").expect("row");
    assert_eq!(next, pre_next_report);

    // The run keeps driving from the restored cursor, and the outbox continues
    // at the next revision with no skips.
    let executor = ScriptedExecutor::script(vec![]);
    let cancel = CancelToken::new();
    let progress =
        crate::live::workflows::actor::drive_run(&service, &executor, "run-restart", &cancel).await;
    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    let final_rows = service.replay_observations_from("run-restart", 1).expect("replay");
    for (idx, row) in final_rows.iter().enumerate() {
        assert_eq!(row.revision, idx as i64 + 1, "gapless across the restart");
    }
    assert_eq!(
        parse_snapshot(final_rows.last().unwrap()).observed_state,
        "completed"
    );

    std::fs::remove_dir_all(&home).ok();
}

#[tokio::test]
async fn lane_snapshots_carry_per_lane_cursors() {
    // A parallel group: the observed snapshots carry per-lane cursors keyed by
    // lane name, ending at the sentinel "end" once each lane completes.
    let service = test_service();
    let plan = r#"{
        "run_id": "run-lanes",
        "sessions": {
            "a": { "harness": "claude", "session_binding": "fresh" },
            "b": { "harness": "claude", "session_binding": "fresh" }
        },
        "steps": [
            { "key": "0.a.0", "slot": "a", "kind": "shell.run", "command": "a0" },
            { "key": "0.b.0", "slot": "b", "kind": "shell.run", "command": "b0" }
        ]
    }"#;
    service.create_run_idempotent(plan, "workspace-1").expect("create");
    let executor = ScriptedExecutor::script(vec![]);
    let cancel = CancelToken::new();
    let progress =
        crate::live::workflows::actor::drive_run(&service, &executor, "run-lanes", &cancel).await;
    assert_eq!(
        progress,
        crate::domains::workflows::engine::EngineProgress::Finished(WorkflowRunStatus::Completed)
    );
    let rows = service.replay_observations_from("run-lanes", 1).expect("replay");
    let last = parse_snapshot(rows.last().unwrap());
    assert_eq!(last.lane_cursors.get("a").map(String::as_str), Some("end"));
    assert_eq!(last.lane_cursors.get("b").map(String::as_str), Some("end"));
    // Mid-run revisions (while a lane was running) name the lane's own step key.
    let saw_lane_key = rows
        .iter()
        .map(parse_snapshot)
        .any(|snapshot| snapshot.lane_cursors.get("a").map(String::as_str) == Some("0.a.0"));
    assert!(saw_lane_key, "a running lane's cursor names its stable step key");
}
