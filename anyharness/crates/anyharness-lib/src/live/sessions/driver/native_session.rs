use super::*;
use crate::domains::sessions::runtime::fork_anchor::ProviderForkAnchor;
use crate::live::sessions::driver::inbound::InboundDoor;
use crate::live::sessions::driver::native_fork::hydrate_parent_and_fork;
use crate::live::sessions::driver::session_lifecycle::start_new_session;
use crate::live::sessions::driver::types::{
    NativeSessionStartupDisposition, NativeSessionStartupState,
};
use crate::live::sessions::fork_dispatch::ForkDispatchDurable;
use crate::live::sessions::model::SessionStartupStrategy;
use anyharness_contract::v1::SessionActionCapabilities;
use std::sync::Arc;

pub(in crate::live::sessions) fn build_system_prompt_meta(
    system_prompt_append: Option<&str>,
) -> Option<acp::schema::Meta> {
    let append = system_prompt_append?.trim();
    if append.is_empty() {
        return None;
    }

    Some(acp::schema::Meta::from_iter([(
        "systemPrompt".to_string(),
        serde_json::json!({
            "append": append,
        }),
    )]))
}

/// Merges a targeted fork's provider anchor into the base meta (built from
/// `system_prompt_append`). The system-prompt key is `"systemPrompt"`, so it
/// never collides with the anchor's `"anyharness"` key.
pub(in crate::live::sessions) fn merge_targeted_fork_anchor_meta(
    base: Option<acp::schema::Meta>,
    provider_anchor: Option<&ProviderForkAnchor>,
) -> Option<acp::schema::Meta> {
    let Some(anchor) = provider_anchor else {
        return base;
    };
    let serde_json::Value::Object(anchor_entry) = anchor.anchor_meta_json() else {
        unreachable!("anchor_meta_json always returns an object");
    };
    let mut meta = base.unwrap_or_default();
    meta.extend(anchor_entry);
    Some(meta)
}

/// A provider anchor may ride an ACP-native fork only when the current live
/// handshake advertises targeted readiness. Tip forks have no anchor and keep
/// the ordinary `fork` capability gate at their dispatch seam.
pub(in crate::live::sessions) fn native_fork_anchor_is_dispatch_ready(
    action_capabilities: SessionActionCapabilities,
    provider_anchor: Option<&ProviderForkAnchor>,
) -> bool {
    provider_anchor.is_none() || action_capabilities.targeted_fork
}

/// Reduce an ACP `session/fork` rejection to diagnostics that are safe for
/// logs and user-facing error chains. Provider messages/data may carry prompt
/// content and identifiers, so neither value crosses this boundary.
pub(in crate::live::sessions) fn sanitized_native_fork_failure(
    _error: &acp::Error,
) -> (&'static str, &'static str) {
    ("ACP session/fork request failed", "provider_request_failed")
}

pub(in crate::live::sessions) fn is_missing_load_session_resource(
    error: &acp::Error,
    expected_uri: &str,
) -> bool {
    if !matches!(error.code, acp::ErrorCode::ResourceNotFound) {
        return false;
    }

    match error
        .data
        .as_ref()
        .and_then(|data| data.get("uri"))
        .and_then(|uri| uri.as_str())
    {
        Some(uri) => uri == expected_uri,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_system_prompt_meta_uses_append_shape() {
        let meta = build_system_prompt_meta(Some("Rename the branch")).expect("meta");

        assert_eq!(
            serde_json::to_value(&meta).ok(),
            Some(serde_json::json!({
                "systemPrompt": {
                    "append": "Rename the branch",
                },
            }))
        );
    }

    #[test]
    fn merge_targeted_fork_anchor_meta_carries_both_keys_when_both_present() {
        let base = build_system_prompt_meta(Some("Rename the branch"));
        let anchor = ProviderForkAnchor::UpToMessageId("msg-1".to_string());
        let merged = merge_targeted_fork_anchor_meta(base, Some(&anchor)).expect("meta");
        assert_eq!(
            serde_json::to_value(&merged).ok(),
            Some(serde_json::json!({
                "systemPrompt": {"append": "Rename the branch"},
                "anyharness": {"upToMessageId": "msg-1"},
            }))
        );
    }

    #[test]
    fn merge_targeted_fork_anchor_meta_carries_only_anchor_when_no_system_prompt() {
        let anchor = ProviderForkAnchor::LastTurnId("turn-1".to_string());
        let merged = merge_targeted_fork_anchor_meta(None, Some(&anchor)).expect("meta");
        assert_eq!(
            serde_json::to_value(&merged).ok(),
            Some(serde_json::json!({"anyharness": {"lastTurnId": "turn-1"}}))
        );
    }

    #[test]
    fn native_fork_anchor_requires_current_targeted_readiness() {
        let anchor = ProviderForkAnchor::UpToMessageId("msg-1".to_string());
        let tip_only = SessionActionCapabilities {
            fork: true,
            ..SessionActionCapabilities::default()
        };
        assert!(native_fork_anchor_is_dispatch_ready(tip_only, None));
        assert!(!native_fork_anchor_is_dispatch_ready(
            tip_only,
            Some(&anchor)
        ));

        let targeted = SessionActionCapabilities {
            targeted_fork: true,
            ..tip_only
        };
        assert!(native_fork_anchor_is_dispatch_ready(
            targeted,
            Some(&anchor)
        ));
    }

    #[test]
    fn native_fork_failure_diagnostics_omit_provider_message_and_data() {
        let sentinels = [
            "anchor-msg-secret",
            "provider-message-secret",
            "provider-session-secret",
        ];
        let error = acp::Error::new(-32603, sentinels[1]).data(serde_json::json!({
            "upToMessageId": sentinels[0],
            "sessionId": sentinels[2],
        }));
        let provider_display = error.to_string();
        assert!(sentinels
            .iter()
            .all(|value| provider_display.contains(value)));

        let (detail, error_class) = sanitized_native_fork_failure(&error);
        assert_eq!(detail, "ACP session/fork request failed");
        assert_eq!(error_class, "provider_request_failed");
        assert!(sentinels
            .iter()
            .all(|value| !detail.contains(value) && !error_class.contains(value)));
    }

    #[test]
    fn build_system_prompt_meta_skips_blank_values() {
        assert!(build_system_prompt_meta(None).is_none());
        assert!(build_system_prompt_meta(Some("   ")).is_none());
    }

    #[test]
    fn missing_load_session_resource_matches_expected_uri() {
        let error = acp::Error::resource_not_found(Some("session-123".to_string()));
        assert!(is_missing_load_session_resource(&error, "session-123"));
        assert!(!is_missing_load_session_resource(&error, "session-xyz"));
    }

    #[test]
    fn missing_load_session_resource_without_uri_still_matches() {
        let error = acp::Error::resource_not_found(None);
        assert!(is_missing_load_session_resource(&error, "session-123"));
    }

    #[test]
    fn missing_load_session_resource_ignores_other_error_codes() {
        let error = acp::Error::internal_error().data(serde_json::json!({
            "uri": "session-123",
        }));
        assert!(!is_missing_load_session_resource(&error, "session-123"));
    }

    fn meta_from_json(value: serde_json::Value) -> acp::schema::Meta {
        match value {
            serde_json::Value::Object(map) => map,
            other => panic!("expected a JSON object for Meta, got {other:?}"),
        }
    }

    #[test]
    fn targeted_fork_extension_cases() {
        struct Case {
            label: &'static str,
            meta: serde_json::Value,
            expected: Option<TargetedForkExtensionTarget>,
        }
        let cases = [
            Case {
                label: "strict shape target message_id",
                meta: serde_json::json!({
                    "anyharness": {
                        "schemaVersion": 1,
                        "targetedFork": {"fileEffects": "none", "target": "message_id"},
                    },
                }),
                expected: Some(TargetedForkExtensionTarget::MessageId),
            },
            Case {
                label: "strict shape target turn_id",
                meta: serde_json::json!({
                    "anyharness": {
                        "schemaVersion": 1,
                        "targetedFork": {"fileEffects": "none", "target": "turn_id"},
                    },
                }),
                expected: Some(TargetedForkExtensionTarget::TurnId),
            },
            Case {
                label: "strict shape target user_message_index",
                meta: serde_json::json!({
                    "anyharness": {
                        "schemaVersion": 1,
                        "targetedFork": {"fileEffects": "none", "target": "user_message_index"},
                    },
                }),
                expected: Some(TargetedForkExtensionTarget::UserMessageIndex),
            },
            Case {
                label: "legacy shipped Claude shape",
                meta: serde_json::json!({
                    "anyharness": {"fork": {"version": 1, "anchor": "upToMessageId"}},
                }),
                expected: None,
            },
            Case {
                label: "legacy shipped Codex shape (empty meta)",
                meta: serde_json::json!({}),
                expected: None,
            },
            Case {
                label: "wrong schemaVersion",
                meta: serde_json::json!({
                    "anyharness": {
                        "schemaVersion": 2,
                        "targetedFork": {"fileEffects": "none", "target": "message_id"},
                    },
                }),
                expected: None,
            },
            Case {
                label: "fileEffects workspace",
                meta: serde_json::json!({
                    "anyharness": {
                        "schemaVersion": 1,
                        "targetedFork": {"fileEffects": "workspace", "target": "message_id"},
                    },
                }),
                expected: None,
            },
            Case {
                label: "unknown target",
                meta: serde_json::json!({
                    "anyharness": {
                        "schemaVersion": 1,
                        "targetedFork": {"fileEffects": "none", "target": "item_id"},
                    },
                }),
                expected: None,
            },
            Case {
                label: "missing targetedFork",
                meta: serde_json::json!({
                    "anyharness": {"schemaVersion": 1},
                }),
                expected: None,
            },
            Case {
                label: "missing anyharness",
                meta: serde_json::json!({"other": {}}),
                expected: None,
            },
        ];

        for case in cases {
            let meta = meta_from_json(case.meta);
            assert_eq!(
                parse_anyharness_targeted_fork_extension(&meta),
                case.expected,
                "case failed: {}",
                case.label
            );
        }
    }
}

/// A syntactically valid target in the ACP `_meta.anyharness.targetedFork`
/// extension. Recognition does not imply that a given adapter can dispatch
/// the target; the actor capability owner makes that separate decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::live::sessions) enum TargetedForkExtensionTarget {
    MessageId,
    TurnId,
    UserMessageIndex,
}

impl TargetedForkExtensionTarget {
    pub(in crate::live::sessions) fn as_str(self) -> &'static str {
        match self {
            Self::MessageId => "message_id",
            Self::TurnId => "turn_id",
            Self::UserMessageIndex => "user_message_index",
        }
    }
}

pub(in crate::live::sessions) fn parse_anyharness_targeted_fork_extension(
    meta: &acp::schema::Meta,
) -> Option<TargetedForkExtensionTarget> {
    let anyharness = meta.get("anyharness").and_then(|value| value.as_object())?;
    if anyharness
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
    {
        return None;
    }
    let targeted_fork = anyharness
        .get("targetedFork")
        .and_then(|value| value.as_object())?;
    if targeted_fork
        .get("fileEffects")
        .and_then(|value| value.as_str())
        != Some("none")
    {
        return None;
    }
    match targeted_fork.get("target").and_then(|value| value.as_str()) {
        Some("message_id") => Some(TargetedForkExtensionTarget::MessageId),
        Some("turn_id") => Some(TargetedForkExtensionTarget::TurnId),
        Some("user_message_index") => Some(TargetedForkExtensionTarget::UserMessageIndex),
        _ => None,
    }
}

pub(in crate::live::sessions) async fn start_native_session(
    conn: &acp::ConnectionTo<acp::Agent>,
    inbound: Arc<InboundDoor>,
    fork_dispatch: Arc<dyn ForkDispatchDurable>,
    workspace_path: &std::path::Path,
    mcp_servers: &[SessionMcpServer],
    system_prompt_append: Option<&str>,
    startup_strategy: &SessionStartupStrategy,
    action_capabilities: SessionActionCapabilities,
    session_id: &str,
    workspace_id: &str,
    ready_tx: &std::sync::mpsc::Sender<anyhow::Result<String>>,
) -> anyhow::Result<(
    String,
    NativeSessionStartupState,
    NativeSessionStartupDisposition,
)> {
    let startup_strategy_label = startup_strategy.as_str();
    match startup_strategy {
        SessionStartupStrategy::Fresh | SessionStartupStrategy::ResumeSeqFreshNative => {
            let new_session_resp = match start_new_session(
                conn,
                workspace_path,
                mcp_servers,
                system_prompt_append,
                session_id,
                workspace_id,
                startup_strategy_label,
                "[workspace-latency] session.actor.new_session.completed",
                "[workspace-latency] session.actor.new_session.failed",
            )
            .await
            {
                Ok(resp) => resp,
                Err(error) => {
                    let _ = ready_tx.send(Err(anyhow::anyhow!("ACP new_session: {error}")));
                    return Err(anyhow::anyhow!("ACP new_session: {error}"));
                }
            };

            Ok((
                new_session_resp.session_id.to_string(),
                NativeSessionStartupState::from_new_session(&new_session_resp),
                NativeSessionStartupDisposition::CreatedFresh,
            ))
        }
        SessionStartupStrategy::LoadNative(existing)
        | SessionStartupStrategy::LoadNativeNoFallback(existing) => {
            let load_started = std::time::Instant::now();
            match conn
                .send_request(
                    acp::schema::LoadSessionRequest::new(
                        existing.clone(),
                        workspace_path.to_path_buf(),
                    )
                    .mcp_servers(to_acp_servers(mcp_servers))
                    .meta(build_system_prompt_meta(system_prompt_append)),
                )
                .block_task()
                .await
            {
                Ok(resp) => {
                    tracing::info!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        native_session_id = %existing,
                        startup_strategy = startup_strategy_label,
                        native_startup_disposition = NativeSessionStartupDisposition::LoadedExisting.as_str(),
                        elapsed_ms = load_started.elapsed().as_millis(),
                        "[workspace-latency] session.actor.load_session.completed"
                    );
                    Ok((
                        existing.clone(),
                        NativeSessionStartupState::from_load_session(&resp),
                        NativeSessionStartupDisposition::LoadedExisting,
                    ))
                }
                Err(e)
                    if startup_strategy.allows_missing_load_fallback()
                        && is_missing_load_session_resource(&e, existing) =>
                {
                    tracing::warn!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        native_session_id = %existing,
                        startup_strategy = startup_strategy_label,
                        elapsed_ms = load_started.elapsed().as_millis(),
                        error = %e,
                        "ACP load_session resource missing; falling back to new_session"
                    );

                    let new_session_resp = match start_new_session(
                        conn,
                        workspace_path,
                        mcp_servers,
                        system_prompt_append,
                        session_id,
                        workspace_id,
                        startup_strategy_label,
                        "[workspace-latency] session.actor.new_session_after_missing_load.completed",
                        "[workspace-latency] session.actor.new_session_after_missing_load.failed",
                    )
                    .await
                    {
                        Ok(resp) => resp,
                        Err(error) => {
                            let _ = ready_tx.send(Err(anyhow::anyhow!(
                                "ACP new_session after missing load_session resource: {error}"
                            )));
                            return Err(anyhow::anyhow!(
                                "ACP new_session after missing load_session resource: {error}"
                            ));
                        }
                    };

                    Ok((
                        new_session_resp.session_id.to_string(),
                        NativeSessionStartupState::from_new_session(&new_session_resp),
                        NativeSessionStartupDisposition::CreatedFresh,
                    ))
                }
                Err(e) => {
                    tracing::warn!(
                        session_id = %session_id,
                        workspace_id = %workspace_id,
                        native_session_id = %existing,
                        startup_strategy = startup_strategy_label,
                        elapsed_ms = load_started.elapsed().as_millis(),
                        error = %e,
                        "[workspace-latency] session.actor.load_session.failed"
                    );
                    let _ = ready_tx.send(Err(anyhow::anyhow!("ACP load_session: {e}")));
                    Err(anyhow::anyhow!("ACP load_session: {e}"))
                }
            }
        }
        SessionStartupStrategy::ForkFromNative {
            fork_operation_id,
            parent_native_session_id,
            provider_anchor,
        } => {
            hydrate_parent_and_fork(
                conn,
                inbound,
                fork_dispatch,
                workspace_path,
                mcp_servers,
                system_prompt_append,
                action_capabilities,
                fork_operation_id,
                parent_native_session_id,
                provider_anchor.as_ref(),
                session_id,
                workspace_id,
                ready_tx,
            )
            .await
        }
    }
}
