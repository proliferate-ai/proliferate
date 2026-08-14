use super::*;
use crate::app::test_support;
use crate::{
    domains::sessions::deletion::SessionDeleteWorkflow,
    domains::sessions::extensions::SessionTurnOutcome,
    domains::sessions::links::model::{SubagentLinkCloseOutcome, SubagentLinkOpenOutcome},
    domains::sessions::model::SessionRecord,
    domains::sessions::store::link_completions::{LinkCompletionRecord, LinkCompletionStore},
    persistence::Db,
};

fn seed_workspace(db: &Db) {
    test_support::seed_workspace_with_repo_root(db, "workspace-1", "local", "/tmp/workspace");
}

fn session_record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.to_string(),
        workspace_id: "workspace-1".to_string(),
        agent_kind: "claude".to_string(),
        native_session_id: None,
        agent_auth_contexts: None,
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
        mcp_binding_policy:
            crate::domains::sessions::model::SessionMcpBindingPolicy::InheritWorkspace,
        system_prompt_append: None,
        subagents_enabled: true,
        action_capabilities_json: None,
        origin: None,
    }
}

fn service_fixture() -> (Db, SessionStore, SessionLinkService) {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let session_store = SessionStore::new(db.clone());
    session_store
        .insert(&session_record("parent-1"))
        .expect("insert parent");
    session_store
        .insert(&session_record("child-1"))
        .expect("insert child");
    let service = SessionLinkService::new(SessionLinkStore::new(db.clone()), session_store.clone());
    (db, session_store, service)
}

fn create_input(parent: &str, child: &str) -> CreateSessionLinkInput {
    CreateSessionLinkInput {
        relation: SessionLinkRelation::Subagent,
        parent_session_id: parent.to_string(),
        child_session_id: child.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some("Child".to_string()),
        created_by_turn_id: Some("turn-1".to_string()),
        created_by_tool_call_id: Some("tool-1".to_string()),
    }
}

fn completion(link_id: &str) -> LinkCompletionRecord {
    LinkCompletionRecord {
        completion_id: "completion-1".to_string(),
        session_link_id: link_id.to_string(),
        child_turn_id: "turn-completed".to_string(),
        child_last_event_seq: 3,
        outcome: SessionTurnOutcome::Completed,
        parent_event_seq: None,
        parent_prompt_seq: None,
        created_at: "2026-03-25T00:01:00Z".to_string(),
        updated_at: "2026-03-25T00:01:00Z".to_string(),
    }
}

#[test]
fn creates_and_lists_links_by_parent_and_child() {
    let (_db, _session_store, service) = service_fixture();

    let link = service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create link");

    let by_parent = service.list_by_parent("parent-1").expect("list by parent");
    assert_eq!(by_parent, vec![link.clone()]);
    let by_child = service.list_by_child("child-1").expect("list by child");
    assert_eq!(by_child, vec![link]);
}

#[test]
fn rejects_missing_parent_or_child() {
    let (_db, _session_store, service) = service_fixture();

    let missing_parent = service
        .create_link(create_input("missing-parent", "child-1"))
        .expect_err("missing parent");
    assert!(matches!(
        missing_parent,
        CreateSessionLinkError::ParentNotFound(id) if id == "missing-parent"
    ));

    let missing_child = service
        .create_link(create_input("parent-1", "missing-child"))
        .expect_err("missing child");
    assert!(matches!(
        missing_child,
        CreateSessionLinkError::ChildNotFound(id) if id == "missing-child"
    ));
}

#[test]
fn rejects_self_links_and_duplicates() {
    let (_db, _session_store, service) = service_fixture();

    let self_link = service
        .create_link(create_input("parent-1", "parent-1"))
        .expect_err("self link");
    assert!(matches!(self_link, CreateSessionLinkError::SelfLink));

    service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create first link");
    let duplicate = service
        .create_link(create_input("parent-1", "child-1"))
        .expect_err("duplicate link");
    assert!(matches!(duplicate, CreateSessionLinkError::Duplicate));
}

#[test]
fn rejects_second_subagent_parent_for_same_child() {
    let (_db, session_store, service) = service_fixture();
    session_store
        .insert(&session_record("parent-2"))
        .expect("insert second parent");

    service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create first link");
    let duplicate_parent = service
        .create_link(create_input("parent-2", "child-1"))
        .expect_err("second parent rejected");

    assert!(matches!(
        duplicate_parent,
        CreateSessionLinkError::ChildAlreadyLinked
    ));
}

#[test]
fn create_subagent_link_enforces_child_limit_at_insert() {
    let (_db, session_store, service) = service_fixture();
    session_store
        .insert(&session_record("child-2"))
        .expect("insert second child");

    service
        .create_subagent_link_with_child_limit(create_input("parent-1", "child-1"), 1)
        .expect("create first child link");
    let limit = service
        .create_subagent_link_with_child_limit(create_input("parent-1", "child-2"), 1)
        .expect_err("fanout limit");

    assert!(matches!(limit, CreateSessionLinkError::FanoutLimit));
    assert!(service
        .find_subagent_link("parent-1", "child-2")
        .expect("find second child link")
        .is_none());
}

/// Teardown reaches a subagent link from both ends: the child's
/// `close_inbound_delegated_links` and the parent's cascade loop both call
/// `close_link` on the same row. Only the call that performs the transition
/// may report it, or the diagnostics stream carries two `link_closed` records
/// for one link with contradictory `cause` values.
#[test]
fn only_the_call_that_closes_a_link_reports_the_transition() {
    let (_db, _session_store, service) = service_fixture();
    let link = service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create link");

    assert!(
        service
            .close_link(&link.id, "2026-03-25T00:02:00Z")
            .expect("first close"),
        "the call that closes the link must report the transition"
    );
    assert!(
        !service
            .close_link(&link.id, "2026-03-25T00:03:00Z")
            .expect("second close"),
        "closing an already-closed link must not report a second transition"
    );

    let historical = service
        .list_by_parent_including_closed("parent-1")
        .expect("read closed link")
        .into_iter()
        .find(|candidate| candidate.id == link.id)
        .expect("link still exists");
    assert_eq!(
        historical.closed_at.as_deref(),
        Some("2026-03-25T00:02:00Z"),
        "the second close must not overwrite the original closed_at"
    );

    // A link that never existed is not a transition either.
    assert!(!service
        .close_link("missing-link", "2026-03-25T00:04:00Z")
        .expect("close absent link"));
}

#[test]
fn closed_links_are_hidden_from_normal_lists_but_available_to_history() {
    let (_db, _session_store, service) = service_fixture();
    let link = service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create link");

    service
        .close_link(&link.id, "2026-03-25T00:02:00Z")
        .expect("mark closed");

    assert!(service
        .list_by_parent("parent-1")
        .expect("list open by parent")
        .is_empty());
    assert!(service
        .list_by_child("child-1")
        .expect("list open by child")
        .is_empty());
    let historical = service
        .list_by_parent_including_closed("parent-1")
        .expect("list historical by parent");
    assert_eq!(historical.len(), 1);
    assert_eq!(historical[0].id, link.id);
    assert_eq!(
        historical[0].closed_at.as_deref(),
        Some("2026-03-25T00:02:00Z"),
    );
}

#[test]
fn reversible_close_is_idempotent_purges_work_and_preserves_relationship_history() {
    let (db, session_store, service) = service_fixture();
    session_store
        .insert(&session_record("child-2"))
        .expect("insert second child");
    let link = service
        .create_subagent_link_with_child_limit(create_input("parent-1", "child-1"), 1)
        .expect("create subagent link");
    session_store
        .insert_pending_prompt("child-1", "first queued prompt", Some("prompt-1"))
        .expect("queue first prompt");
    session_store
        .insert_pending_prompt("child-1", "second queued prompt", Some("prompt-2"))
        .expect("queue second prompt");
    let completions = LinkCompletionStore::new(db.clone());
    completions
        .insert_completion_if_absent(&completion(&link.id))
        .expect("insert completion");
    assert!(completions.schedule_wake(&link.id).expect("schedule wake"));

    let SubagentLinkCloseOutcome::Closed(first) = service
        .close_subagent_operability(&link.id, "2026-03-25T00:02:00Z")
        .expect("close subagent operability")
    else {
        panic!("active subagent link must be found");
    };
    assert!(!first.was_already_closed);
    assert_eq!(first.purged_pending_prompt_count, 2);
    assert!(first.removed_wake_schedule);
    assert_eq!(
        first.link.subagent_closed_at.as_deref(),
        Some("2026-03-25T00:02:00Z")
    );
    assert_eq!(first.link.closed_at, None);
    assert!(session_store
        .list_pending_prompts("child-1")
        .expect("list pending prompts")
        .is_empty());
    assert!(completions
        .list_wake_schedules(std::slice::from_ref(&link.id))
        .expect("list wake schedules")
        .is_empty());
    assert!(completions
        .find_completion(&link.id, "turn-completed")
        .expect("find completion")
        .is_some());

    let current = service
        .find_subagent_link("parent-1", "child-1")
        .expect("find current relationship")
        .expect("closed-operability link remains current");
    assert_eq!(current.subagent_closed_at, first.link.subagent_closed_at);
    assert_eq!(
        service
            .list_subagent_children("parent-1")
            .expect("list current children")
            .len(),
        1
    );

    let fanout = service
        .create_subagent_link_with_child_limit(create_input("parent-1", "child-2"), 1)
        .expect_err("closed-operability child still consumes fanout");
    assert!(matches!(fanout, CreateSessionLinkError::FanoutLimit));

    session_store
        .insert_pending_prompt("child-1", "queued after first close", Some("prompt-3"))
        .expect("queue prompt before idempotent retry");
    let SubagentLinkCloseOutcome::Closed(second) = service
        .close_subagent_operability(&link.id, "2026-03-25T00:03:00Z")
        .expect("repeat close")
    else {
        panic!("closed-operability link must remain current");
    };
    assert!(second.was_already_closed);
    assert_eq!(second.purged_pending_prompt_count, 1);
    assert!(!second.removed_wake_schedule);
    assert_eq!(
        second.link.subagent_closed_at.as_deref(),
        Some("2026-03-25T00:02:00Z"),
        "idempotent close preserves the first close time"
    );
    assert!(completions
        .find_completion(&link.id, "turn-completed")
        .expect("completion survives repeated close")
        .is_some());
}

#[test]
fn reversible_close_rolls_back_marker_and_queue_purge_when_transaction_fails() {
    let (db, session_store, service) = service_fixture();
    let link = service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create link");
    session_store
        .insert_pending_prompt("child-1", "must survive rollback", Some("prompt-1"))
        .expect("queue prompt");
    let completions = LinkCompletionStore::new(db.clone());
    completions.schedule_wake(&link.id).expect("schedule wake");
    db.with_conn(|conn| {
        conn.execute_batch(
            "CREATE TRIGGER fail_subagent_wake_delete
             BEFORE DELETE ON session_link_wake_schedules
             BEGIN
                 SELECT RAISE(ABORT, 'forced wake delete failure');
             END;",
        )
    })
    .expect("install failure trigger");

    service
        .close_subagent_operability(&link.id, "2026-03-25T00:02:00Z")
        .expect_err("close transaction must fail");

    let restored = service
        .find_subagent_link("parent-1", "child-1")
        .expect("find link after rollback")
        .expect("relationship remains current");
    assert_eq!(restored.subagent_closed_at, None);
    assert_eq!(restored.closed_at, None);
    assert_eq!(
        session_store
            .list_pending_prompts("child-1")
            .expect("list prompts after rollback")
            .len(),
        1
    );
    assert_eq!(
        completions
            .list_wake_schedules(std::slice::from_ref(&link.id))
            .expect("list wake schedules after rollback")
            .len(),
        1
    );
}

#[test]
fn reversible_close_rejects_non_subagent_links_before_purging_the_child_queue() {
    let (_db, session_store, service) = service_fixture();
    let mut input = create_input("parent-1", "child-1");
    input.relation = SessionLinkRelation::Fork;
    let link = service.create_link(input).expect("create fork link");
    session_store
        .insert_pending_prompt("child-1", "must remain queued", Some("prompt-1"))
        .expect("queue prompt");

    assert_eq!(
        service
            .close_subagent_operability(&link.id, "2026-03-25T00:02:00Z")
            .expect("reject non-subagent link"),
        SubagentLinkCloseOutcome::NotFound
    );
    assert_eq!(
        session_store
            .list_pending_prompts("child-1")
            .expect("list unaffected queue")
            .len(),
        1
    );
}

#[test]
fn reversible_open_is_idempotent_and_terminal_links_are_not_operable() {
    let (_db, _session_store, service) = service_fixture();
    let link = service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create link");
    service
        .close_subagent_operability(&link.id, "2026-03-25T00:02:00Z")
        .expect("close operability");

    let SubagentLinkOpenOutcome::Opened(first) = service
        .open_subagent_operability(&link.id)
        .expect("open operability")
    else {
        panic!("current subagent link must be found");
    };
    assert!(!first.was_already_open);
    assert_eq!(first.link.subagent_closed_at, None);
    assert_eq!(first.link.closed_at, None);

    let SubagentLinkOpenOutcome::Opened(second) = service
        .open_subagent_operability(&link.id)
        .expect("repeat open")
    else {
        panic!("current subagent link must remain found");
    };
    assert!(second.was_already_open);

    service
        .close_link(&link.id, "2026-03-25T00:04:00Z")
        .expect("terminally close relationship");
    assert_eq!(
        service
            .close_subagent_operability(&link.id, "2026-03-25T00:05:00Z")
            .expect("terminal close lookup"),
        SubagentLinkCloseOutcome::NotFound
    );
    assert_eq!(
        service
            .open_subagent_operability(&link.id)
            .expect("terminal open lookup"),
        SubagentLinkOpenOutcome::NotFound
    );
    assert!(service
        .list_subagent_children("parent-1")
        .expect("list current children")
        .is_empty());
}

#[test]
fn import_link_backfills_missing_public_id() {
    let (_db, session_store, service) = service_fixture();
    session_store
        .insert(&session_record("child-2"))
        .expect("insert imported child");
    let mut record = service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create template link");
    record.id = "imported-link".to_string();
    record.public_id = None;
    record.child_session_id = "child-2".to_string();

    service.import_link(&record).expect("import link");

    let imported = service
        .list_by_child("child-2")
        .expect("list imported child")
        .pop()
        .expect("imported link");
    assert_eq!(imported.id, "imported-link");
    assert!(imported
        .public_id
        .as_deref()
        .is_some_and(|id| id.starts_with("subagent_")));
}

#[test]
fn rejects_unknown_enum_values_on_read() {
    let (db, _session_store, service) = service_fixture();
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO session_links (
                id, relation, parent_session_id, child_session_id, workspace_relation,
                created_at
             ) VALUES ('bad-relation', 'sidekick', 'parent-1', 'child-1', 'same_workspace', ?1)",
            ["2026-03-25T00:01:00Z"],
        )?;
        Ok(())
    })
    .expect("insert bad relation");
    assert!(service.list_by_parent("parent-1").is_err());

    db.with_conn(|conn| {
        conn.execute("DELETE FROM session_links", [])?;
        conn.execute(
            "INSERT INTO session_links (
                id, relation, parent_session_id, child_session_id, workspace_relation,
                created_at
             ) VALUES ('bad-workspace-relation', 'subagent', 'parent-1', 'child-1', 'new_worktree', ?1)",
            ["2026-03-25T00:01:00Z"],
        )?;
        Ok(())
    })
    .expect("insert bad workspace relation");
    assert!(service.list_by_parent("parent-1").is_err());
}

#[test]
fn delete_session_removes_parent_and_child_links() {
    let (db, _session_store, service) = service_fixture();
    service
        .create_link(create_input("parent-1", "child-1"))
        .expect("create link");

    SessionDeleteWorkflow::new(db)
        .delete_session("parent-1")
        .expect("delete parent");

    assert!(service
        .list_by_child("child-1")
        .expect("list by child")
        .is_empty());
}
