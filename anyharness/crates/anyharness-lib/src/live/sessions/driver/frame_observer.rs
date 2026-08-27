//! Unconditional privacy and response-ownership observer for ACP frames.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::value::RawValue;

use super::frame_tee::FrameDirection;

const MAX_PROTECTED_PENDING_REQUEST_IDS: usize = 256;

/// Shared with the inbound fork epoch. Process-local hydration permanently
/// protects this connection because delayed parent frames remain possible
/// after child adoption.
pub(in crate::live::sessions) struct FrameObserver {
    payloads_protected: AtomicBool,
    protected_request_id_overflowed: AtomicBool,
    observed_frames: AtomicU64,
    fork_wire: Mutex<ForkWireObservation>,
}

#[derive(Default)]
struct ForkWireObservation {
    request_id: Option<serde_json::Value>,
    response: ForkWireResponse,
    pending_client_responses: VecDeque<PendingProtectedResponse>,
}

#[derive(Debug, PartialEq)]
struct PendingProtectedResponse {
    id: serde_json::Value,
    kind: ProtectedResponseKind,
}

/// Closed response-validation policy retained with each protected outbound
/// request. Standard ACP results are decoded before ACP's incoming actor can
/// log a provider-bearing parse error; the two owned extension families keep
/// their intentionally opaque product JSON.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::live::sessions) enum ProtectedResponseKind {
    StandardAcp(&'static str),
    OpaqueJson,
}

impl ProtectedResponseKind {
    fn for_method(method: &str) -> Option<Self> {
        let method = match method {
            "initialize" => "initialize",
            "authenticate" => "authenticate",
            "logout" => "logout",
            "session/new" => "session/new",
            "session/load" => "session/load",
            "session/list" => "session/list",
            "session/delete" => "session/delete",
            "session/fork" => "session/fork",
            "session/resume" => "session/resume",
            "session/close" => "session/close",
            "session/set_mode" => "session/set_mode",
            "session/set_config_option" => "session/set_config_option",
            "session/prompt" => "session/prompt",
            "mcp/message" => "mcp/message",
            "session/set_model" => return Some(Self::OpaqueJson),
            value if value.starts_with("_anyharness/") => return Some(Self::OpaqueJson),
            _ => return None,
        };
        Some(Self::StandardAcp(method))
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(in crate::live::sessions) enum ForkWireResponse {
    #[default]
    None,
    ExplicitError,
    ResultEnvelope,
    MalformedEnvelope,
}

/// Raw top-level key presence for a JSON-RPC response envelope.
///
/// Serde collapses an explicit JSON `null` into `None`, so a decoded
/// `Option` cannot tell `{"error":null}` from an absent `error`. Presence is
/// therefore read off the raw line before any ACP decoding, so that
/// `{"result":{...},"error":null}` stays a both-field rejection and an
/// opaque `result: null` stays a preserved success envelope.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::live::sessions) struct RawResponseFields {
    result_present: bool,
    error_present: bool,
    error_is_null: bool,
}

impl RawResponseFields {
    /// `None` when the line is not a JSON object at all; callers treat that as
    /// malformed rather than guessing at the envelope.
    pub(in crate::live::sessions) fn from_line(line: &str) -> Option<Self> {
        let object =
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(line).ok()?;
        Some(Self {
            result_present: object.contains_key("result"),
            error_present: object.contains_key("error"),
            error_is_null: object.get("error").is_some_and(serde_json::Value::is_null),
        })
    }

    /// Closed classification shared by the frame observer and the connection
    /// preflight so both sides agree on every envelope shape.
    pub(in crate::live::sessions) fn classify(self) -> ForkWireResponse {
        match (self.result_present, self.error_present) {
            (false, true) if !self.error_is_null => ForkWireResponse::ExplicitError,
            (true, false) => ForkWireResponse::ResultEnvelope,
            _ => ForkWireResponse::MalformedEnvelope,
        }
    }
}

#[derive(Default, Deserialize)]
pub(super) struct FrameHeader<'a> {
    #[serde(borrow, default)]
    pub(super) method: Option<&'a str>,
    #[serde(borrow, default)]
    pub(super) id: Option<&'a RawValue>,
}

impl Default for FrameObserver {
    fn default() -> Self {
        Self {
            payloads_protected: AtomicBool::new(false),
            protected_request_id_overflowed: AtomicBool::new(false),
            observed_frames: AtomicU64::new(0),
            fork_wire: Mutex::new(ForkWireObservation::default()),
        }
    }
}

impl FrameObserver {
    pub(in crate::live::sessions) fn protect_process_local_fork(&self) {
        self.payloads_protected.store(true, Ordering::Release);
    }

    pub(super) fn observe_frame(&self, direction: FrameDirection, line: &str) -> bool {
        self.observed_frames.fetch_add(1, Ordering::Relaxed);
        let payloads_protected = self.payloads_protected.load(Ordering::Acquire);
        if payloads_protected {
            self.observe_fork_wire(direction, line);
        }
        payloads_protected
    }

    fn observe_fork_wire(&self, direction: FrameDirection, line: &str) {
        let Ok(header) = serde_json::from_str::<FrameHeader<'_>>(line) else {
            return;
        };
        let Some(id) = header
            .id
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw.get()).ok())
        else {
            return;
        };
        let mut observation = self
            .fork_wire
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match direction {
            FrameDirection::Send if header.method.is_some() => {
                let Some(kind) = header.method.and_then(ProtectedResponseKind::for_method) else {
                    self.protected_request_id_overflowed
                        .store(true, Ordering::Release);
                    return;
                };
                if let Some(position) = observation
                    .pending_client_responses
                    .iter()
                    .position(|pending| pending.id == id)
                {
                    observation.pending_client_responses.remove(position);
                }
                if observation.pending_client_responses.len() == MAX_PROTECTED_PENDING_REQUEST_IDS {
                    self.protected_request_id_overflowed
                        .store(true, Ordering::Release);
                    return;
                }
                observation
                    .pending_client_responses
                    .push_back(PendingProtectedResponse {
                        id: id.clone(),
                        kind,
                    });
                if header.method == Some("session/fork") {
                    observation.request_id = Some(id);
                    observation.response = ForkWireResponse::None;
                }
            }
            FrameDirection::Recv
                if header.method.is_none() && observation.request_id.as_ref() == Some(&id) =>
            {
                observation.response = RawResponseFields::from_line(line).map_or(
                    ForkWireResponse::MalformedEnvelope,
                    RawResponseFields::classify,
                );
            }
            _ => {}
        }
    }

    pub(in crate::live::sessions) fn fork_wire_response(&self) -> ForkWireResponse {
        self.fork_wire
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .response
    }

    /// Claims a response ID previously emitted by this protected client. ACP's
    /// generic incoming actor logs unknown provider-selected IDs at WARN, so
    /// the protected transport rejects them before that actor can observe the
    /// envelope. Each ID is single-use and the set is bounded.
    pub(in crate::live::sessions) fn take_protected_response_kind(
        &self,
        response_id: &serde_json::Value,
    ) -> Option<ProtectedResponseKind> {
        let mut observation = self
            .fork_wire
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let position = observation
            .pending_client_responses
            .iter()
            .position(|pending| &pending.id == response_id)?;
        observation
            .pending_client_responses
            .remove(position)
            .map(|pending| pending.kind)
    }

    pub(in crate::live::sessions) fn payloads_protected(&self) -> bool {
        self.payloads_protected.load(Ordering::Acquire)
    }

    pub(super) fn protected_request_ids_healthy(&self) -> bool {
        !self.protected_request_id_overflowed.load(Ordering::Acquire)
    }

    #[cfg(test)]
    pub(super) fn observed_frames(&self) -> u64 {
        self.observed_frames.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    fn pending_client_request_count(&self) -> usize {
        self.fork_wire
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .pending_client_responses
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn correlates_only_the_exact_fork_response() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        observer.observe_frame(
            FrameDirection::Send,
            r#"{"jsonrpc":"2.0","id":"fork-private","method":"session/fork"}"#,
        );
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":"fork-private","method":"extension/collision","error":{"code":-1}}"#,
        );
        assert_eq!(observer.fork_wire_response(), ForkWireResponse::None);
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":"other","error":{"code":-1}}"#,
        );
        assert_eq!(observer.fork_wire_response(), ForkWireResponse::None);
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":"fork-private","error":{"code":-32602}}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::ExplicitError
        );
    }

    #[test]
    fn result_and_malformed_envelopes_are_distinguished() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        observer.observe_frame(
            FrameDirection::Send,
            r#"{"jsonrpc":"2.0","id":9,"method":"session/fork"}"#,
        );
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":9,"result":{"sessionId":7}}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::ResultEnvelope
        );

        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":9,"result":{"sessionId":"child"},"error":{"code":-32602}}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::MalformedEnvelope
        );
    }

    #[test]
    fn null_valued_result_and_error_keys_are_classified_by_raw_presence() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        observer.observe_frame(
            FrameDirection::Send,
            r#"{"jsonrpc":"2.0","id":21,"method":"session/fork"}"#,
        );

        // An explicit `error: null` alongside a result is still a both-field
        // envelope: serde would have collapsed it into a plain success.
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":21,"result":{"sessionId":"child"},"error":null}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::MalformedEnvelope
        );

        // A null result beside a real error is malformed, not an explicit error.
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":21,"result":null,"error":{"code":-32602}}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::MalformedEnvelope
        );

        // `error: null` with no result key at all carries no error to report.
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":21,"error":null}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::MalformedEnvelope
        );

        // A present-but-null result is a success envelope: `null` is valid JSON.
        observer.observe_frame(
            FrameDirection::Recv,
            r#"{"jsonrpc":"2.0","id":21,"result":null}"#,
        );
        assert_eq!(
            observer.fork_wire_response(),
            ForkWireResponse::ResultEnvelope
        );
    }

    #[test]
    fn raw_response_fields_reject_non_object_lines() {
        assert!(RawResponseFields::from_line("[1,2,3]").is_none());
        assert!(RawResponseFields::from_line("not json at all").is_none());
        assert_eq!(
            RawResponseFields::from_line(r#"{"jsonrpc":"2.0","id":1}"#)
                .expect("object line")
                .classify(),
            ForkWireResponse::MalformedEnvelope
        );
    }

    #[test]
    fn protected_response_ids_are_single_use_and_fail_closed_at_the_bound() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        for id in 0..MAX_PROTECTED_PENDING_REQUEST_IDS {
            assert!(observer.observe_frame(
                FrameDirection::Send,
                &format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"session/load"}}"#)
            ));
            assert!(observer.protected_request_ids_healthy());
        }
        observer.observe_frame(
            FrameDirection::Send,
            &format!(
                r#"{{"jsonrpc":"2.0","id":{},"method":"session/load"}}"#,
                MAX_PROTECTED_PENDING_REQUEST_IDS
            ),
        );

        assert!(!observer.protected_request_ids_healthy());
        assert_eq!(
            observer.pending_client_request_count(),
            MAX_PROTECTED_PENDING_REQUEST_IDS
        );
        assert_eq!(
            observer.take_protected_response_kind(&serde_json::json!(0)),
            Some(ProtectedResponseKind::StandardAcp("session/load"))
        );
        assert_eq!(
            observer.take_protected_response_kind(&serde_json::json!(0)),
            None
        );
        assert_eq!(
            observer.take_protected_response_kind(&serde_json::json!(
                MAX_PROTECTED_PENDING_REQUEST_IDS
            )),
            None
        );
    }

    #[test]
    fn protected_response_kind_is_closed_and_retained_with_the_id() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        for (id, method, expected) in [
            (
                1,
                "session/fork",
                ProtectedResponseKind::StandardAcp("session/fork"),
            ),
            (2, "session/set_model", ProtectedResponseKind::OpaqueJson),
            (3, "_anyharness/goal/get", ProtectedResponseKind::OpaqueJson),
        ] {
            assert!(observer.observe_frame(
                FrameDirection::Send,
                &format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"{method}"}}"#),
            ));
            assert_eq!(
                observer.take_protected_response_kind(&serde_json::json!(id)),
                Some(expected)
            );
        }

        observer.observe_frame(
            FrameDirection::Send,
            r#"{"jsonrpc":"2.0","id":4,"method":"provider/private"}"#,
        );
        assert!(!observer.protected_request_ids_healthy());
        assert_eq!(
            observer.take_protected_response_kind(&serde_json::json!(4)),
            None
        );
    }
}
