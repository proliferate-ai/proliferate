use agent_client_protocol as acp;
use anyharness_contract::v1::{PermissionInteractionOption, PermissionInteractionOptionKind};

const MAX_PERMISSION_RAW_JSON_BYTES: usize = 32 * 1024;

pub fn permission_options(options: &[acp::schema::PermissionOption]) -> Vec<PermissionInteractionOption> {
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
    let approve = find_option_id_by_kind_priority(
        options,
        &[
            PermissionInteractionOptionKind::AllowOnce,
            PermissionInteractionOptionKind::AllowAlways,
        ],
    )
    .or_else(|| {
        find_option_id_by_text(
            options,
            &["approve", "allow", "accept", "continue", "proceed", "yes"],
        )
    });
    let reject = find_option_id_by_kind_priority(
        options,
        &[
            PermissionInteractionOptionKind::RejectOnce,
            PermissionInteractionOptionKind::RejectAlways,
        ],
    )
    .or_else(|| find_option_id_by_text(options, &["reject", "deny", "decline", "no"]));
    serde_json::json!({
        "approve": approve,
        "reject": reject,
    })
}

fn find_option_id_by_kind_priority(
    options: &[PermissionInteractionOption],
    kinds: &[PermissionInteractionOptionKind],
) -> Option<String> {
    kinds.iter().find_map(|kind| {
        options
            .iter()
            .find(|option| option.kind == *kind)
            .map(|option| option.option_id.clone())
    })
}

fn find_option_id_by_text(
    options: &[PermissionInteractionOption],
    needles: &[&str],
) -> Option<String> {
    options
        .iter()
        .find(|option| {
            let option_id = option.option_id.to_ascii_lowercase();
            let label = option.label.to_ascii_lowercase();
            needles
                .iter()
                .any(|needle| option_id.contains(needle) || label.contains(needle))
        })
        .map(|option| option.option_id.clone())
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

fn permission_option_kind(kind: acp::schema::PermissionOptionKind) -> PermissionInteractionOptionKind {
    match kind {
        acp::schema::PermissionOptionKind::AllowOnce => PermissionInteractionOptionKind::AllowOnce,
        acp::schema::PermissionOptionKind::AllowAlways => PermissionInteractionOptionKind::AllowAlways,
        acp::schema::PermissionOptionKind::RejectOnce => PermissionInteractionOptionKind::RejectOnce,
        acp::schema::PermissionOptionKind::RejectAlways => PermissionInteractionOptionKind::RejectAlways,
        _ => PermissionInteractionOptionKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(
        option_id: &str,
        label: &str,
        kind: PermissionInteractionOptionKind,
    ) -> PermissionInteractionOption {
        PermissionInteractionOption {
            option_id: option_id.to_string(),
            label: label.to_string(),
            kind,
        }
    }

    #[test]
    fn permission_option_mappings_prefer_allow_once_over_allow_always() {
        let mappings = permission_option_mappings(&[
            option(
                "bypass",
                "Yes, and bypass permissions",
                PermissionInteractionOptionKind::AllowAlways,
            ),
            option(
                "manual",
                "Yes, and manually approve edits",
                PermissionInteractionOptionKind::AllowOnce,
            ),
            option(
                "reject",
                "No, keep planning",
                PermissionInteractionOptionKind::RejectOnce,
            ),
        ]);

        assert_eq!(
            mappings.get("approve").and_then(serde_json::Value::as_str),
            Some("manual")
        );
        assert_eq!(
            mappings.get("reject").and_then(serde_json::Value::as_str),
            Some("reject")
        );
    }

    #[test]
    fn permission_option_mappings_fall_back_to_text_for_unknown_kinds() {
        let mappings = permission_option_mappings(&[
            option(
                "continue-plan",
                "Continue from plan",
                PermissionInteractionOptionKind::Unknown,
            ),
            option(
                "keep-planning",
                "No, keep planning",
                PermissionInteractionOptionKind::Unknown,
            ),
        ]);

        assert_eq!(
            mappings.get("approve").and_then(serde_json::Value::as_str),
            Some("continue-plan"),
        );
        assert_eq!(
            mappings.get("reject").and_then(serde_json::Value::as_str),
            Some("keep-planning"),
        );
    }
}
