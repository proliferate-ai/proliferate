use super::*;
use crate::domains::sessions::model::SessionEventRecord;
use anyharness_contract::v1::{PendingPromptAddedPayload, SessionEvent};

#[test]
fn added_event_detection_uses_the_exact_current_prompt_projection() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);

    let store = SessionStore::new(db);
    store.insert(&session_record()).expect("insert session");
    let mut pending = store
        .insert_pending_prompt("session-1", "new prompt", Some("prompt-old"))
        .expect("insert prompt");
    pending.blocks_json = Some(r#"[{"type":"text","text":"new prompt"}]"#.to_string());
    assert!(!store
        .has_pending_prompt_added_event(&pending)
        .expect("check empty prompt history"));

    append_pending_prompt_added(&store, &pending, 1);

    assert!(store
        .has_pending_prompt_added_event(&pending)
        .expect("find exact prompt projection"));

    let mut mismatches = Vec::new();
    let mut reused_allocation = pending.clone();
    reused_allocation.queued_at = "2026-03-25T00:02:00Z".to_string();
    mismatches.push(("queued_at", reused_allocation));
    let mut changed_prompt_id = pending.clone();
    changed_prompt_id.prompt_id = None;
    mismatches.push(("prompt_id", changed_prompt_id));
    let mut changed_text = pending.clone();
    changed_text.text = "rewritten summary".to_string();
    mismatches.push(("text", changed_text));
    let mut changed_content = pending.clone();
    changed_content.blocks_json =
        Some(r#"[{"type":"text","text":"rewritten content"}]"#.to_string());
    mismatches.push(("content_parts", changed_content));
    let mut changed_provenance = pending.clone();
    changed_provenance.provenance_json =
        Some(r#"{"kind":"system","label":"replacement"}"#.to_string());
    mismatches.push(("prompt_provenance", changed_provenance));

    for (field, mismatch) in mismatches {
        assert!(
            !store
                .has_pending_prompt_added_event(&mismatch)
                .expect("inspect prompt projection"),
            "an old Added event must not match changed {field}"
        );
    }

    let mut rewritten = pending.clone();
    rewritten.prompt_id = None;
    rewritten.text = "rewritten summary".to_string();
    rewritten.blocks_json = Some(r#"[{"type":"text","text":"rewritten content"}]"#.to_string());
    rewritten.provenance_json = Some(r#"{"kind":"system","label":"replacement"}"#.to_string());
    assert!(!store
        .has_pending_prompt_added_event(&rewritten)
        .expect("old event does not describe rewritten row"));

    append_pending_prompt_added(&store, &rewritten, 2);
    assert!(store
        .has_pending_prompt_added_event(&rewritten)
        .expect("replacement event describes rewritten row"));
}

fn append_pending_prompt_added(
    store: &SessionStore,
    pending: &crate::domains::sessions::model::PendingPromptRecord,
    event_seq: i64,
) {
    let current = pending.to_contract();
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: pending.session_id.clone(),
            seq: event_seq,
            timestamp: "2026-03-25T00:01:00Z".to_string(),
            event_type: "pending_prompt_added".to_string(),
            turn_id: None,
            item_id: None,
            payload_json: serde_json::to_string(&SessionEvent::PendingPromptAdded(
                PendingPromptAddedPayload {
                    seq: current.seq,
                    prompt_id: current.prompt_id,
                    text: current.text,
                    content_parts: current.content_parts,
                    queued_at: current.queued_at,
                    prompt_provenance: current.prompt_provenance,
                },
            ))
            .expect("serialize pending_prompt_added"),
        })
        .expect("append pending_prompt_added");
}
