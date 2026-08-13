//! Per-frame tee for the ACP JSON-RPC transport.
//!
//! Every line the client writes to, or reads from, the agent process is
//! recorded once at DEBUG under `anyharness.acp.send` / `anyharness.acp.recv`,
//! notifications included. The frame is logged as the raw wire line — never a
//! re-serialization of a parsed value — capped so one giant payload cannot
//! push the diagnostics pipe over its per-record budget.

use serde::Deserialize;
use serde_json::value::RawValue;

/// Per-frame payload cap. Frames longer than this are recorded truncated with
/// `truncated = true`.
pub(in crate::live::sessions) const MAX_LOGGED_FRAME_BYTES: usize = 8_192;

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
#[derive(Default, Deserialize)]
struct FrameHeader<'a> {
    #[serde(borrow, default)]
    method: Option<&'a str>,
    #[serde(borrow, default)]
    id: Option<&'a RawValue>,
}

pub(in crate::live::sessions) fn log_frame(
    session_id: &str,
    direction: FrameDirection,
    line: &str,
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
            let (payload, truncated) = cap_frame(line);
            tracing::debug!(
                target: "anyharness.acp.send",
                session_id = %session_id,
                method = header.method.unwrap_or_default(),
                rpc_id = header.id.map(rpc_id_text).unwrap_or_default(),
                payload,
                truncated,
                privacy = "internal",
                "acp frame: send"
            );
        }
        FrameDirection::Recv => {
            if !tracing::enabled!(target: "anyharness.acp.recv", tracing::Level::DEBUG) {
                return;
            }
            let header = parse_header(line);
            let (payload, truncated) = cap_frame(line);
            tracing::debug!(
                target: "anyharness.acp.recv",
                session_id = %session_id,
                method = header.method.unwrap_or_default(),
                rpc_id = header.id.map(rpc_id_text).unwrap_or_default(),
                payload,
                truncated,
                privacy = "internal",
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
    use super::{cap_frame, parse_header, rpc_id_text, MAX_LOGGED_FRAME_BYTES};

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
