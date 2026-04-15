use agent_client_protocol as acp;
use anyharness_contract::v1::{PermissionInteractionOption, PermissionInteractionOptionKind};

const MAX_PERMISSION_RAW_JSON_BYTES: usize = 32 * 1024;

pub fn permission_options(options: &[acp::PermissionOption]) -> Vec<PermissionInteractionOption> {
    options
        .iter()
        .map(|option| PermissionInteractionOption {
            option_id: option.option_id.to_string(),
            label: option.name.clone(),
            kind: permission_option_kind(option.kind),
        })
        .collect()
}

pub fn permission_option_mappings(options: &[PermissionInteractionOption]) -> serde_json::Value {
    let approve = options
        .iter()
        .find(|option| {
            matches!(
                option.kind,
                PermissionInteractionOptionKind::AllowOnce
                    | PermissionInteractionOptionKind::AllowAlways
            )
        })
        .map(|option| option.option_id.clone());
    let reject = options
        .iter()
        .find(|option| {
            matches!(
                option.kind,
                PermissionInteractionOptionKind::RejectOnce
                    | PermissionInteractionOptionKind::RejectAlways
            )
        })
        .map(|option| option.option_id.clone());
    serde_json::json!({
        "approve": approve,
        "reject": reject,
    })
}

pub fn bound_raw_json(value: serde_json::Value) -> serde_json::Value {
    let Ok(bytes) = serde_json::to_vec(&value) else {
        return value;
    };
    if bytes.len() <= MAX_PERMISSION_RAW_JSON_BYTES {
        return value;
    }
    serde_json::json!({
        "truncated": true,
        "originalSizeBytes": bytes.len(),
    })
}

fn permission_option_kind(kind: acp::PermissionOptionKind) -> PermissionInteractionOptionKind {
    match kind {
        acp::PermissionOptionKind::AllowOnce => PermissionInteractionOptionKind::AllowOnce,
        acp::PermissionOptionKind::AllowAlways => PermissionInteractionOptionKind::AllowAlways,
        acp::PermissionOptionKind::RejectOnce => PermissionInteractionOptionKind::RejectOnce,
        acp::PermissionOptionKind::RejectAlways => PermissionInteractionOptionKind::RejectAlways,
        _ => PermissionInteractionOptionKind::Unknown,
    }
}
