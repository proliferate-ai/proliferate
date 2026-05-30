use anyharness_contract::v1::AgentAuthExternalScope;

pub(super) const LOCAL_SCOPE_KEY: &str = "local:default";

pub(super) fn default_external_scope() -> AgentAuthExternalScope {
    AgentAuthExternalScope {
        provider: "local".to_string(),
        id: "default".to_string(),
        target_id: None,
    }
}

pub(super) fn scope_key(scope: &AgentAuthExternalScope) -> String {
    if scope.provider == "local" && scope.id == "default" {
        return LOCAL_SCOPE_KEY.to_string();
    }
    let mut key = format!(
        "{}:{}",
        sanitize_scope_part(&scope.provider),
        sanitize_scope_part(&scope.id),
    );
    if let Some(target_id) = scope.target_id.as_deref().filter(|value| !value.is_empty()) {
        key.push_str(":target:");
        key.push_str(&sanitize_scope_part(target_id));
    }
    key
}

fn sanitize_scope_part(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
