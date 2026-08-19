//! Per-frame tee for the ACP JSON-RPC transport.
//!
//! Every line the client writes to, or reads from, the agent process is
//! recorded once at DEBUG under `anyharness.acp.send` / `anyharness.acp.recv`,
//! except the streaming notification methods in [`STREAMING_METHODS`], which
//! are dropped by default and restored by `ANYHARNESS_ACP_TEE_FULL`. The
//! frame is logged as the raw wire line — never a
//! re-serialization of a parsed value — capped so one giant payload cannot
//! push the diagnostics pipe over its per-record budget.

use serde_json::value::RawValue;

use super::frame_observer::{FrameHeader, FrameObserver};

/// Per-frame payload cap. Frames longer than this are recorded truncated with
/// `truncated = true`.
///
/// Matched deliberately to the diagnostics protocol's `MAX_STRING_BYTES`
/// clamp: a larger cap here would let the producer silently clamp a payload
/// this module had already stamped `truncated = false`, so `truncated` would
/// stop describing the record that actually ships.
pub(in crate::live::sessions) const MAX_LOGGED_FRAME_BYTES: usize = 4_096;

#[derive(Clone, Copy)]
pub(in crate::live::sessions) enum FrameDirection {
    /// Client to agent: requests, responses to agent-initiated calls.
    Send,
    /// Agent to client: responses, and every `session/update`-class
    /// notification the transport carries.
    Recv,
}

/// The two JSON-RPC envelope fields worth indexing. Absent on frames that do
/// not carry them (a response has no method, a notification has no id), and
/// absent wholesale when the line is not parseable JSON — neither case is
/// worth suppressing the record, which still carries the raw payload.
/// Streaming notification methods excluded from the tee by default: they are
/// one record per token-ish chunk, and turn boundaries are already covered by
/// `anyharness.turn.started/finished/failed`. Set `ANYHARNESS_ACP_TEE_FULL`
/// to restore the full per-frame tee for deep wire debugging.
const STREAMING_METHODS: &[&str] = &["session/update"];

fn full_tee_enabled() -> bool {
    static FULL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FULL.get_or_init(|| std::env::var_os("ANYHARNESS_ACP_TEE_FULL").is_some())
}

/// True when the frame is a streaming notification the tee drops by default.
/// The diagnostics admission layer admits every self-named `anyharness.*`
/// target at any level, so the gate has to live here at the emit site —
/// demoting the record's level would change nothing.
fn suppressed_streaming_frame(header: &FrameHeader<'_>, full_tee: bool) -> bool {
    matches!(header.method, Some(m) if STREAMING_METHODS.contains(&m)) && !full_tee
}

/// Closed, low-cardinality method vocabulary for diagnostics. Raw extension
/// method names are provider-controlled and may themselves contain sensitive
/// material, so they never become tracing fields.
fn method_class(method: Option<&str>) -> &'static str {
    match method {
        Some("initialize") => "initialize",
        Some("authenticate") => "authenticate",
        Some("session/new") => "session_new",
        Some("session/load") => "session_load",
        Some("session/fork") => "session_fork",
        Some("session/prompt") => "session_prompt",
        Some("session/cancel") => "session_cancel",
        Some("session/update") => "session_update",
        Some("session/request_permission") => "session_permission",
        Some("session/set_model")
        | Some("session/set_mode")
        | Some("session/set_config_option") => "session_config",
        Some("elicitation/create") => "elicitation",
        Some(value) if value.starts_with("fs/") => "filesystem",
        Some(value) if value.starts_with("terminal/") => "terminal",
        Some(value) if value.starts_with("experimental/") => "extension",
        Some(_) => "other",
        None => "response",
    }
}

pub(in crate::live::sessions) fn log_frame(
    observer: &FrameObserver,
    session_id: &str,
    direction: FrameDirection,
    line: &str,
) -> bool {
    let payloads_protected = observer.observe_frame(direction, line);
    log_frame_gated(
        session_id,
        direction,
        line,
        full_tee_enabled(),
        payloads_protected,
    );
    observer.protected_request_ids_healthy()
}

/// `full_tee` is threaded as a parameter so tests can exercise both sides of
/// the gate without racing on process-global env state.
fn log_frame_gated(
    session_id: &str,
    direction: FrameDirection,
    line: &str,
    full_tee: bool,
    payloads_protected: bool,
) {
    // Parsing and capping happen only when a subscriber wants the record:
    // with no diagnostics producer installed and the default console filter,
    // this is the whole cost of the tee.
    match direction {
        FrameDirection::Send => {
            if !tracing::enabled!(target: "anyharness.acp.send", tracing::Level::DEBUG) {
                return;
            }
            let header = parse_header(line);
            if suppressed_streaming_frame(&header, full_tee) {
                return;
            }
            if payloads_protected {
                tracing::debug!(
                    target: "anyharness.acp.send",
                    session_id = %session_id,
                    method_class = method_class(header.method),
                    rpc_id = "",
                    payload = "[redacted: process-local fork]",
                    truncated = false,
                    redacted = true,
                    "acp frame: send"
                );
                return;
            }
            let (payload, truncated) = cap_frame(line);
            tracing::debug!(
                target: "anyharness.acp.send",
                session_id = %session_id,
                method = header.method.unwrap_or_default(),
                rpc_id = header.id.map(rpc_id_text).unwrap_or_default(),
                payload,
                truncated,
                redacted = false,
                "acp frame: send"
            );
        }
        FrameDirection::Recv => {
            if !tracing::enabled!(target: "anyharness.acp.recv", tracing::Level::DEBUG) {
                return;
            }
            let header = parse_header(line);
            if suppressed_streaming_frame(&header, full_tee) {
                return;
            }
            if payloads_protected {
                tracing::debug!(
                    target: "anyharness.acp.recv",
                    session_id = %session_id,
                    method_class = method_class(header.method),
                    rpc_id = "",
                    payload = "[redacted: process-local fork]",
                    truncated = false,
                    redacted = true,
                    "acp frame: recv"
                );
                return;
            }
            let (payload, truncated) = cap_frame(line);
            tracing::debug!(
                target: "anyharness.acp.recv",
                session_id = %session_id,
                method = header.method.unwrap_or_default(),
                rpc_id = header.id.map(rpc_id_text).unwrap_or_default(),
                payload,
                truncated,
                redacted = false,
                "acp frame: recv"
            );
        }
    }
}

fn parse_header(line: &str) -> FrameHeader<'_> {
    serde_json::from_str(line).unwrap_or_default()
}

/// Raw id text, with the quotes of a string id removed so string and numeric
/// ids index the same way.
fn rpc_id_text(id: &RawValue) -> &str {
    id.get().trim_matches('"')
}

/// Caps on a char boundary so a multi-byte payload never becomes invalid
/// UTF-8, and reports whether anything was dropped.
fn cap_frame(line: &str) -> (&str, bool) {
    if line.len() <= MAX_LOGGED_FRAME_BYTES {
        return (line, false);
    }
    let mut boundary = MAX_LOGGED_FRAME_BYTES;
    while !line.is_char_boundary(boundary) {
        boundary -= 1;
    }
    (&line[..boundary], true)
}

#[cfg(test)]
mod tests {
    use super::{
        cap_frame, log_frame_gated, method_class, parse_header, rpc_id_text, FrameDirection,
        MAX_LOGGED_FRAME_BYTES,
    };
    use crate::live::sessions::driver::frame_observer::FrameObserver;
    use std::io;
    use std::sync::{Arc, Mutex};

    struct SharedLogWriter(Arc<Mutex<Vec<u8>>>);

    impl io::Write for SharedLogWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    /// Runs `log_frame_gated` under a DEBUG-level capturing subscriber and
    /// returns everything it logged.
    fn capture_frame(direction: FrameDirection, line: &str, full_tee: bool) -> String {
        let log_bytes = Arc::new(Mutex::new(Vec::new()));
        let log_writer = Arc::clone(&log_bytes);
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_max_level(tracing::Level::DEBUG)
            .with_writer(move || SharedLogWriter(Arc::clone(&log_writer)))
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            log_frame_gated("session-1", direction, line, full_tee, false);
        });
        let bytes = log_bytes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        String::from_utf8(bytes).expect("formatted log is UTF-8")
    }

    #[test]
    fn streaming_notifications_are_skipped_by_default_in_both_directions() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#;

        assert_eq!(capture_frame(FrameDirection::Recv, line, false), "");
        assert_eq!(capture_frame(FrameDirection::Send, line, false), "");
    }

    #[test]
    fn non_streaming_requests_and_responses_are_still_logged() {
        let request = r#"{"jsonrpc":"2.0","id":7,"method":"session/prompt"}"#;
        let logged = capture_frame(FrameDirection::Send, request, false);
        assert!(logged.contains("session/prompt"));
        assert!(logged.contains("acp frame: send"));

        // A response carries no method at all and must never hit the gate.
        let response = r#"{"jsonrpc":"2.0","id":"call-1","result":{}}"#;
        let logged = capture_frame(FrameDirection::Recv, response, false);
        assert!(logged.contains("call-1"));
        assert!(logged.contains("acp frame: recv"));
    }

    #[test]
    fn full_tee_restores_streaming_notifications() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#;

        let logged = capture_frame(FrameDirection::Recv, line, true);
        assert!(logged.contains("session/update"));
        assert!(logged.contains("acp frame: recv"));
    }

    #[test]
    fn protected_process_local_fork_tee_is_header_only_even_when_full() {
        let observer = FrameObserver::default();
        observer.protect_process_local_fork();
        let sentinels = [
            "parent-native-secret",
            "payload-secret",
            "rpc-secret",
            "experimental/provider/secret-method-token",
        ];
        let line = format!(
            r#"{{"jsonrpc":"2.0","id":"{}","method":"{}","params":{{"sessionId":"{}","value":"{}"}}}}"#,
            sentinels[2], sentinels[3], sentinels[0], sentinels[1]
        );

        let log_bytes = Arc::new(Mutex::new(Vec::new()));
        let log_writer = Arc::clone(&log_bytes);
        let subscriber = tracing_subscriber::fmt()
            .without_time()
            .with_ansi(false)
            .with_max_level(tracing::Level::DEBUG)
            .with_writer(move || SharedLogWriter(Arc::clone(&log_writer)))
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            for direction in [FrameDirection::Send, FrameDirection::Recv] {
                let payloads_protected = observer.observe_frame(direction, &line);
                log_frame_gated("product-child", direction, &line, true, payloads_protected);
            }
        });
        let logged = String::from_utf8(
            log_bytes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone(),
        )
        .expect("formatted log is UTF-8");

        assert!(logged.contains("extension"));
        assert!(logged.contains("redacted=true"));
        assert!(sentinels.iter().all(|sentinel| !logged.contains(sentinel)));
        assert!(logged.contains("acp frame: send"));
        assert!(logged.contains("acp frame: recv"));
        assert_eq!(observer.observed_frames(), 2);
    }

    #[test]
    fn provider_controlled_method_names_map_to_closed_classes() {
        let secret_method = "experimental/provider/secret-method-token";
        assert_eq!(method_class(Some(secret_method)), "extension");
        assert_eq!(method_class(Some("unknown-secret-method")), "other");
    }

    #[test]
    fn a_frame_within_the_cap_is_logged_whole() {
        let line = r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#;

        assert_eq!(cap_frame(line), (line, false));
    }

    #[test]
    fn an_oversized_frame_is_capped_on_a_char_boundary_and_marked_truncated() {
        // A multi-byte char straddling the cap: a naive byte slice here would
        // panic, and a silent shrink would hide the loss.
        let line = format!("{}\u{1f600}{}", "a".repeat(MAX_LOGGED_FRAME_BYTES - 2), "b");
        let (payload, truncated) = cap_frame(&line);

        assert!(truncated);
        assert_eq!(payload.len(), MAX_LOGGED_FRAME_BYTES - 2);
        assert!(line.starts_with(payload));
    }

    #[test]
    fn headers_are_extracted_for_requests_notifications_and_responses() {
        let request = parse_header(r#"{"jsonrpc":"2.0","id":7,"method":"session/prompt"}"#);
        assert_eq!(request.method, Some("session/prompt"));
        assert_eq!(request.id.map(rpc_id_text), Some("7"));

        let notification = parse_header(r#"{"jsonrpc":"2.0","method":"session/update"}"#);
        assert_eq!(notification.method, Some("session/update"));
        assert!(notification.id.is_none());

        let response = parse_header(r#"{"jsonrpc":"2.0","id":"call-1","result":{}}"#);
        assert!(response.method.is_none());
        assert_eq!(response.id.map(rpc_id_text), Some("call-1"));
    }

    #[test]
    fn an_unparseable_frame_still_yields_an_empty_header_instead_of_dropping_the_record() {
        let header = parse_header("not json at all");

        assert!(header.method.is_none());
        assert!(header.id.is_none());
    }
}
