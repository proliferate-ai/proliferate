//! Forks ADR R9 (rung 1c) Tier-2 fixtures: legacy Claude/Codex session
//! metadata loaded under the new (canonical) adapter dialect, asserting an
//! explicit compatible load OR a typed, actionable incompatibility -- never a
//! silent reinterpretation. Includes the negative control (a canonical session
//! reattached under the old adapter must fail closed) and a regression pin that
//! durable normalized transcripts render regardless of the marker outcome.

use super::*;
use crate::domains::sessions::adapter_migration::{
    resolve_reattach_compatibility, CompatibleLoad, IncompatibilityReason, MetadataDialect,
    SessionAdapterMarker,
};
use crate::domains::sessions::model::SessionEventRecord;

// Pinned pre-migration adapters (Forks ADR §2 "Adapter pins").
const CLAUDE_LEGACY: &str = "0.59.0-proliferate.1";
const CODEX_LEGACY: &str = "0.18.3-proliferate.1";
// Canonical-migrated adapters (RUNG-1B §1 coordinates).
const CLAUDE_CANONICAL: &str = "0.66.0-proliferate.1";
const CODEX_CANONICAL: &str = "1.1.14-proliferate.1";

/// Seed one legacy session fixture: a session row created under a pinned
/// pre-migration adapter, its stamped marker, and one durable transcript event.
fn seed_legacy_fixture(
    store: &SessionStore,
    id: &str,
    agent_kind: &str,
    adapter_version: &str,
    native_version: &str,
) {
    let mut record = session_record();
    record.id = id.to_string();
    record.agent_kind = agent_kind.to_string();
    record.native_session_id = Some(format!("native-{id}"));
    store.insert(&record).expect("insert legacy session");

    store
        .upsert_adapter_marker(
            id,
            &SessionAdapterMarker::new(
                Some(adapter_version.to_string()),
                Some(native_version.to_string()),
            ),
            "2026-08-16T00:00:00Z",
        )
        .expect("stamp legacy marker");

    // A durable normalized transcript event (runtime-owned; dialect-independent).
    store
        .append_event(&SessionEventRecord {
            id: 0,
            session_id: id.to_string(),
            seq: 1,
            timestamp: "2026-08-16T00:01:00Z".to_string(),
            event_type: "turn_started".to_string(),
            turn_id: Some("turn-1".to_string()),
            item_id: None,
            payload_json: r#"{"type":"turn_started"}"#.to_string(),
        })
        .expect("append transcript event");
}

#[test]
fn marker_round_trips_through_the_store() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    seed_legacy_fixture(&store, "session-1", "claude", CLAUDE_LEGACY, "2.1.212");

    let marker = store
        .find_adapter_marker("session-1")
        .expect("read marker")
        .expect("marker present");
    assert_eq!(marker.adapter_version.as_deref(), Some(CLAUDE_LEGACY));
    assert_eq!(marker.native_version.as_deref(), Some("2.1.212"));

    // A session with no marker row is the pinned pre-migration floor (None).
    let mut unmarked = session_record();
    unmarked.id = "session-unmarked".to_string();
    store.insert(&unmarked).expect("insert unmarked session");
    assert_eq!(
        store
            .find_adapter_marker("session-unmarked")
            .expect("read unmarked marker"),
        None
    );
}

#[test]
fn legacy_claude_and_codex_fixtures_dual_read_forward_under_canonical() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    seed_legacy_fixture(&store, "claude-legacy", "claude", CLAUDE_LEGACY, "2.1.212");
    seed_legacy_fixture(&store, "codex-legacy", "codex", CODEX_LEGACY, "0.144.5");

    for (id, kind, canonical) in [
        ("claude-legacy", "claude", CLAUDE_CANONICAL),
        ("codex-legacy", "codex", CODEX_CANONICAL),
    ] {
        let marker = store.find_adapter_marker(id).expect("read marker").unwrap();
        let load = resolve_reattach_compatibility(kind, &marker, Some(canonical))
            .expect("legacy fixture loads through the compatible dual-read path");
        assert_eq!(
            load,
            CompatibleLoad::DualReadForward {
                created_dialect: MetadataDialect::PinnedLegacy,
                current_dialect: MetadataDialect::CanonicalMigrated,
            },
            "{id} must load through an explicit forward dual-read, not a silent canonical read"
        );
    }
}

#[test]
fn canonical_session_under_old_adapter_fails_closed_negative_control() {
    // NEGATIVE CONTROL: a session created under the canonical adapter, then
    // reattached under the OLD pinned adapter (the ADR rung-1 catalog-revert
    // path). The old adapter cannot read the canonical dialect; loading it would
    // be the cardinal-sin silent reinterpretation. The marker/dialect check must
    // fail closed with a typed downgrade incompatibility.
    //
    // Reverting the fix (the `Ordering::Less` downgrade arm in
    // adapter_migration.rs) makes this reattach return Ok and this test fails --
    // that is the negative control the ADR §5 test row requires.
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    seed_legacy_fixture(
        &store,
        "codex-canonical",
        "codex",
        CODEX_CANONICAL,
        "0.147.0",
    );

    let marker = store
        .find_adapter_marker("codex-canonical")
        .expect("read marker")
        .unwrap();
    let err = resolve_reattach_compatibility("codex", &marker, Some(CODEX_LEGACY))
        .expect_err("canonical-under-legacy must fail closed");
    assert!(matches!(
        err.reason,
        IncompatibilityReason::DialectDowngrade { .. }
    ));
}

#[test]
fn durable_transcript_renders_regardless_of_marker_outcome() {
    // R9: durable normalized transcripts are runtime-owned and remain readable
    // even when the metadata reattach is incompatible. A canonical session whose
    // reattach under the old adapter is REFUSED must still yield its events.
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    seed_legacy_fixture(
        &store,
        "codex-canonical",
        "codex",
        CODEX_CANONICAL,
        "0.147.0",
    );

    let marker = store
        .find_adapter_marker("codex-canonical")
        .expect("read marker")
        .unwrap();
    // Reattach decision is incompatible...
    assert!(resolve_reattach_compatibility("codex", &marker, Some(CODEX_LEGACY)).is_err());

    // ...yet the durable transcript is still fully readable.
    let events = store.list_events("codex-canonical").expect("list events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event_type, "turn_started");
}

#[test]
fn deleting_a_session_removes_its_marker() {
    let db = Db::open_in_memory().expect("open db");
    seed_workspace(&db);
    let store = SessionStore::new(db);

    seed_legacy_fixture(&store, "session-1", "claude", CLAUDE_LEGACY, "2.1.212");
    assert!(store
        .find_adapter_marker("session-1")
        .expect("read marker")
        .is_some());

    store.delete_session("session-1").expect("delete session");
    assert_eq!(
        store
            .find_adapter_marker("session-1")
            .expect("read marker after delete"),
        None
    );
}
