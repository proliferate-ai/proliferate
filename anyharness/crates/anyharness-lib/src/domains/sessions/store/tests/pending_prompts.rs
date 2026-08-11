use super::*;
use crate::domains::sessions::model::{
    PendingPromptReorderOutcome, SessionLiveConfigSnapshotRecord,
};
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};

/// Equality proof for the batched list-page queries: the bulk forms must
/// return exactly what the per-session queries return, so the list endpoint's
/// switch from N+1 to batched fetching cannot change the response.
#[test]
fn batched_page_queries_match_single_session_queries() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());

    let session_ids: Vec<String> = ["session-1", "session-2", "session-3"]
        .iter()
        .map(|id| id.to_string())
        .collect();
    for id in &session_ids {
        let mut record = session_record();
        record.id = id.clone();
        store.insert(&record).expect("insert session");
    }

    // session-1: two prompts + live config; session-2: one prompt; session-3: nothing.
    store
        .insert_pending_prompt("session-1", "first", Some("prompt-1"))
        .expect("insert prompt");
    store
        .insert_pending_prompt("session-1", "second", None)
        .expect("insert prompt");
    store
        .insert_pending_prompt("session-2", "other", None)
        .expect("insert prompt");
    store
        .upsert_live_config_snapshot(&SessionLiveConfigSnapshotRecord {
            session_id: "session-1".to_string(),
            source_seq: 4,
            raw_config_options_json: "[]".to_string(),
            normalized_controls_json: "{}".to_string(),
            prompt_capabilities_json: None,
            updated_at: "2026-04-11T00:00:05Z".to_string(),
        })
        .expect("upsert live config");

    let batched_prompts = store
        .list_pending_prompts_for_sessions(&session_ids)
        .expect("batched prompts");
    let batched_configs = store
        .find_live_config_snapshots(&session_ids)
        .expect("batched configs");

    for id in &session_ids {
        let single = store.list_pending_prompts(id).expect("single prompts");
        let batched = batched_prompts.get(id).cloned().unwrap_or_default();
        assert_eq!(
            format!("{batched:?}"),
            format!("{single:?}"),
            "pending prompts diverge for {id}"
        );

        let single_config = store.find_live_config_snapshot(id).expect("single config");
        assert_eq!(
            format!("{:?}", batched_configs.get(id)),
            format!("{:?}", single_config.as_ref()),
            "live config diverges for {id}"
        );
    }
}

#[test]
fn pending_prompt_preserves_internal_provenance_through_load_edit_and_drain() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    let payload = PromptPayload {
        text_summary: "delegate this".to_string(),
        blocks: vec![],
        provenance: Some(PromptProvenance::AgentSession {
            source_session_id: "parent-session".to_string(),
            session_link_id: Some("link-1".to_string()),
            label: Some("Parent agent".to_string()),
        }),
    };

    let inserted = store
        .insert_pending_prompt_payload("session-1", &payload, Some("prompt-1"))
        .expect("insert pending prompt");
    assert!(inserted.provenance_json.is_some());

    let loaded = store
        .find_pending_prompt("session-1", inserted.seq)
        .expect("find prompt")
        .expect("prompt exists");
    assert_eq!(loaded.prompt_payload().provenance, payload.provenance);

    store
        .update_pending_prompt_text("session-1", inserted.seq, "edited")
        .expect("edit prompt");
    let edited = store
        .find_pending_prompt("session-1", inserted.seq)
        .expect("find edited prompt")
        .expect("edited prompt exists");
    assert_eq!(edited.text, "edited");
    assert_eq!(edited.prompt_payload().provenance, payload.provenance);

    let drained = store
        .delete_pending_prompt_record("session-1", inserted.seq)
        .expect("drain prompt")
        .expect("drained prompt exists");
    assert_eq!(drained.prompt_payload().provenance, payload.provenance);
}

#[test]
fn pending_prompts_reorder_atomically_without_changing_entry_identity() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    for (text, prompt_id) in [
        ("first", "prompt-1"),
        ("second", "prompt-2"),
        ("third", "prompt-3"),
    ] {
        store
            .insert_pending_prompt("session-1", text, Some(prompt_id))
            .expect("insert pending prompt");
    }

    let reordered = store
        .reorder_pending_prompts("session-1", &[1, 2, 3], &[3, 1, 2])
        .expect("reorder pending prompts");
    let PendingPromptReorderOutcome::Reordered(reordered) = reordered else {
        panic!("expected committed reorder");
    };

    assert_eq!(
        reordered
            .iter()
            .map(|record| (record.seq, record.prompt_id.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            (3, Some("prompt-3")),
            (1, Some("prompt-1")),
            (2, Some("prompt-2")),
        ],
    );
    let persisted = store
        .list_pending_prompts("session-1")
        .expect("list pending prompts");
    assert_eq!(
        persisted
            .iter()
            .map(|record| (record.seq, record.prompt_id.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            (3, Some("prompt-3")),
            (1, Some("prompt-1")),
            (2, Some("prompt-2")),
        ],
    );

    store
        .update_pending_prompt_text("session-1", 1, "edited first")
        .expect("edit stable queue id");
    assert_eq!(
        store
            .find_pending_prompt("session-1", 1)
            .expect("find stable queue id")
            .expect("queue entry exists")
            .text,
        "edited first",
    );
}

#[test]
fn pending_prompt_reorder_rejects_non_permutations_without_mutating_the_queue() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    store
        .insert_pending_prompt("session-1", "first", Some("prompt-1"))
        .expect("insert prompt");
    store
        .insert_pending_prompt("session-1", "second", Some("prompt-2"))
        .expect("insert prompt");

    for invalid_order in [vec![1], vec![1, 3], vec![1, 1]] {
        let outcome = store
            .reorder_pending_prompts("session-1", &[1, 2], &invalid_order)
            .expect("validation is a typed outcome");
        assert!(matches!(
            outcome,
            PendingPromptReorderOutcome::Invalid { .. }
        ));
        let persisted = store
            .list_pending_prompts("session-1")
            .expect("list pending prompts");
        assert_eq!(
            persisted
                .iter()
                .map(|record| (record.seq, record.prompt_id.as_deref()))
                .collect::<Vec<_>>(),
            vec![(1, Some("prompt-1")), (2, Some("prompt-2"))],
        );
    }
}

#[test]
fn pending_prompt_reorder_rejects_stale_same_membership_order() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    for text in ["first", "second", "third"] {
        store
            .insert_pending_prompt("session-1", text, None)
            .expect("insert prompt");
    }

    let first = store
        .reorder_pending_prompts("session-1", &[1, 2, 3], &[2, 1, 3])
        .expect("first reorder");
    assert!(matches!(first, PendingPromptReorderOutcome::Reordered(_)));

    let stale = store
        .reorder_pending_prompts("session-1", &[1, 2, 3], &[3, 2, 1])
        .expect("stale reorder is typed");
    assert_eq!(
        stale,
        PendingPromptReorderOutcome::Stale {
            current_seqs: vec![2, 1, 3],
        },
    );
    assert_eq!(
        store
            .list_pending_prompts("session-1")
            .expect("persisted order")
            .into_iter()
            .map(|record| record.seq)
            .collect::<Vec<_>>(),
        vec![2, 1, 3],
    );
}

#[test]
fn pending_prompt_sequence_is_not_reused_after_queue_becomes_empty() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db.clone());
    store.insert(&session_record()).expect("insert session");

    let old = store
        .insert_pending_prompt("session-1", "old", None)
        .expect("insert old prompt");
    assert_eq!(old.seq, 1);
    assert!(store
        .delete_pending_prompt("session-1", old.seq)
        .expect("delete old prompt"));
    assert!(store
        .list_pending_prompts("session-1")
        .expect("empty queue")
        .is_empty());
    drop(store);

    let store = SessionStore::new(db);
    let replacement = store
        .insert_pending_prompt("session-1", "replacement", None)
        .expect("insert replacement prompt");
    assert_eq!(replacement.seq, 2);
    assert_ne!(replacement.seq, old.seq);
}
