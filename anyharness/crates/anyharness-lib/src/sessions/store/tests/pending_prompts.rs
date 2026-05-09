use super::*;
use crate::sessions::prompt::{PromptPayload, PromptProvenance};

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
