//! The creator-to-actor `SessionStart` handoff race, split from the placement
//! route suite so its concurrency proof remains readable and under size caps.

use std::time::Duration;

use serde_json::json;
use tokio::sync::oneshot;

use super::workflow_runs_route_tests::{fixture, run_uuid, single_node_definition};
use crate::domains::sessions::store::SessionStore;
use crate::domains::workflows::definition::InvocationSnapshot;
use crate::domains::workflows::model::WorkflowRunStatus;
use crate::domains::workflows::store::NewRunParams;
use crate::domains::workspaces::operation_gate::WorkspaceOperationKind;
use crate::live::workflows::launch_barriers::{self, LaunchBarrier};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn creator_lease_reaches_an_actor_spawned_by_a_racing_caller() {
    let fixture = fixture("wf-route-existing-lease-handoff");
    let existing = fixture
        .state
        .workspace_runtime
        .resolve_from_path(&fixture.repo_dir().to_string_lossy())
        .expect("register user workspace")
        .workspace;
    let gate = fixture.state.workspace_operation_gate.clone();
    let creator_lease = gate
        .acquire_shared(&existing.id, WorkspaceOperationKind::SessionStart)
        .await;

    let run_id = run_uuid(0x2c);
    let mut definition = single_node_definition("blocking turn");
    definition["docTemplates"] = json!([]);
    let mut body = fixture.snapshot(definition);
    body["placement"]["mode"] = json!("existing_workspace");
    body["placement"]["workspaceId"] = json!(existing.id);
    let snapshot: InvocationSnapshot = serde_json::from_value(body).expect("snapshot");
    let definition_json = serde_json::to_string(&snapshot.definition).expect("definition json");
    fixture
        .state
        .workflow_store
        .create_run_with_first_node(NewRunParams {
            run_id: run_id.clone(),
            invocation_id: "inv-lease-handoff".into(),
            workspace_id: existing.id.clone(),
            snapshot,
            definition_json,
        })
        .expect("insert acceptance rows");

    // Register an exclusive waiter behind the creator guard, then prove the
    // fair queue blocks a newer reader before another caller spawns the actor.
    let writer_gate = gate.clone();
    let writer_workspace_id = existing.id.clone();
    let writer_run_id = run_id.clone();
    let writer_workflow_store = fixture.state.workflow_store.clone();
    let writer_session_store = SessionStore::new(fixture.state.db.clone());
    let (writer_acquired_tx, mut writer_acquired_rx) = oneshot::channel();
    let (writer_release_tx, writer_release_rx) = oneshot::channel();
    let writer = tokio::spawn(async move {
        let lease = writer_gate.acquire_exclusive(&writer_workspace_id).await;
        let state = writer_workflow_store
            .load_run_state(&writer_run_id)
            .expect("load run under writer")
            .expect("run exists under writer");
        let prompt_accepted = state.nodes[0]
            .session_id
            .as_deref()
            .is_some_and(|session_id| {
                writer_session_store
                    .has_turn_started_event(session_id)
                    .unwrap_or(false)
            });
        let _ = writer_acquired_tx.send(prompt_accepted);
        let _ = writer_release_rx.await;
        drop(lease);
    });
    let queue_deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    loop {
        match tokio::time::timeout(
            Duration::from_millis(10),
            gate.acquire_shared(&existing.id, WorkspaceOperationKind::MaterializationRead),
        )
        .await
        {
            Err(_) => break,
            Ok(probe) => drop(probe),
        }
        assert!(tokio::time::Instant::now() < queue_deadline, "writer never queued");
        tokio::task::yield_now().await;
    }

    fixture.touch_control("hold-new");
    let (accepted_tx, mut accepted_rx) = oneshot::channel();
    let (acceptance_resume_tx, acceptance_resume_rx) = oneshot::channel();
    launch_barriers::install(
        &run_id,
        LaunchBarrier {
            reached_tx: Some(accepted_tx),
            resume_rx: Some(acceptance_resume_rx),
        },
    );
    fixture
        .state
        .workflow_manager
        .start_run(&run_id)
        .expect("racing caller spawns actor");

    // A bad handoff must be discarded without leaving the actor blind to the
    // exact creator lease that follows it while the writer remains queued.
    let wrong_workspace_id = "ws-wrong-handoff";
    let wrong_lease = gate
        .acquire_shared(wrong_workspace_id, WorkspaceOperationKind::SessionStart)
        .await;
    let wrong_manager = fixture.state.workflow_manager.clone();
    let wrong_run_id = run_id.clone();
    let wrong_start = tokio::spawn(async move {
        wrong_manager
            .start_run_synced(&wrong_run_id, Some(wrong_lease))
            .await
    });
    let handoff_deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    while gate
        .snapshot(wrong_workspace_id)
        .await
        .count(WorkspaceOperationKind::SessionStart)
        != 0
    {
        assert!(tokio::time::Instant::now() < handoff_deadline, "wrong lease not discarded");
        tokio::task::yield_now().await;
    }

    let synced = fixture
        .state
        .workflow_manager
        .start_run_synced(&run_id, Some(creator_lease));
    tokio::pin!(synced);
    let new_seen = fixture.wait_for_control("new-seen");
    tokio::pin!(new_seen);
    tokio::select! {
        result = &mut writer_acquired_rx => {
            panic!("writer split acceptance from launch: {result:?}")
        }
        result = &mut synced => panic!("synced start escaped held session startup: {result:?}"),
        () = &mut new_seen => {}
    }
    assert_eq!(
        gate.snapshot(&existing.id)
            .await
            .count(WorkspaceOperationKind::SessionStart),
        1
    );
    fixture.touch_control("release-new");
    tokio::select! {
        result = &mut writer_acquired_rx => {
            panic!("writer acquired before prompt acceptance barrier: {result:?}")
        }
        result = &mut accepted_rx => result.expect("prompt acceptance barrier reached"),
        _ = tokio::time::sleep(Duration::from_secs(2)) => {
            panic!("prompt acceptance deadlocked behind the queued writer")
        }
    }
    assert_eq!(
        gate.snapshot(&existing.id)
            .await
            .count(WorkspaceOperationKind::SessionStart),
        1,
        "creator guard survives through durable first-prompt acceptance"
    );
    acceptance_resume_tx
        .send(())
        .expect("release prompt acceptance barrier");
    synced.await.expect("launch completes under creator lease");
    wrong_start
        .await
        .expect("wrong-handoff task")
        .expect("queued read completes");
    assert!(
        writer_acquired_rx.await.expect("writer proceeds after launch"),
        "writer acquired before the first prompt was durably accepted"
    );
    writer_release_tx.send(()).expect("release writer");
    writer.await.expect("writer task");
    fixture.wait_for_control("turn-seen").await;
    fixture.touch_control("release-turn");
    fixture
        .wait_for_run(&run_id, "handoff run completes", |state| {
            state.run.status == WorkflowRunStatus::Completed
        })
        .await;
}
