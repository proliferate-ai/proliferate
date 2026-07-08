use super::*;
use crate::domains::sessions::model::SessionLiveConfigSnapshotRecord;
use crate::domains::sessions::prompt::{provenance::PromptProvenance, PromptPayload};

#[test]
fn reorder_pending_prompts_renumbers_seq_values() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    // Insert three prompts: seq 1, 2, 3
    store
        .insert_pending_prompt("session-1", "first", Some("p1"))
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "second", Some("p2"))
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "third", Some("p3"))
        .expect("insert");

    // Reorder: [3, 1, 2] → "third" becomes seq 1, "first" becomes seq 2, "second" becomes seq 3
    let reordered = store
        .reorder_pending_prompts("session-1", &[3, 1, 2])
        .expect("reorder");

    assert_eq!(reordered.len(), 3);
    assert_eq!(reordered[0].seq, 1);
    assert_eq!(reordered[0].text, "third");
    assert_eq!(reordered[1].seq, 2);
    assert_eq!(reordered[1].text, "first");
    assert_eq!(reordered[2].seq, 3);
    assert_eq!(reordered[2].text, "second");

    // Verify list also returns the reordered result
    let listed = store
        .list_pending_prompts("session-1")
        .expect("list");
    assert_eq!(listed[0].text, "third");
    assert_eq!(listed[1].text, "first");
    assert_eq!(listed[2].text, "second");
}

#[test]
fn reorder_pending_prompts_rejects_mismatched_seqs() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    store
        .insert_pending_prompt("session-1", "first", None)
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "second", None)
        .expect("insert");

    // Missing seq 2
    let result = store.reorder_pending_prompts("session-1", &[1]);
    assert!(result.is_err());

    // Extra seq 99
    let result = store.reorder_pending_prompts("session-1", &[1, 2, 99]);
    assert!(result.is_err());

    // Duplicate
    let result = store.reorder_pending_prompts("session-1", &[1, 1]);
    assert!(result.is_err());
}

#[test]
fn reorder_pending_prompts_rejects_duplicate_seqs_matching_existing_set() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    store
        .insert_pending_prompt("session-1", "first", Some("p1"))
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "second", Some("p2"))
        .expect("insert");

    // Regression: [2, 2, 1] deduplicates to the existing set {1, 2}. A dedup
    // -before-compare validation would accept it and corrupt the seq numbering.
    // Exact multiset equality must reject it (length 3 != 2, and it contains a
    // duplicate seq).
    let result = store.reorder_pending_prompts("session-1", &[2, 2, 1]);
    assert!(result.is_err());

    // The queue must be untouched: still exactly two rows at seq 1 and 2.
    let listed = store.list_pending_prompts("session-1").expect("list");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].seq, 1);
    assert_eq!(listed[0].text, "first");
    assert_eq!(listed[1].seq, 2);
    assert_eq!(listed[1].text, "second");
}

#[test]
fn reorder_promotes_target_to_head_like_steer() {
    // Mirrors the reorder that handle_steer_pending_prompt builds: target first,
    // then the remaining prompts in their original order. The full steer method
    // (which also sends a CancelNotification and resolves pending interactions)
    // can't be exercised here — the actor test harness has no fake ACP
    // connection — so this covers the store-level promotion it relies on.
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    store
        .insert_pending_prompt("session-1", "first", Some("p1"))
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "second", Some("p2"))
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "third", Some("p3"))
        .expect("insert");

    // Steer seq 3 to head: new order = [3, 1, 2].
    let target = 3;
    let current = store.list_pending_prompts("session-1").expect("list");
    let mut new_order = vec![target];
    for record in &current {
        if record.seq != target {
            new_order.push(record.seq);
        }
    }

    let reordered = store
        .reorder_pending_prompts("session-1", &new_order)
        .expect("reorder");
    assert_eq!(reordered[0].text, "third");
    assert_eq!(reordered[0].seq, 1);
    assert_eq!(reordered[1].text, "first");
    assert_eq!(reordered[2].text, "second");

    // The promoted prompt is now the drain head.
    let head = store
        .peek_head_pending_prompt("session-1")
        .expect("peek")
        .expect("head exists");
    assert_eq!(head.text, "third");
}

#[test]
fn reorder_pending_prompts_same_order_is_noop() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    store
        .insert_pending_prompt("session-1", "first", Some("p1"))
        .expect("insert");
    store
        .insert_pending_prompt("session-1", "second", Some("p2"))
        .expect("insert");

    let reordered = store
        .reorder_pending_prompts("session-1", &[1, 2])
        .expect("reorder");
    assert_eq!(reordered.len(), 2);
    assert_eq!(reordered[0].seq, 1);
    assert_eq!(reordered[0].text, "first");
    assert_eq!(reordered[1].seq, 2);
    assert_eq!(reordered[1].text, "second");

    let listed = store.list_pending_prompts("session-1").expect("list");
    assert_eq!(listed[0].text, "first");
    assert_eq!(listed[1].text, "second");
}

#[test]
fn reorder_empty_queue_with_empty_request_is_noop() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");

    // Empty request against an empty queue is exact multiset equality (both
    // empty) and must succeed as a no-op returning no records.
    let reordered = store
        .reorder_pending_prompts("session-1", &[])
        .expect("reorder empty");
    assert!(reordered.is_empty());

    // A non-empty request against an empty queue is a count mismatch → error.
    let result = store.reorder_pending_prompts("session-1", &[1]);
    assert!(result.is_err());
}

/// Equality proof for the batched list-page queries: the bulk forms must
/// return exactly what the per-session queries return, so the list endpoint's
/// switch from N+1 to batched fetching cannot change the response.
#[test]
fn batched_page_queries_match_single_session_queries() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

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
