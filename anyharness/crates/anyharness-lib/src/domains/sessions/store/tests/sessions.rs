use super::*;
use crate::domains::sessions::store::{
    SessionSearchCursor, SessionSearchQuery, SESSION_SEARCH_DEFAULT_LIMIT, SESSION_SEARCH_MAX_LIMIT,
};
use crate::origin::{OriginContext, OriginEntrypoint, OriginKind};

#[test]
fn insert_or_find_by_id_reuses_the_original_session_row() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let original = session_record();
    assert!(matches!(
        store
            .insert_or_find_by_id(&original)
            .expect("insert original session"),
        super::super::idempotent_create::InsertSessionByIdOutcome::Inserted
    ));

    let mut replay = original.clone();
    replay.agent_kind = "codex".to_string();
    let existing = store
        .insert_or_find_by_id(&replay)
        .expect("find original session");
    let super::super::idempotent_create::InsertSessionByIdOutcome::Existing(existing) = existing
    else {
        panic!("replay should return the original row");
    };
    assert_eq!(existing.agent_kind, "claude");
    assert_eq!(
        store
            .list_by_workspace("workspace-1")
            .expect("list sessions")
            .len(),
        1
    );
}

#[test]
fn stores_and_loads_session_origin() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record();
    // The retired cowork origin: nothing writes it any more, but a stored
    // blob carrying it must still decode rather than be dropped on read.
    record.origin = Some(OriginContext {
        kind: OriginKind::Cowork,
        entrypoint: OriginEntrypoint::Cowork,
    });

    store.insert(&record).expect("insert session");
    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");

    assert_eq!(
        stored.origin,
        Some(OriginContext {
            kind: OriginKind::Cowork,
            entrypoint: OriginEntrypoint::Cowork,
        })
    );
}

#[test]
fn stores_and_loads_thinking_budget_tokens() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record();

    store.insert(&record).expect("insert session");
    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");

    assert_eq!(stored.thinking_budget_tokens, Some(16_000));
    assert_eq!(stored.title.as_deref(), Some("Fix auth refresh"));
}

#[test]
fn update_title_persists_session_title() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let mut record = session_record();
    record.title = None;

    store.insert(&record).expect("insert session");
    store
        .update_title(
            "session-1",
            "Investigate flaky checkout",
            "2026-03-25T01:00:00Z",
        )
        .expect("update title");

    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");

    assert_eq!(stored.title.as_deref(), Some("Investigate flaky checkout"));
    assert_eq!(stored.updated_at, "2026-03-25T01:00:00Z");
}

#[test]
fn visible_session_lists_exclude_dismissed_and_closed_sessions() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);

    let visible = session_record();
    store.insert(&visible).expect("insert visible session");

    let mut dismissed = session_record();
    dismissed.id = "session-2".to_string();
    dismissed.dismissed_at = Some("2026-03-25T02:00:00Z".to_string());
    dismissed.updated_at = "2026-03-25T02:00:00Z".to_string();
    store.insert(&dismissed).expect("insert dismissed session");

    let mut closed = session_record();
    closed.id = "session-3".to_string();
    closed.status = "closed".to_string();
    closed.closed_at = Some("2026-03-25T03:00:00Z".to_string());
    closed.updated_at = "2026-03-25T03:00:00Z".to_string();
    store.insert(&closed).expect("insert closed session");

    let visible_by_workspace = store
        .list_visible_by_workspace("workspace-1")
        .expect("list visible sessions by workspace");
    assert_eq!(visible_by_workspace.len(), 1);
    assert_eq!(visible_by_workspace[0].id, "session-1");

    let with_dismissed = store
        .list_with_dismissed_by_workspace("workspace-1")
        .expect("list sessions with dismissed by workspace");
    assert_eq!(with_dismissed.len(), 2);
    assert_eq!(with_dismissed[0].id, "session-2");
    assert_eq!(with_dismissed[1].id, "session-1");
}

#[test]
fn live_state_updates_do_not_reopen_closed_sessions() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    let record = session_record();
    store.insert(&record).expect("insert session");
    store
        .mark_closed("session-1", "2026-03-25T03:00:00Z")
        .expect("close session");
    store
        .update_native_session_id("session-1", "native-2", "2026-03-25T04:00:00Z")
        .expect("ignore native update");
    store
        .update_status("session-1", "idle", "2026-03-25T04:00:00Z")
        .expect("ignore status update");
    store
        .mark_closed("session-1", "2026-03-25T05:00:00Z")
        .expect("repeat close");

    let stored = store
        .find_by_id("session-1")
        .expect("find session")
        .expect("session record");
    assert_eq!(stored.status, "closed");
    assert_eq!(stored.native_session_id.as_deref(), Some("native-1"));
    assert_eq!(stored.closed_at.as_deref(), Some("2026-03-25T03:00:00Z"));
    assert_eq!(stored.updated_at, "2026-03-25T03:00:00Z");
}

#[test]
fn mark_dismissed_is_idempotent_and_restore_uses_latest_timestamp() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);

    let first = session_record();
    store.insert(&first).expect("insert first session");

    let mut second = session_record();
    second.id = "session-2".to_string();
    store.insert(&second).expect("insert second session");

    store
        .mark_dismissed("session-1", "2026-03-25T01:00:00Z")
        .expect("dismiss first session");
    store
        .mark_dismissed("session-1", "2026-03-25T05:00:00Z")
        .expect("repeat dismiss first session");
    store
        .mark_dismissed("session-2", "2026-03-25T03:00:00Z")
        .expect("dismiss second session");

    let first_stored = store
        .find_by_id("session-1")
        .expect("find first session")
        .expect("first session exists");
    assert_eq!(
        first_stored.dismissed_at.as_deref(),
        Some("2026-03-25T01:00:00Z")
    );
    assert_eq!(first_stored.updated_at, "2026-03-25T01:00:00Z");

    let last_dismissed = store
        .find_last_dismissed_in_workspace("workspace-1")
        .expect("find last dismissed session")
        .expect("dismissed session exists");
    assert_eq!(last_dismissed.id, "session-2");

    store
        .clear_dismissed("session-2", "2026-03-25T04:00:00Z")
        .expect("restore second session");

    let restored = store
        .find_by_id("session-2")
        .expect("find restored session")
        .expect("restored session exists");
    assert_eq!(restored.dismissed_at, None);
    assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

    let remaining = store
        .find_last_dismissed_in_workspace("workspace-1")
        .expect("find remaining dismissed session")
        .expect("remaining dismissed session exists");
    assert_eq!(remaining.id, "session-1");
}

#[test]
fn pop_last_dismissed_restores_latest_session_atomically() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);

    let mut first = session_record();
    first.id = "session-1".to_string();
    store.insert(&first).expect("insert first session");

    let mut second = session_record();
    second.id = "session-2".to_string();
    store.insert(&second).expect("insert second session");

    store
        .mark_dismissed("session-1", "2026-03-25T01:00:00Z")
        .expect("dismiss first session");
    store
        .mark_dismissed("session-2", "2026-03-25T03:00:00Z")
        .expect("dismiss second session");

    let restored = store
        .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T04:00:00Z")
        .expect("pop dismissed session")
        .expect("restored session exists");
    assert_eq!(restored.id, "session-2");
    assert_eq!(restored.dismissed_at, None);
    assert_eq!(restored.updated_at, "2026-03-25T04:00:00Z");

    let next = store
        .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T05:00:00Z")
        .expect("pop next dismissed session")
        .expect("next restored session exists");
    assert_eq!(next.id, "session-1");
    assert_eq!(next.dismissed_at, None);

    let none = store
        .pop_last_dismissed_in_workspace("workspace-1", "2026-03-25T06:00:00Z")
        .expect("pop empty dismissed stack");
    assert!(none.is_none());
}

fn subagent_link_record(
    id: &str,
    parent_session_id: &str,
    child_session_id: &str,
    label: &str,
) -> SessionLinkRecord {
    SessionLinkRecord {
        id: id.to_string(),
        public_id: Some(format!("subagent_{}", id.replace('-', ""))),
        relation: SessionLinkRelation::Subagent,
        parent_session_id: parent_session_id.to_string(),
        child_session_id: child_session_id.to_string(),
        workspace_relation: SessionLinkWorkspaceRelation::SameWorkspace,
        label: Some(label.to_string()),
        created_by_turn_id: None,
        created_by_tool_call_id: None,
        created_at: "2026-03-25T00:00:00Z".to_string(),
        closed_at: None,
        promoted_at: None,
        closed_by_session_id: None,
        close_reason: None,
    }
}

fn search_fixture() -> SessionStore {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    test_support::seed_workspace_with_repo_root(&db, "workspace-2", "local", "/tmp/workspace-2");
    let store = SessionStore::new(db);

    let mut caller = session_record();
    caller.id = "ses_caller".to_string();
    caller.title = Some("Refactor billing webhooks".to_string());
    caller.updated_at = "2026-03-25T03:00:00Z".to_string();
    store.insert(&caller).expect("insert caller");

    let mut peer = session_record();
    peer.id = "ses_peer".to_string();
    peer.workspace_id = "workspace-2".to_string();
    peer.title = Some("Deploy Checker".to_string());
    peer.updated_at = "2026-03-25T02:00:00Z".to_string();
    store.insert(&peer).expect("insert peer");

    let mut child = session_record();
    child.id = "ses_child".to_string();
    child.title = None;
    child.updated_at = "2026-03-25T01:00:00Z".to_string();
    store
        .insert_session_with_link(
            &child,
            &subagent_link_record("link-1", "ses_caller", "ses_child", "Schema audit"),
        )
        .expect("insert linked child");

    let mut closed = session_record();
    closed.id = "ses_closed".to_string();
    closed.title = Some("Deploy Checker (old)".to_string());
    closed.updated_at = "2026-03-25T00:30:00Z".to_string();
    closed.closed_at = Some("2026-03-25T00:45:00Z".to_string());
    closed.status = "closed".to_string();
    store.insert(&closed).expect("insert closed session");

    store
}

fn search_ids(store: &SessionStore, query: &SessionSearchQuery<'_>) -> Vec<String> {
    store
        .search_sessions(query)
        .expect("search sessions")
        .into_iter()
        .map(|record| record.id)
        .collect()
}

#[test]
fn session_search_spans_workspaces_and_orders_by_recency() {
    let store = search_fixture();

    let ids = search_ids(
        &store,
        &SessionSearchQuery {
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );

    assert_eq!(ids, vec!["ses_caller", "ses_peer", "ses_child"]);
}

#[test]
fn session_search_matches_titles_and_subagent_labels() {
    let store = search_fixture();

    let by_title = search_ids(
        &store,
        &SessionSearchQuery {
            text: Some("deploy"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(by_title, vec!["ses_peer"]);

    let by_label = search_ids(
        &store,
        &SessionSearchQuery {
            text: Some("schema AUDIT"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(by_label, vec!["ses_child"]);
}

#[test]
fn session_search_resolves_a_bare_session_id_including_closed_ones() {
    let store = search_fixture();

    let open = search_ids(
        &store,
        &SessionSearchQuery {
            session_id: Some("ses_peer"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(open, vec!["ses_peer"]);

    let closed_hidden = search_ids(
        &store,
        &SessionSearchQuery {
            session_id: Some("ses_closed"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert!(closed_hidden.is_empty());

    let closed_included = search_ids(
        &store,
        &SessionSearchQuery {
            session_id: Some("ses_closed"),
            include_closed: true,
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(closed_included, vec!["ses_closed"]);
}

#[test]
fn session_search_scopes_to_one_workspace_when_asked() {
    let store = search_fixture();

    let ids = search_ids(
        &store,
        &SessionSearchQuery {
            workspace_id: Some("workspace-2"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );

    assert_eq!(ids, vec!["ses_peer"]);
}

#[test]
fn session_search_pages_without_skipping_rows_that_share_a_timestamp() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    for id in ["ses_a", "ses_b", "ses_c"] {
        let mut record = session_record();
        record.id = id.to_string();
        record.updated_at = "2026-03-25T00:00:00Z".to_string();
        store.insert(&record).expect("insert session");
    }

    let first_page = store
        .search_sessions(&SessionSearchQuery {
            limit: 2,
            ..SessionSearchQuery::default()
        })
        .expect("first page");
    assert_eq!(
        first_page
            .iter()
            .map(|record| record.id.as_str())
            .collect::<Vec<_>>(),
        vec!["ses_c", "ses_b"]
    );

    let last = first_page.last().expect("cursor row");
    let cursor = SessionSearchCursor {
        updated_at: &last.updated_at,
        id: &last.id,
    };
    let second_page = search_ids(
        &store,
        &SessionSearchQuery {
            cursor: Some(cursor),
            limit: 2,
            ..SessionSearchQuery::default()
        },
    );

    assert_eq!(second_page, vec!["ses_a"]);
}

#[test]
fn session_search_clamps_the_page_size_to_the_maximum() {
    let store = search_fixture();

    let records = store
        .search_sessions(&SessionSearchQuery {
            limit: usize::MAX,
            ..SessionSearchQuery::default()
        })
        .expect("search sessions");

    assert!(records.len() <= SESSION_SEARCH_MAX_LIMIT);
    assert_eq!(records.len(), 3);
}

#[test]
fn session_search_hides_dismissed_sessions_from_the_peer_surface() {
    let store = search_fixture();
    let mut dismissed = session_record();
    dismissed.id = "ses_dismissed".to_string();
    dismissed.title = Some("Deploy Checker (dismissed)".to_string());
    dismissed.updated_at = "2026-03-25T04:00:00Z".to_string();
    dismissed.dismissed_at = Some("2026-03-25T04:30:00Z".to_string());
    store.insert(&dismissed).expect("insert dismissed session");

    // Not in the page, not resolvable by id, not resolvable with closed rows
    // included: the boot path refuses a dismissed session, so it is not a
    // messageable agent under any of the three ways in.
    let listed = search_ids(
        &store,
        &SessionSearchQuery {
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert!(!listed.contains(&"ses_dismissed".to_string()));

    for include_closed in [false, true] {
        let by_id = search_ids(
            &store,
            &SessionSearchQuery {
                session_id: Some("ses_dismissed"),
                include_closed,
                limit: SESSION_SEARCH_DEFAULT_LIMIT,
                ..SessionSearchQuery::default()
            },
        );
        assert!(by_id.is_empty(), "include_closed={include_closed}");
    }

    // Negative control: the same fixture still lists its open sessions.
    assert_eq!(listed, vec!["ses_caller", "ses_peer", "ses_child"]);
}

#[test]
fn session_search_hides_internal_only_sessions_from_the_peer_surface() {
    let store = search_fixture();
    let mut internal = session_record();
    internal.id = "ses_internal".to_string();
    internal.title = Some("Workflow step".to_string());
    internal.updated_at = "2026-03-25T04:00:00Z".to_string();
    internal.mcp_binding_policy =
        crate::domains::sessions::model::SessionMcpBindingPolicy::InternalOnly;
    store.insert(&internal).expect("insert internal session");

    let listed = search_ids(
        &store,
        &SessionSearchQuery {
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert!(!listed.contains(&"ses_internal".to_string()));

    let by_id = search_ids(
        &store,
        &SessionSearchQuery {
            session_id: Some("ses_internal"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert!(by_id.is_empty());
}

#[test]
fn session_search_treats_a_status_closed_row_as_closed() {
    // `authorize::is_closed` is `closed_at.is_some() || status == "closed"`.
    // Listing a row this predicate rejects would advertise a target that the
    // send then refuses.
    let store = search_fixture();
    let mut status_closed = session_record();
    status_closed.id = "ses_status_closed".to_string();
    status_closed.status = "closed".to_string();
    status_closed.closed_at = None;
    status_closed.updated_at = "2026-03-25T04:00:00Z".to_string();
    store.insert(&status_closed).expect("insert status-closed");

    let listed = search_ids(
        &store,
        &SessionSearchQuery {
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert!(!listed.contains(&"ses_status_closed".to_string()));

    let included = search_ids(
        &store,
        &SessionSearchQuery {
            session_id: Some("ses_status_closed"),
            include_closed: true,
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(included, vec!["ses_status_closed"]);
}

#[test]
fn session_search_matches_wildcard_characters_literally() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    let mut underscored = session_record();
    underscored.id = "ses_underscore".to_string();
    underscored.title = Some("deploy_checker".to_string());
    underscored.updated_at = "2026-03-25T02:00:00Z".to_string();
    store.insert(&underscored).expect("insert underscored");

    let mut lookalike = session_record();
    lookalike.id = "ses_lookalike".to_string();
    lookalike.title = Some("deployXchecker".to_string());
    lookalike.updated_at = "2026-03-25T01:00:00Z".to_string();
    store.insert(&lookalike).expect("insert lookalike");

    // `_` is a single-character wildcard in LIKE. The agent typed a name, not
    // a pattern.
    let literal = search_ids(
        &store,
        &SessionSearchQuery {
            text: Some("deploy_checker"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(literal, vec!["ses_underscore"]);

    // Same for `%`: a bare one used to match every row.
    let percent = search_ids(
        &store,
        &SessionSearchQuery {
            text: Some("%"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert!(percent.is_empty());
}

#[test]
fn session_search_folds_ascii_case_on_both_sides() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    let mut accented = session_record();
    accented.id = "ses_accented".to_string();
    accented.title = Some("École Deploy".to_string());
    store.insert(&accented).expect("insert accented");

    // ASCII case folds in both directions.
    for query in ["DEPLOY", "deploy"] {
        let ids = search_ids(
            &store,
            &SessionSearchQuery {
                text: Some(query),
                limit: SESSION_SEARCH_DEFAULT_LIMIT,
                ..SessionSearchQuery::default()
            },
        );
        assert_eq!(ids, vec!["ses_accented"], "query {query}");
    }

    // And a non-ASCII title is reachable by its own spelling, which the old
    // Rust-side `to_lowercase` made impossible.
    let exact = search_ids(
        &store,
        &SessionSearchQuery {
            text: Some("École"),
            limit: SESSION_SEARCH_DEFAULT_LIMIT,
            ..SessionSearchQuery::default()
        },
    );
    assert_eq!(exact, vec!["ses_accented"]);
}

#[test]
fn session_search_cursor_tokens_round_trip() {
    let cursor = SessionSearchCursor {
        updated_at: "2026-03-25T00:00:00Z",
        id: "ses_a",
    };

    let token = cursor.encode();

    assert_eq!(
        SessionSearchCursor::decode(&token),
        Some(("2026-03-25T00:00:00Z".to_string(), "ses_a".to_string()))
    );
    assert_eq!(SessionSearchCursor::decode("no-separator"), None);
    assert_eq!(SessionSearchCursor::decode("|ses_a"), None);
}
