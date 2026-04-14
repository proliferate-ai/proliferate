use agent_client_protocol as acp;
use anyharness_contract::v1::PermissionInteractionContext;

pub(super) fn permission_context_from_meta(
    meta: Option<&acp::Meta>,
) -> Option<PermissionInteractionContext> {
    let meta = meta?;
    let context = meta
        .get("claudeCode")
        .and_then(|value| value.get("permissionContext"))
        .or_else(|| {
            meta.get("gemini")
                .and_then(|value| value.get("permissionContext"))
        })?;
    let display_name = context
        .get("displayName")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let blocked_path = context
        .get("blockedPath")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let decision_reason = context
        .get("decisionReason")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let agent_id = context
        .get("agentId")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    (display_name.is_some()
        || blocked_path.is_some()
        || decision_reason.is_some()
        || agent_id.is_some())
    .then_some(PermissionInteractionContext {
        display_name,
        blocked_path,
        decision_reason,
        agent_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(value: serde_json::Value) -> acp::Meta {
        value.as_object().expect("meta must be an object").clone()
    }

    #[test]
    fn parses_gemini_permission_context_from_meta() {
        let meta = meta(serde_json::json!({
            "gemini": {
                "permissionContext": {
                    "displayName": "Gemini write_file",
                    "blockedPath": "/tmp/file.txt",
                    "decisionReason": "Tool requires confirmation",
                    "agentId": "gemini"
                }
            }
        }));

        let context = permission_context_from_meta(Some(&meta)).expect("context");

        assert_eq!(context.display_name.as_deref(), Some("Gemini write_file"));
        assert_eq!(context.blocked_path.as_deref(), Some("/tmp/file.txt"));
        assert_eq!(
            context.decision_reason.as_deref(),
            Some("Tool requires confirmation")
        );
        assert_eq!(context.agent_id.as_deref(), Some("gemini"));
    }

    #[test]
    fn parses_claude_permission_context_from_meta() {
        let meta = meta(serde_json::json!({
            "claudeCode": {
                "permissionContext": {
                    "displayName": "Claude Bash",
                    "agentId": "claude"
                }
            }
        }));

        let context = permission_context_from_meta(Some(&meta)).expect("context");

        assert_eq!(context.display_name.as_deref(), Some("Claude Bash"));
        assert_eq!(context.agent_id.as_deref(), Some("claude"));
    }
}
