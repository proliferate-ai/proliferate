//! Forks ADR 4.3: translate a resolved kept-prefix boundary into a
//! provider-native fork anchor. The inclusive anchor is the last kept
//! message/turn — dispatch must never send a targeted fork request without
//! one (cardinal sin: an anchor-less targeted fork silently degrades to a
//! tip fork).
//!
//! Data-in / data-out: the IO layer (`fork.rs`) lists the parent events and
//! the resolved boundary's `prefix_terminal_seq`; this module owns the
//! per-provider derivation rule only.

use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::model::SessionEventRecord;

const ITEM_COMPLETED: &str = "item_completed";

/// A provider-native fork anchor derived from the kept prefix (Forks ADR 4.3:
/// inclusive anchor = the last kept message/turn). Threaded onto the outbound
/// ACP ForkSessionRequest `_meta.anyharness`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderForkAnchor {
    /// Claude: ACP-visible message id of the last kept message (inclusive),
    /// sent as `_meta.anyharness.upToMessageId`.
    UpToMessageId(String),
    /// Codex: native turn id of the last kept turn (inclusive), sent as
    /// `_meta.anyharness.lastTurnId`.
    LastTurnId(String),
}

impl ProviderForkAnchor {
    pub fn provider_anchor_kind(&self) -> &'static str {
        match self {
            Self::UpToMessageId(_) => "message_id",
            Self::LastTurnId(_) => "turn_id",
        }
    }

    pub fn value(&self) -> &str {
        match self {
            Self::UpToMessageId(value) | Self::LastTurnId(value) => value,
        }
    }

    /// `_meta` key on the outbound fork request.
    pub fn meta_key(&self) -> &'static str {
        match self {
            Self::UpToMessageId(_) => "upToMessageId",
            Self::LastTurnId(_) => "lastTurnId",
        }
    }

    /// The `_meta.anyharness` object to merge onto the outbound ACP fork
    /// request. Kept here (domains) rather than as a `live::` helper: `live`
    /// already depends on `domains`, so this is the correct layering.
    pub fn anchor_meta_json(&self) -> serde_json::Value {
        serde_json::json!({ "anyharness": { self.meta_key(): self.value() } })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderAnchorError {
    /// No kept event yields a provider-visible anchor id — the targeted fork
    /// MUST fail (TARGET_NOT_FOUND), never dispatch anchor-less (cardinal sin).
    NotDerivable,
    /// No translator exists for this agent kind; an advertised capability
    /// without a translator fails closed the same way.
    UnsupportedAgentKind,
}

/// Derive the provider anchor for a targeted fork's kept prefix. `events`
/// must be the parent's events ordered by ascending `seq`.
pub fn derive_provider_anchor(
    agent_kind: &str,
    events: &[SessionEventRecord],
    prefix_terminal_seq: i64,
) -> Result<ProviderForkAnchor, ProviderAnchorError> {
    if agent_kind == AgentKind::Claude.as_str() {
        return derive_claude_anchor(events, prefix_terminal_seq);
    }
    if agent_kind == AgentKind::Codex.as_str() {
        // The shipped adapter (v1.1.14-proliferate.2) does not expose native
        // turn ids on the ACP wire (Q-R2 fail, 2026-08-18); the Codex
        // targeted path stays fail-closed until an adapter emits them.
        return Err(ProviderAnchorError::NotDerivable);
    }
    Err(ProviderAnchorError::UnsupportedAgentKind)
}

fn derive_claude_anchor(
    events: &[SessionEventRecord],
    prefix_terminal_seq: i64,
) -> Result<ProviderForkAnchor, ProviderAnchorError> {
    // Payloads are read as raw JSON, not contract types (AH-CONTRACT-1: the
    // domain does not name wire shapes). The `item.kind` values and the
    // `messageId` key are the persisted `item_completed` shape the sink owns
    // (sink/ingest.rs); `fork_boundary` reads the same shape.
    //
    // Backward walk from the boundary: a kept `item_completed` payload that
    // fails to parse (or whose `item.kind` cannot be read) encountered BEFORE
    // a well-formed user/assistant message is found is opaque — it MIGHT be a
    // newer message, so skipping it would silently shorten the kept prefix,
    // the same cardinal-sin variant as anchoring past a trailing user
    // message. Derivation fails closed instead. A malformed event OLDER than
    // the found anchor is never reached and cannot break derivation;
    // parseable non-message kinds keep skipping.
    let mut newest_message = None;
    for event in events
        .iter()
        .rev()
        .filter(|event| event.seq <= prefix_terminal_seq && event.event_type == ITEM_COMPLETED)
    {
        let item = serde_json::from_str::<serde_json::Value>(&event.payload_json)
            .map(|payload| payload["item"].clone())
            .map_err(|_| ProviderAnchorError::NotDerivable)?;
        match item["kind"].as_str() {
            Some("user_message") | Some("assistant_message") => {
                newest_message = Some(item);
                break;
            }
            Some(_) => {}
            None => return Err(ProviderAnchorError::NotDerivable),
        }
    }

    match newest_message {
        Some(item) if item["kind"] == "assistant_message" => item["messageId"]
            .as_str()
            .filter(|id| !id.is_empty())
            .map(|id| ProviderForkAnchor::UpToMessageId(id.to_string()))
            .ok_or(ProviderAnchorError::NotDerivable),
        // No message in the prefix, or the last kept message is a user
        // message — the runtime never persists user-message ACP ids, and
        // anchoring on an earlier assistant message would silently shorten
        // the prefix.
        _ => Err(ProviderAnchorError::NotDerivable),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn user_message(seq: i64, turn: &str, item: &str) -> SessionEventRecord {
        let payload = serde_json::json!({
            "type": "item_completed",
            "item": {
                "id": item,
                "kind": "user_message",
                "status": "completed",
                "sourceAgentKind": "claude",
                "contentParts": [],
            }
        });
        event(seq, ITEM_COMPLETED, turn, item, &payload.to_string())
    }

    fn assistant_message(
        seq: i64,
        turn: &str,
        item: &str,
        message_id: Option<&str>,
    ) -> SessionEventRecord {
        let mut payload = serde_json::json!({
            "type": "item_completed",
            "item": {
                "id": item,
                "kind": "assistant_message",
                "status": "completed",
                "sourceAgentKind": "claude",
                "contentParts": [],
            }
        });
        if let Some(message_id) = message_id {
            payload["item"]["messageId"] = serde_json::json!(message_id);
        }
        event(seq, ITEM_COMPLETED, turn, item, &payload.to_string())
    }

    fn tool_call(seq: i64, turn: &str, item: &str) -> SessionEventRecord {
        let payload = serde_json::json!({
            "type": "item_completed",
            "item": {
                "id": item,
                "kind": "tool_invocation",
                "status": "completed",
                "sourceAgentKind": "claude",
                "contentParts": [],
            }
        });
        event(seq, ITEM_COMPLETED, turn, item, &payload.to_string())
    }

    #[test]
    fn last_kept_assistant_with_id_derives_up_to_message_id() {
        let events = vec![
            user_message(1, "t1", "u1"),
            assistant_message(2, "t1", "a1", Some("msg-1")),
        ];
        let anchor = derive_provider_anchor("claude", &events, 2).unwrap();
        assert_eq!(
            anchor,
            ProviderForkAnchor::UpToMessageId("msg-1".to_string())
        );
    }

    #[test]
    fn assistant_message_without_message_id_is_not_derivable() {
        let events = vec![
            user_message(1, "t1", "u1"),
            assistant_message(2, "t1", "a1", None),
        ];
        let error = derive_provider_anchor("claude", &events, 2).unwrap_err();
        assert_eq!(error, ProviderAnchorError::NotDerivable);
    }

    #[test]
    fn last_kept_message_being_a_user_message_is_not_derivable() {
        // Negative control: an OLDER assistant message with an id exists, but
        // the prefix ends on a consecutive user message — anchoring on the
        // older assistant message would silently shorten the prefix.
        let events = vec![
            assistant_message(1, "t1", "a1", Some("msg-1")),
            user_message(2, "t2", "u2"),
        ];
        let error = derive_provider_anchor("claude", &events, 2).unwrap_err();
        assert_eq!(error, ProviderAnchorError::NotDerivable);
    }

    #[test]
    fn malformed_newest_kept_payload_fails_closed_instead_of_shortening_the_prefix() {
        // Negative control: an OLDER assistant message with an id exists, but
        // the newest kept item_completed payload is unparseable — it might be
        // a newer message, so skipping it and anchoring on msg-A would
        // silently shorten the prefix. Derivation must fail closed.
        let events = vec![
            assistant_message(1, "t1", "a1", Some("msg-A")),
            event(2, ITEM_COMPLETED, "t2", "a2", "{not json"),
        ];
        let error = derive_provider_anchor("claude", &events, 2).unwrap_err();
        assert_eq!(error, ProviderAnchorError::NotDerivable);
    }

    #[test]
    fn malformed_payload_older_than_the_anchor_does_not_break_derivation() {
        // Positive twin: the backward walk stops at the newest well-formed
        // message, so a malformed event OLDER than the anchor is never read.
        let events = vec![
            event(1, ITEM_COMPLETED, "t0", "a0", "{not json"),
            user_message(2, "t1", "u1"),
            assistant_message(3, "t1", "a1", Some("msg-1")),
        ];
        let anchor = derive_provider_anchor("claude", &events, 3).unwrap();
        assert_eq!(
            anchor,
            ProviderForkAnchor::UpToMessageId("msg-1".to_string())
        );
    }

    #[test]
    fn kept_payload_without_an_item_kind_fails_closed() {
        // A parseable payload with no `item.kind` string is equally opaque.
        let events = vec![
            assistant_message(1, "t1", "a1", Some("msg-1")),
            event(
                2,
                ITEM_COMPLETED,
                "t2",
                "a2",
                r#"{"type":"item_completed","item":{}}"#,
            ),
        ];
        let error = derive_provider_anchor("claude", &events, 2).unwrap_err();
        assert_eq!(error, ProviderAnchorError::NotDerivable);
    }

    #[test]
    fn empty_prefix_is_not_derivable() {
        let events = vec![assistant_message(1, "t1", "a1", Some("msg-1"))];
        let error = derive_provider_anchor("claude", &events, 0).unwrap_err();
        assert_eq!(error, ProviderAnchorError::NotDerivable);
    }

    #[test]
    fn codex_kind_is_not_derivable() {
        let events = vec![assistant_message(1, "t1", "a1", Some("msg-1"))];
        let error = derive_provider_anchor("codex", &events, 1).unwrap_err();
        assert_eq!(error, ProviderAnchorError::NotDerivable);
    }

    #[test]
    fn unknown_kind_is_unsupported() {
        let events = vec![assistant_message(1, "t1", "a1", Some("msg-1"))];
        let error = derive_provider_anchor("cursor", &events, 1).unwrap_err();
        assert_eq!(error, ProviderAnchorError::UnsupportedAgentKind);
    }

    #[test]
    fn tool_call_after_the_assistant_message_does_not_change_the_anchor() {
        let events = vec![
            user_message(1, "t1", "u1"),
            assistant_message(2, "t1", "a1", Some("msg-1")),
            tool_call(3, "t1", "tc1"),
        ];
        let anchor = derive_provider_anchor("claude", &events, 3).unwrap();
        assert_eq!(
            anchor,
            ProviderForkAnchor::UpToMessageId("msg-1".to_string())
        );
    }

    #[test]
    fn anchor_meta_json_matches_the_exact_wire_shape() {
        assert_eq!(
            ProviderForkAnchor::UpToMessageId("msg-1".to_string()).anchor_meta_json(),
            serde_json::json!({ "anyharness": { "upToMessageId": "msg-1" } })
        );
        assert_eq!(
            ProviderForkAnchor::LastTurnId("turn-1".to_string()).anchor_meta_json(),
            serde_json::json!({ "anyharness": { "lastTurnId": "turn-1" } })
        );
    }
}
