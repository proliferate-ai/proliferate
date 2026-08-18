//! The vendor OpenCode message-id mapping store. Pins the
//! first-writer-wins contract that the sink→actor capture relies on — a
//! replayed or duplicated user-message echo must never clobber the first
//! observed id, and an unmapped identity must translate to `None` (which the
//! fork dispatch treats as `TARGET_NOT_FOUND`, never an ordinal guess).

use super::SessionStore;
use crate::persistence::Db;

fn store() -> SessionStore {
    SessionStore::new(Db::open_in_memory().expect("open db"))
}

#[test]
fn first_writer_wins_and_duplicate_echo_is_ignored() {
    let store = store();
    store
        .insert_opencode_message_id("s1", "t1", "i1", "msg_first", "2026-08-17T00:00:00Z")
        .expect("first insert");
    // A replayed echo for the same identity must not overwrite the first id.
    store
        .insert_opencode_message_id("s1", "t1", "i1", "msg_second", "2026-08-17T00:00:01Z")
        .expect("duplicate insert is a no-op");

    let found = store
        .find_opencode_message_id("s1", "t1", "i1")
        .expect("lookup");
    assert_eq!(found.as_deref(), Some("msg_first"));
}

#[test]
fn distinct_identities_map_independently() {
    let store = store();
    store
        .insert_opencode_message_id("s1", "t1", "i1", "msg_a", "2026-08-17T00:00:00Z")
        .expect("insert a");
    store
        .insert_opencode_message_id("s1", "t2", "i2", "msg_b", "2026-08-17T00:00:00Z")
        .expect("insert b");

    assert_eq!(
        store
            .find_opencode_message_id("s1", "t1", "i1")
            .expect("lookup a")
            .as_deref(),
        Some("msg_a")
    );
    assert_eq!(
        store
            .find_opencode_message_id("s1", "t2", "i2")
            .expect("lookup b")
            .as_deref(),
        Some("msg_b")
    );
}

#[test]
fn unmapped_identity_is_none() {
    let store = store();
    assert_eq!(
        store
            .find_opencode_message_id("s1", "t1", "i1")
            .expect("lookup"),
        None
    );
}
