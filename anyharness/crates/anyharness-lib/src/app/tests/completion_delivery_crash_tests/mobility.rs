use std::path::{Path, PathBuf};

use anyharness_contract::v1::{
    ContentPart, ItemCompletedEvent, ItemStartedEvent, PendingPromptRemovalReason,
    PendingPromptRemovedPayload, PromptProvenance, SessionEvent, TranscriptItemKind,
    TranscriptItemPayload, TranscriptItemStatus, TurnStartedEvent,
};

use super::fixture::{
    assert_final_delivery, capture_delivery, install_trigger, wait_for, wait_for_delivered,
    wait_for_enqueued, CHILD_ID, PARENT_ID,
};
use crate::app::test_support;
use crate::domains::mobility::model::{
    WorkspaceMobilityArchiveData, WorkspaceMobilityExportOptions,
};
use crate::domains::sessions::model::SessionEventRecord;
use crate::domains::sessions::runtime::prompt_message_actor_tests::{
    build_state, install_scripted_agent_env, prompt_texts, stop_target_actor, temp_runtime_home,
    wait_for_actor_idle, write_scripted_agent,
};
use crate::domains::sessions::store::completion_deliveries::{
    CompletionDeliveryRecord, DurableSubagentWakeTurn,
};
use crate::domains::sessions::store::SessionStore;
use crate::domains::sessions::subagents::delivery::{
    CompletionDeliveryState, CompletionDeliveryStore,
};
use crate::persistence::Db;

const SOURCE_WORKSPACE_ID: &str = "workspace-b";
const DESTINATION_WORKSPACE_ID: &str = "mobility-destination";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn export_linearizes_after_actual_completion_admission_and_install_does_not_repeat_it() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let source_home = temp_runtime_home("completion-mobility-post");
    let source_script = write_scripted_agent(&source_home);
    let (_source_program, _source_args) = install_scripted_agent_env(&source_script);
    std::fs::write(source_script.control_dir.join("hold-load"), b"")
        .expect("hold source actor before admission");
    let source_repo = source_home.join("workspace-b");
    initialize_git_repo(&source_repo);
    let source = build_state(
        &source_home,
        Db::open(&source_home).expect("file-backed source db"),
        true,
    );
    let delivery = capture_delivery(&source, "mobility-post-delivery");
    wait_for_enqueued(&source, &delivery.delivery_id).await;

    let (snapshot_reached_tx, snapshot_reached_rx) = tokio::sync::oneshot::channel();
    let (resume_export_tx, resume_export_rx) = tokio::sync::oneshot::channel();
    let mobility_runtime = source.mobility_runtime.clone();
    let export = tokio::task::spawn_blocking(move || {
        mobility_runtime.export_workspace_archive_with_snapshot_hooks(
            SOURCE_WORKSPACE_ID,
            &WorkspaceMobilityExportOptions::default(),
            move || {
                snapshot_reached_tx
                    .send(())
                    .expect("announce pre-snapshot boundary");
                resume_export_rx
                    .blocking_recv()
                    .expect("resume post-admission snapshot");
            },
            || {},
        )
    });
    snapshot_reached_rx
        .await
        .expect("export reached pre-snapshot boundary");

    std::fs::write(source_script.control_dir.join("release-load"), b"")
        .expect("release source actor for admission");
    source
        .session_runtime
        .ensure_live_session(PARENT_ID, None)
        .await
        .expect("start actual source actor");
    wait_for_delivered(&source, &source_script, &delivery).await;
    resume_export_tx.send(()).expect("resume export");
    let archive = export
        .await
        .expect("join post-admission export")
        .expect("export post-admission snapshot");
    assert_post_admission_archive(&archive, &delivery);

    stop_target_actor(&source).await;
    let destination_home = temp_runtime_home("completion-mobility-post-destination");
    let destination_repo = clone_repo(&source_repo, &destination_home);
    remove_source(&source, &source_repo);
    let destination_script = write_scripted_agent(&destination_home);
    let (_destination_program, _destination_args) = install_scripted_agent_env(&destination_script);
    let destination = destination_state(&destination_home, &destination_repo);
    install_archive(&destination, &archive).await;
    destination
        .session_runtime
        .ensure_live_session(PARENT_ID, None)
        .await
        .expect("reconstruct installed parent");
    wait_for_actor_idle(&destination).await;

    assert_eq!(prompt_texts(&source_script.request_log).len(), 1);
    assert!(prompt_texts(&destination_script.request_log).is_empty());
    assert_eq!(
        CompletionDeliveryStore::new(destination.db.clone())
            .list_all_for_test()
            .expect("installed outboxes")
            .len(),
        0
    );
    let installed_events = destination
        .session_service
        .store()
        .list_events(PARENT_ID)
        .expect("installed parent events");
    assert_exact_completion_triplet(&installed_events, &delivery);

    stop_target_actor(&destination).await;
    drop(destination);
    drop(source);
    std::fs::remove_dir_all(destination_home).expect("remove destination runtime home");
    std::fs::remove_dir_all(source_home).expect("remove source runtime home");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn export_read_transaction_blocks_admission_and_installed_pre_snapshot_delivers_once() {
    let _env_lock = test_support::lock_env().await;
    let _bearer = test_support::set_bearer_token_env(None);
    let _data_key = test_support::set_data_key_env(None);
    let source_home = temp_runtime_home("completion-mobility-pre");
    let source_script = write_scripted_agent(&source_home);
    let (_source_program, _source_args) = install_scripted_agent_env(&source_script);
    std::fs::write(source_script.control_dir.join("hold-load"), b"")
        .expect("hold source actor before snapshot");
    let source_repo = source_home.join("workspace-b");
    initialize_git_repo(&source_repo);
    let source = build_state(
        &source_home,
        Db::open(&source_home).expect("file-backed source db"),
        true,
    );
    let delivery = capture_delivery(&source, "mobility-pre-delivery");
    wait_for_enqueued(&source, &delivery.delivery_id).await;
    let enqueued_delivery = CompletionDeliveryStore::new(source.db.clone())
        .find(&delivery.delivery_id)
        .expect("reload enqueued delivery")
        .expect("enqueued delivery row");
    let pending = source
        .session_service
        .store()
        .find_pending_prompt(
            PARENT_ID,
            enqueued_delivery
                .parent_prompt_seq
                .expect("canonical queue seq"),
        )
        .expect("canonical source prompt")
        .expect("canonical source prompt row");
    // The worker also injects the parent-visible completion event on this
    // pass, so the staged wake turn has to continue the parent's durable
    // sequence rather than assume an empty transcript.
    wait_for("injected parent completion event", || {
        source
            .session_service
            .store()
            .list_events(PARENT_ID)
            .is_ok_and(|events| {
                events
                    .iter()
                    .any(|event| event.event_type == "subagent_turn_completed")
            })
    })
    .await;
    let next_parent_seq = source
        .session_service
        .store()
        .list_events(PARENT_ID)
        .expect("parent events before admission")
        .iter()
        .map(|event| event.seq)
        .max()
        .unwrap_or(0)
        + 1;
    let staged_admission = staged_admission(&enqueued_delivery, &pending, next_parent_seq);
    install_trigger(
        &source.db,
        "c06_abort_source_admission",
        "BEFORE UPDATE OF state ON session_link_completion_deliveries
         WHEN NEW.delivery_id = 'mobility-pre-delivery' AND NEW.state = 'delivered'",
        "SELECT RAISE(ABORT, 'hold source completion admission')",
    );

    let (snapshot_reached_tx, snapshot_reached_rx) = tokio::sync::oneshot::channel();
    let (resume_export_tx, resume_export_rx) = tokio::sync::oneshot::channel();
    let mobility_runtime = source.mobility_runtime.clone();
    let export = tokio::task::spawn_blocking(move || {
        mobility_runtime.export_workspace_archive_with_snapshot_hooks(
            SOURCE_WORKSPACE_ID,
            &WorkspaceMobilityExportOptions::default(),
            || {},
            move || {
                snapshot_reached_tx
                    .send(())
                    .expect("announce in-transaction boundary");
                resume_export_rx
                    .blocking_recv()
                    .expect("resume pre-admission snapshot");
            },
        )
    });
    snapshot_reached_rx
        .await
        .expect("export selected parent events inside snapshot");

    let (admission_started_tx, admission_started_rx) = tokio::sync::oneshot::channel();
    let admission_store = SessionStore::new(source.db.clone());
    let admission = tokio::task::spawn_blocking(move || {
        admission_started_tx
            .send(())
            .expect("announce blocked admission attempt");
        admission_store.persist_subagent_wake_turn_record(&staged_admission)
    });
    admission_started_rx
        .await
        .expect("admission task reached the SQLite fence");
    tokio::task::yield_now().await;
    assert!(!admission.is_finished());
    assert!(!export.is_finished());
    assert!(prompt_texts(&source_script.request_log).is_empty());

    resume_export_tx
        .send(())
        .expect("finish pre-admission export");
    let archive = export
        .await
        .expect("join pre-admission export")
        .expect("export pre-admission snapshot");
    let admission_error = admission
        .await
        .expect("join blocked admission")
        .expect_err("source admission trigger must roll back");
    assert!(admission_error
        .to_string()
        .contains("hold source completion admission"));
    std::fs::write(source_script.control_dir.join("release-load"), b"")
        .expect("release source actor for shutdown");
    stop_target_actor(&source).await;
    assert!(prompt_texts(&source_script.request_log).is_empty());
    assert_pre_admission_archive(&archive, &delivery);

    let destination_home = temp_runtime_home("completion-mobility-pre-destination");
    let destination_repo = clone_repo(&source_repo, &destination_home);
    remove_source(&source, &source_repo);
    let destination_script = write_scripted_agent(&destination_home);
    let (_destination_program, _destination_args) = install_scripted_agent_env(&destination_script);
    let destination = destination_state(&destination_home, &destination_repo);
    install_archive(&destination, &archive).await;
    wait_for_delivered(&destination, &destination_script, &delivery).await;

    assert!(prompt_texts(&source_script.request_log).is_empty());
    assert_eq!(prompt_texts(&destination_script.request_log).len(), 1);
    assert_final_delivery(&destination, &destination_script, &delivery);

    stop_target_actor(&destination).await;
    drop(destination);
    drop(source);
    std::fs::remove_dir_all(destination_home).expect("remove destination runtime home");
    std::fs::remove_dir_all(source_home).expect("remove source runtime home");
}

fn initialize_git_repo(path: &Path) {
    std::fs::create_dir_all(path).expect("create source git repository");
    super::super::run_git(path, &["init", "-b", "main"]);
    std::fs::write(path.join("README.md"), "mobility snapshot fixture\n")
        .expect("write source fixture");
    super::super::run_git(path, &["add", "README.md"]);
    super::super::run_git(
        path,
        &[
            "-c",
            "user.name=AnyHarness Test",
            "-c",
            "user.email=anyharness@example.test",
            "commit",
            "-m",
            "seed mobility fixture",
        ],
    );
}

fn clone_repo(source_repo: &Path, destination_home: &Path) -> PathBuf {
    std::fs::create_dir_all(destination_home).expect("create destination runtime home");
    let destination_repo = destination_home.join("workspace-destination");
    let source = source_repo.to_string_lossy();
    let destination = destination_repo.to_string_lossy();
    super::super::run_git(
        destination_home,
        &["clone", source.as_ref(), destination.as_ref()],
    );
    destination_repo
}

fn destination_state(runtime_home: &Path, repo: &Path) -> crate::app::AppState {
    let db = Db::open(runtime_home).expect("file-backed destination db");
    test_support::seed_workspace_with_repo_root(
        &db,
        DESTINATION_WORKSPACE_ID,
        "local",
        &repo.to_string_lossy(),
    );
    build_state(runtime_home, db, false)
}

async fn install_archive(
    destination: &crate::app::AppState,
    archive: &WorkspaceMobilityArchiveData,
) {
    let mobility_runtime = destination.mobility_runtime.clone();
    let archive = archive.clone();
    tokio::task::spawn_blocking(move || {
        mobility_runtime.install_workspace_archive(DESTINATION_WORKSPACE_ID, &archive, None)
    })
    .await
    .expect("join mobility install")
    .expect("install mobility archive");
}

fn remove_source(source: &crate::app::AppState, source_repo: &Path) {
    source
        .session_service
        .delete_session(CHILD_ID)
        .expect("delete source child through session workflow");
    source
        .session_service
        .delete_session(PARENT_ID)
        .expect("delete source parent through session workflow");
    assert!(source
        .session_service
        .store()
        .list_by_workspace(SOURCE_WORKSPACE_ID)
        .expect("source sessions after deletion")
        .is_empty());
    std::fs::remove_dir_all(source_repo).expect("remove source workspace materialization");
}

fn staged_admission(
    delivery: &CompletionDeliveryRecord,
    pending: &crate::domains::sessions::model::PendingPromptRecord,
    first_seq: i64,
) -> DurableSubagentWakeTurn {
    let turn_id = "mobility-source-parent-turn";
    let item_id = "mobility-source-parent-item";
    let payload = pending.prompt_payload();
    let item = TranscriptItemPayload {
        kind: TranscriptItemKind::UserMessage,
        status: TranscriptItemStatus::Completed,
        source_agent_kind: "claude".into(),
        is_transient: false,
        message_id: None,
        prompt_id: pending.prompt_id.clone(),
        title: None,
        tool_call_id: None,
        native_tool_name: None,
        parent_tool_call_id: None,
        raw_input: None,
        raw_output: None,
        content_parts: payload.content_parts(),
        prompt_provenance: payload.public_provenance(),
    };
    let events = [
        (
            SessionEvent::TurnStarted(TurnStartedEvent::default()),
            Some(turn_id),
            None,
        ),
        (
            SessionEvent::ItemStarted(ItemStartedEvent { item: item.clone() }),
            Some(turn_id),
            Some(item_id),
        ),
        (
            SessionEvent::ItemCompleted(ItemCompletedEvent { item }),
            Some(turn_id),
            Some(item_id),
        ),
        (
            SessionEvent::PendingPromptRemoved(PendingPromptRemovedPayload {
                seq: pending.seq,
                prompt_id: Some(delivery.prompt_id()),
                reason: PendingPromptRemovalReason::Executed,
            }),
            None,
            None,
        ),
    ]
    .into_iter()
    .enumerate()
    .map(|(offset, (event, turn_id, item_id))| SessionEventRecord {
        id: 0,
        session_id: delivery.parent_session_id.clone(),
        seq: first_seq + offset as i64,
        timestamp: format!("2026-08-11T00:06:0{offset}Z"),
        event_type: event.event_type().into(),
        turn_id: turn_id.map(str::to_string),
        item_id: item_id.map(str::to_string),
        payload_json: serde_json::to_string(&event).expect("staged admission event JSON"),
    })
    .collect();
    DurableSubagentWakeTurn {
        session_id: delivery.parent_session_id.clone(),
        queue_seq: pending.seq,
        events,
        admitted_at: "2026-08-11T00:06:04Z".into(),
    }
}

fn assert_pre_admission_archive(
    archive: &WorkspaceMobilityArchiveData,
    delivery: &CompletionDeliveryRecord,
) {
    let parent = parent_bundle(archive);
    let matching_pending = parent
        .pending_prompts
        .iter()
        .filter(|pending| pending.prompt_id.as_deref() == Some(delivery.prompt_id().as_str()))
        .collect::<Vec<_>>();
    assert_eq!(matching_pending.len(), 1);
    let pending = matching_pending[0];
    assert_eq!(pending.text, delivery.notification_text);
    let content_parts = pending.prompt_payload().content_parts();
    assert!(matches!(
        content_parts.as_slice(),
        [ContentPart::Text { text }] if text == &delivery.notification_text
    ));
    assert!(matches!(
        pending.prompt_payload().public_provenance(),
        Some(PromptProvenance::SubagentWake {
            session_link_id,
            completion_id,
            label,
        }) if session_link_id == delivery.session_link_id
            && completion_id == delivery.delivery_id
            && label == delivery.label
    ));
    assert_eq!(archive.session_link_completion_deliveries.len(), 1);
    let archived_delivery = &archive.session_link_completion_deliveries[0];
    assert_eq!(archived_delivery.delivery_id, delivery.delivery_id);
    assert_eq!(archived_delivery.prompt_id(), delivery.prompt_id());
    assert_eq!(archived_delivery.state, CompletionDeliveryState::Enqueued);
    assert_eq!(archived_delivery.parent_prompt_seq, Some(pending.seq));
    assert_no_exact_completion(&parent.events, delivery);
}

fn assert_post_admission_archive(
    archive: &WorkspaceMobilityArchiveData,
    delivery: &CompletionDeliveryRecord,
) {
    let parent = parent_bundle(archive);
    assert!(parent
        .pending_prompts
        .iter()
        .all(|pending| pending.prompt_id.as_deref() != Some(delivery.prompt_id().as_str())));
    assert!(archive.session_link_completion_deliveries.is_empty());
    assert_exact_completion_triplet(&parent.events, delivery);
    let projection = archive
        .session_link_completions
        .iter()
        .find(|completion| completion.completion_id == delivery.completion_id)
        .expect("completion projection survives post-admission export");
    assert!(projection.parent_event_seq.is_some());
}

fn parent_bundle(
    archive: &WorkspaceMobilityArchiveData,
) -> &crate::domains::mobility::model::WorkspaceMobilitySessionBundleData {
    archive
        .sessions
        .iter()
        .find(|bundle| bundle.session.id == PARENT_ID)
        .expect("parent session in mobility archive")
}

fn assert_no_exact_completion(events: &[SessionEventRecord], delivery: &CompletionDeliveryRecord) {
    assert_eq!(
        events
            .iter()
            .filter_map(|record| completion_item(record, delivery, false))
            .count(),
        0
    );
}

fn assert_exact_completion_triplet(
    events: &[SessionEventRecord],
    delivery: &CompletionDeliveryRecord,
) {
    let completed = events
        .iter()
        .filter_map(|record| completion_item(record, delivery, false).map(|item| (record, item)))
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1);
    let (completed_record, completed_item) = &completed[0];
    let turn_id = completed_record
        .turn_id
        .as_deref()
        .expect("completion turn id");
    let item_id = completed_record
        .item_id
        .as_deref()
        .expect("completion item id");
    let started = events
        .iter()
        .filter_map(|record| {
            (record.turn_id.as_deref() == Some(turn_id)
                && record.item_id.as_deref() == Some(item_id))
            .then(|| completion_item(record, delivery, true))
            .flatten()
            .map(|item| (record, item))
        })
        .collect::<Vec<_>>();
    assert_eq!(started.len(), 1);
    assert_eq!(&started[0].1, completed_item);
    assert_eq!(started[0].0.seq + 1, completed_record.seq);
    assert_eq!(
        events
            .iter()
            .filter(|record| {
                record.event_type == "turn_started"
                    && record.turn_id.as_deref() == Some(turn_id)
                    && record.item_id.is_none()
                    && record.seq + 1 == started[0].0.seq
                    && serde_json::from_str::<SessionEvent>(&record.payload_json)
                        .is_ok_and(|event| matches!(event, SessionEvent::TurnStarted(_)))
            })
            .count(),
        1
    );
}

fn completion_item(
    record: &SessionEventRecord,
    delivery: &CompletionDeliveryRecord,
    started: bool,
) -> Option<serde_json::Value> {
    let event = serde_json::from_str::<SessionEvent>(&record.payload_json).ok()?;
    let item = match (started, event) {
        (true, SessionEvent::ItemStarted(event)) if record.event_type == "item_started" => {
            event.item
        }
        (false, SessionEvent::ItemCompleted(event)) if record.event_type == "item_completed" => {
            event.item
        }
        _ => return None,
    };
    exact_completion_item(&item, delivery).then(|| serde_json::to_value(item).expect("item JSON"))
}

fn exact_completion_item(
    item: &TranscriptItemPayload,
    delivery: &CompletionDeliveryRecord,
) -> bool {
    matches!(item.kind, TranscriptItemKind::UserMessage)
        && matches!(item.status, TranscriptItemStatus::Completed)
        && !item.is_transient
        && item.message_id.is_none()
        && item.prompt_id.as_deref() == Some(delivery.prompt_id().as_str())
        && item.title.is_none()
        && item.tool_call_id.is_none()
        && item.native_tool_name.is_none()
        && item.parent_tool_call_id.is_none()
        && item.raw_input.is_none()
        && item.raw_output.is_none()
        && matches!(
            item.content_parts.as_slice(),
            [ContentPart::Text { text }] if text == &delivery.notification_text
        )
        && matches!(
            item.prompt_provenance.as_ref(),
            Some(PromptProvenance::SubagentWake {
                session_link_id,
                completion_id,
                label,
            }) if session_link_id == &delivery.session_link_id
                && completion_id == &delivery.delivery_id
                && label == &delivery.label
        )
}
