//! Forks ADR rung 2: pure resolution of a fork boundary against the parent's
//! durable `session_events`, plus the exact-copied-prefix digest recorded in
//! `fork_operations` and verified at exact-prefix recovery (ADR 4.3/4.4).
//!
//! Data-in / data-out: the IO layer (`fork.rs`) lists the parent events and
//! feeds them in; this module owns the eligibility rules and the digest.

use anyharness_contract::v1::{ForkSessionTarget, SessionEvent, TranscriptItemKind};
use sha2::{Digest, Sha256};

use crate::domains::sessions::model::SessionEventRecord;

const ITEM_COMPLETED: &str = "item_completed";
const TURN_ENDED: &str = "turn_ended";

/// Why a targeted fork boundary is not usable. Maps 1:1 to the stable HTTP
/// reasons in ADR 4.8.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForkTargetError {
    /// `item_id` is required at the product boundary (ruling Q1). The wire
    /// field stays optional; an item-less target is rejected here.
    ItemIdRequired,
    /// No committed user-message event matches `(turn_id, item_id)`.
    TargetNotFound,
    /// The matched message's turn has not committed (no `turn_ended`).
    BoundaryNotCommitted,
}

/// A resolved targeted boundary: the anchor, the terminal seq of the copied
/// prefix (the last event strictly before the anchor message; `0` when the
/// anchor is the first event), and the digest over that exact prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedForkBoundary {
    pub anchor_turn_id: String,
    pub anchor_item_id: String,
    pub prefix_terminal_seq: i64,
    pub prefix_digest: String,
}

/// The tip boundary: the whole committed transcript is the copied prefix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TipForkBoundary {
    pub prefix_terminal_seq: i64,
    pub prefix_digest: String,
}

/// Resolve a targeted `before_user_message` boundary. `events` must be the
/// parent's events ordered by ascending `seq`.
pub fn resolve_targeted_boundary(
    events: &[SessionEventRecord],
    target: &ForkSessionTarget,
) -> Result<ResolvedForkBoundary, ForkTargetError> {
    let item_id = target
        .item_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ForkTargetError::ItemIdRequired)?;

    let anchor = events
        .iter()
        .find(|event| {
            event.event_type == ITEM_COMPLETED
                && event.turn_id.as_deref() == Some(target.turn_id.as_str())
                && event.item_id.as_deref() == Some(item_id)
                && is_user_message(event)
        })
        .ok_or(ForkTargetError::TargetNotFound)?;

    // Committed = the anchor's turn produced a `turn_ended`. At the idle fork
    // gate this always holds; the check keeps the invariant explicit and guards
    // the boundary if the gate ever loosens.
    let turn_committed = events.iter().any(|event| {
        event.event_type == TURN_ENDED && event.turn_id.as_deref() == Some(target.turn_id.as_str())
    });
    if !turn_committed {
        return Err(ForkTargetError::BoundaryNotCommitted);
    }

    let prefix: Vec<&SessionEventRecord> = events
        .iter()
        .filter(|event| event.seq < anchor.seq)
        .collect();
    let prefix_terminal_seq = prefix.last().map(|event| event.seq).unwrap_or(0);
    Ok(ResolvedForkBoundary {
        anchor_turn_id: target.turn_id.clone(),
        anchor_item_id: item_id.to_string(),
        prefix_terminal_seq,
        prefix_digest: digest_prefix(prefix.into_iter()),
    })
}

/// The tip boundary over the full committed transcript.
pub fn tip_boundary(events: &[SessionEventRecord]) -> TipForkBoundary {
    TipForkBoundary {
        prefix_terminal_seq: events.last().map(|event| event.seq).unwrap_or(0),
        prefix_digest: digest_prefix(events.iter()),
    }
}

/// Deterministic digest over an ordered event prefix. Any change to the copied
/// prefix's shape or content changes the digest, so exact-prefix recovery can
/// refuse to go live on a drifted transcript (ADR 4.4).
fn digest_prefix<'a, I>(events: I) -> String
where
    I: Iterator<Item = &'a SessionEventRecord>,
{
    let mut hasher = Sha256::new();
    for event in events {
        hasher.update(event.seq.to_le_bytes());
        hasher.update([0u8]);
        hasher.update(event.event_type.as_bytes());
        hasher.update([0u8]);
        hasher.update(event.turn_id.as_deref().unwrap_or("").as_bytes());
        hasher.update([0u8]);
        hasher.update(event.item_id.as_deref().unwrap_or("").as_bytes());
        hasher.update([0u8]);
        hasher.update(event.payload_json.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

fn is_user_message(event: &SessionEventRecord) -> bool {
    match serde_json::from_str::<SessionEvent>(&event.payload_json) {
        Ok(SessionEvent::ItemCompleted(completed)) => {
            matches!(completed.item.kind, TranscriptItemKind::UserMessage)
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyharness_contract::v1::ForkSessionTargetType;

    fn event(
        seq: i64,
        event_type: &str,
        turn: &str,
        item: &str,
        payload: &str,
    ) -> SessionEventRecord {
        SessionEventRecord {
            id: seq,
            session_id: "parent".to_string(),
            seq,
            timestamp: "2026-08-16T00:00:00Z".to_string(),
            event_type: event_type.to_string(),
            turn_id: Some(turn.to_string()),
            item_id: (!item.is_empty()).then(|| item.to_string()),
            payload_json: payload.to_string(),
        }
    }

    fn user_message(seq: i64, turn: &str, item: &str, text: &str) -> SessionEventRecord {
        let payload = serde_json::json!({
            "type": "item_completed",
            "item": {
                "id": item,
                "kind": "user_message",
                "status": "completed",
                "sourceAgentKind": "claude",
                "contentParts": [{ "type": "text", "text": text }],
            }
        });
        event(seq, ITEM_COMPLETED, turn, item, &payload.to_string())
    }

    fn target(turn: &str, item: Option<&str>) -> ForkSessionTarget {
        ForkSessionTarget {
            target_type: ForkSessionTargetType::BeforeUserMessage,
            turn_id: turn.to_string(),
            item_id: item.map(str::to_string),
        }
    }

    fn sample() -> Vec<SessionEventRecord> {
        vec![
            user_message(1, "t1", "u1", "first"),
            event(
                2,
                "item_completed",
                "t1",
                "a1",
                r#"{"type":"item_completed","item":{"kind":"assistant_message","status":"completed","sourceAgentKind":"claude","contentParts":[]}}"#,
            ),
            event(
                3,
                TURN_ENDED,
                "t1",
                "",
                r#"{"type":"turn_ended","turnId":"t1"}"#,
            ),
            user_message(4, "t2", "u2", "second"),
            event(
                5,
                TURN_ENDED,
                "t2",
                "",
                r#"{"type":"turn_ended","turnId":"t2"}"#,
            ),
        ]
    }

    #[test]
    fn item_id_is_required() {
        let error = resolve_targeted_boundary(&sample(), &target("t2", None)).unwrap_err();
        assert_eq!(error, ForkTargetError::ItemIdRequired);
    }

    #[test]
    fn unknown_anchor_is_target_not_found() {
        let error = resolve_targeted_boundary(&sample(), &target("t2", Some("nope"))).unwrap_err();
        assert_eq!(error, ForkTargetError::TargetNotFound);
    }

    #[test]
    fn assistant_item_is_not_a_valid_anchor() {
        // a1 is an assistant message, not selectable.
        let error = resolve_targeted_boundary(&sample(), &target("t1", Some("a1"))).unwrap_err();
        assert_eq!(error, ForkTargetError::TargetNotFound);
    }

    #[test]
    fn uncommitted_turn_is_rejected() {
        let mut events = sample();
        events.retain(|event| {
            !(event.event_type == TURN_ENDED && event.turn_id.as_deref() == Some("t2"))
        });
        let error = resolve_targeted_boundary(&events, &target("t2", Some("u2"))).unwrap_err();
        assert_eq!(error, ForkTargetError::BoundaryNotCommitted);
    }

    #[test]
    fn resolves_prefix_before_the_anchor_message() {
        let resolved = resolve_targeted_boundary(&sample(), &target("t2", Some("u2"))).unwrap();
        assert_eq!(resolved.anchor_item_id, "u2");
        // Everything strictly before seq 4.
        assert_eq!(resolved.prefix_terminal_seq, 3);
    }

    #[test]
    fn distinct_boundaries_have_distinct_digests() {
        let first = resolve_targeted_boundary(&sample(), &target("t2", Some("u2"))).unwrap();
        // Anchor at the very first message: empty prefix, terminal seq 0.
        let second = resolve_targeted_boundary(&sample(), &target("t1", Some("u1"))).unwrap();
        assert_eq!(second.prefix_terminal_seq, 0);
        assert_ne!(first.prefix_digest, second.prefix_digest);
    }

    #[test]
    fn tip_boundary_covers_the_whole_transcript() {
        let tip = tip_boundary(&sample());
        assert_eq!(tip.prefix_terminal_seq, 5);
        // The tip digest differs from any interior boundary digest.
        let interior = resolve_targeted_boundary(&sample(), &target("t2", Some("u2"))).unwrap();
        assert_ne!(tip.prefix_digest, interior.prefix_digest);
    }
}
