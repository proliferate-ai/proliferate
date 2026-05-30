use super::super::state::{AcpToolPayload, ParsedMeta};
use anyharness_contract::v1::ContentPart;

pub(in crate::live::sessions::event_sink) fn normalize_terminal_parts(
    payload: &AcpToolPayload,
    meta: &ParsedMeta,
) -> Vec<ContentPart> {
    let mut parts = Vec::new();

    if let Some(info) = &meta.terminal_info {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: info.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Start,
            data: None,
            data_truncated: None,
            data_original_bytes: None,
            exit_code: None,
            signal: None,
        });
    } else if let Some(content) = &payload.content {
        for item in content {
            if item.get("type").and_then(serde_json::Value::as_str) == Some("terminal") {
                if let Some(terminal_id) =
                    item.get("terminalId").and_then(serde_json::Value::as_str)
                {
                    parts.push(ContentPart::TerminalOutput {
                        terminal_id: terminal_id.to_string(),
                        event: anyharness_contract::v1::TerminalLifecycleEvent::Start,
                        data: None,
                        data_truncated: None,
                        data_original_bytes: None,
                        exit_code: None,
                        signal: None,
                    });
                }
            }
        }
    }

    if let Some(output) = &meta.terminal_output {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: output.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Output,
            data: Some(output.data.clone()),
            data_truncated: None,
            data_original_bytes: None,
            exit_code: None,
            signal: None,
        });
    }

    if let Some(exit) = &meta.terminal_exit {
        parts.push(ContentPart::TerminalOutput {
            terminal_id: exit.terminal_id.clone(),
            event: anyharness_contract::v1::TerminalLifecycleEvent::Exit,
            data: None,
            data_truncated: None,
            data_original_bytes: None,
            exit_code: Some(exit.exit_code),
            signal: exit.signal.clone(),
        });
    }

    parts
}
