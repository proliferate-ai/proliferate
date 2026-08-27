//! ACP `InitializeResponse` -> `SessionActionCapabilities` parsing, plus the
//! `_meta.anyharness` GoalPort/LoopPort capability advertisements. Split out
//! of `startup.rs` (PROD-SIZE-1): this is pure handshake-response parsing,
//! independent of the actor construction sequence that calls it.

use agent_client_protocol as acp;
use anyharness_contract::v1::SessionActionCapabilities;

use crate::domains::agents::model::AgentKind;
use crate::domains::sessions::model::serialize_action_capabilities;
use crate::live::sessions::driver::native_session::{
    parse_anyharness_targeted_fork_extension, TargetedForkExtensionTarget,
};
use crate::live::sessions::model::SessionStateDurable;

pub(in crate::live::sessions::actor) fn persist_session_action_capabilities(
    store: &dyn SessionStateDurable,
    session_id: &str,
    agent_kind: &str,
    init_response: &acp::schema::InitializeResponse,
) {
    let capabilities = action_capabilities_from_acp(agent_kind, init_response);
    let Ok(json) = serialize_action_capabilities(capabilities) else {
        tracing::warn!(
            session_id,
            "failed to serialize session action capabilities"
        );
        return;
    };
    let now = chrono::Utc::now().to_rfc3339();
    if let Err(error) = store.update_action_capabilities_json(session_id, Some(json), &now) {
        tracing::warn!(
            session_id,
            error = %error,
            "failed to persist session action capabilities"
        );
    }
}

pub(in crate::live::sessions::actor) fn action_capabilities_from_acp(
    agent_kind: &str,
    init_response: &acp::schema::InitializeResponse,
) -> SessionActionCapabilities {
    let agent_capabilities = &init_response.agent_capabilities;
    let fork_capability = agent_capabilities.session_capabilities.fork.as_ref();
    let fork = agent_capabilities.load_session && fork_capability.is_some();
    let targeted_fork_meta = fork_capability.and_then(|capability| capability.meta.as_ref());
    let advertised_target = targeted_fork_meta.and_then(parse_anyharness_targeted_fork_extension);
    let targeted_fork = fork
        && agent_kind == AgentKind::Claude.as_str()
        && advertised_target == Some(TargetedForkExtensionTarget::MessageId);
    if targeted_fork_meta.is_some() {
        tracing::debug!(
            agent_family = bounded_agent_family(agent_kind),
            advertised_target = advertised_target
                .map(TargetedForkExtensionTarget::as_str)
                .unwrap_or("none"),
            dispatch_status = targeted_fork_dispatch_status(agent_kind, fork, advertised_target,),
            "classified ACP targeted fork capability"
        );
    }
    let (mut supports_loops, loops_native) =
        loops_capability_from_init_meta(init_response.meta.as_ref());
    // Runtime-emulated loops (Codex) never advertise `loops` in `_meta` — the
    // sidecar has no LoopPort — but the runtime scheduler fully drives them.
    // Advertise support so the ⟳ loops chip is reachable; `loops_native` stays
    // false, marking the emulated (non-mirror) path.
    if !supports_loops && crate::domains::loops::runtime::is_emulated_loop_agent_kind(agent_kind) {
        supports_loops = true;
    }
    SessionActionCapabilities {
        fork,
        targeted_fork,
        supports_goals: supports_goals_from_init_meta(init_response.meta.as_ref()),
        supports_loops,
        loops_native,
    }
}

fn bounded_agent_family(agent_kind: &str) -> &'static str {
    AgentKind::parse(agent_kind)
        .map(|kind| kind.as_str())
        .unwrap_or("unknown")
}

fn targeted_fork_dispatch_status(
    agent_kind: &str,
    fork: bool,
    advertised_target: Option<TargetedForkExtensionTarget>,
) -> &'static str {
    if !fork {
        return "base_fork_unavailable";
    }
    match (agent_kind, advertised_target) {
        ("claude", Some(TargetedForkExtensionTarget::MessageId)) => "ready",
        ("opencode", Some(_)) => "side_door_owned",
        (_, Some(_)) => "adapter_target_mismatch",
        (_, None) => "advertisement_invalid",
    }
}

/// `InitializeResponse._meta.anyharness.goals` — the GoalPort capability
/// advertisement (wire contract v1). Anything short of an explicit
/// `{ schemaVersion: 1, goals: { supported: true } }` degrades to
/// unsupported: stale sidecars must never break.
fn supports_goals_from_init_meta(meta: Option<&acp::schema::Meta>) -> bool {
    let Some(anyharness) = meta
        .and_then(|meta| meta.get("anyharness"))
        .and_then(|value| value.as_object())
    else {
        return false;
    };
    if anyharness
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
    {
        return false;
    }
    anyharness
        .get("goals")
        .and_then(|goals| goals.get("supported"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

/// `InitializeResponse._meta.anyharness.loops` — the LoopPort capability
/// advertisement (wire contract v1: `{ supported, native }`). Same
/// degrade-to-unsupported rule as goals: anything short of an explicit
/// `{ schemaVersion: 1, loops: { supported: true } }` reports
/// `(false, false)` so a stale sidecar never breaks. `native` is only
/// meaningful when `supported` is true — claude-agent-acp advertises
/// `native: true` (session crons); codex-acp omits `loops` entirely in v1
/// (runtime-emulated by `LoopSchedulerExtension`, not the sidecar).
fn loops_capability_from_init_meta(meta: Option<&acp::schema::Meta>) -> (bool, bool) {
    let Some(anyharness) = meta
        .and_then(|meta| meta.get("anyharness"))
        .and_then(|value| value.as_object())
    else {
        return (false, false);
    };
    if anyharness
        .get("schemaVersion")
        .and_then(|value| value.as_u64())
        != Some(1)
    {
        return (false, false);
    }
    let Some(loops) = anyharness.get("loops").and_then(|value| value.as_object()) else {
        return (false, false);
    };
    let supported = loops
        .get("supported")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !supported {
        return (false, false);
    }
    let native = loops
        .get("native")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    (true, native)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn init_meta(value: serde_json::Value) -> acp::schema::Meta {
        let serde_json::Value::Object(map) = value else {
            panic!("meta fixture must be an object");
        };
        acp::schema::Meta::from_iter(map)
    }

    #[test]
    fn supports_goals_requires_schema_version_and_supported_flag() {
        assert!(supports_goals_from_init_meta(Some(&init_meta(
            serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "goals": { "supported": true, "native": true }
                }
            })
        ))));
        assert!(!supports_goals_from_init_meta(Some(&init_meta(
            serde_json::json!({
                "anyharness": {
                    "schemaVersion": 2,
                    "goals": { "supported": true }
                }
            })
        ))));
        assert!(!supports_goals_from_init_meta(Some(&init_meta(
            serde_json::json!({
                "anyharness": { "schemaVersion": 1 }
            })
        ))));
        assert!(!supports_goals_from_init_meta(Some(&init_meta(
            serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "goals": { "supported": false }
                }
            })
        ))));
        assert!(!supports_goals_from_init_meta(None));
    }

    #[test]
    fn loops_capability_requires_schema_version_and_supported_flag() {
        // claude-agent-acp: native loops.
        assert_eq!(
            loops_capability_from_init_meta(Some(&init_meta(serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "loops": { "supported": true, "native": true }
                }
            })))),
            (true, true)
        );
        // codex-acp v1: loops omitted entirely (runtime-emulated, not the
        // sidecar) — degrades to unsupported.
        assert_eq!(
            loops_capability_from_init_meta(Some(&init_meta(serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "goals": { "supported": true, "native": true }
                }
            })))),
            (false, false)
        );
        // Wrong schema version degrades to unsupported even if the flag is set.
        assert_eq!(
            loops_capability_from_init_meta(Some(&init_meta(serde_json::json!({
                "anyharness": {
                    "schemaVersion": 2,
                    "loops": { "supported": true, "native": true }
                }
            })))),
            (false, false)
        );
        // Explicitly unsupported.
        assert_eq!(
            loops_capability_from_init_meta(Some(&init_meta(serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "loops": { "supported": false }
                }
            })))),
            (false, false)
        );
        // Supported but not native (a future runtime-emulated-by-sidecar case).
        assert_eq!(
            loops_capability_from_init_meta(Some(&init_meta(serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "loops": { "supported": true, "native": false }
                }
            })))),
            (true, false)
        );
        assert_eq!(loops_capability_from_init_meta(None), (false, false));
    }

    #[test]
    fn action_capabilities_from_acp_wires_loops_capability_into_session_capabilities() {
        let mut init_response =
            acp::schema::InitializeResponse::new(acp::schema::ProtocolVersion::V1);
        init_response.meta = Some(init_meta(serde_json::json!({
            "anyharness": {
                "schemaVersion": 1,
                "goals": { "supported": true, "native": true },
                "loops": { "supported": true, "native": true }
            }
        })));
        let capabilities = action_capabilities_from_acp("claude", &init_response);
        assert!(capabilities.supports_goals);
        assert!(capabilities.supports_loops);
        assert!(capabilities.loops_native);
    }

    #[test]
    fn action_capabilities_from_acp_advertises_emulated_loops_for_codex() {
        // codex-acp omits `loops` from `_meta` entirely, but the runtime
        // emulates loops for it — the capability must still report supported so
        // the ⟳ loops chip is reachable, with loops_native=false.
        let init_response = acp::schema::InitializeResponse::new(acp::schema::ProtocolVersion::V1);
        let capabilities = action_capabilities_from_acp("codex", &init_response);
        assert!(capabilities.supports_loops);
        assert!(!capabilities.loops_native);

        // A non-emulated kind with no `loops` meta stays unsupported.
        let claude = action_capabilities_from_acp("claude", &init_response);
        assert!(!claude.supports_loops);
    }

    fn init_response_with_fork(
        fork_capability: Option<acp::schema::SessionForkCapabilities>,
        top_level_meta: Option<serde_json::Value>,
    ) -> acp::schema::InitializeResponse {
        let session_capabilities = acp::schema::SessionCapabilities::new().fork(fork_capability);
        let agent_capabilities = acp::schema::AgentCapabilities::new()
            .load_session(true)
            .session_capabilities(session_capabilities);
        let mut init_response =
            acp::schema::InitializeResponse::new(acp::schema::ProtocolVersion::V1)
                .agent_capabilities(agent_capabilities);
        init_response.meta = top_level_meta.map(init_meta);
        init_response
    }

    fn strict_targeted_fork_capability(target: &str) -> acp::schema::SessionForkCapabilities {
        acp::schema::SessionForkCapabilities::new().meta(Some(init_meta(serde_json::json!({
            "anyharness": {
                "schemaVersion": 1,
                "targetedFork": {"fileEffects": "none", "target": target},
            },
        }))))
    }

    #[test]
    fn targeted_fork_stays_false_for_currently_pinned_claude_advertisement() {
        // Claude .2 shape: fork capability advertised with no meta of its
        // own; the init-level `_meta.anyharness.fork` shape is the pinned
        // (non-targeted) capability, not the strict targetedFork shape.
        let init_response = init_response_with_fork(
            Some(acp::schema::SessionForkCapabilities::new()),
            Some(serde_json::json!({
                "anyharness": {"fork": {"version": 1, "anchor": "upToMessageId"}},
            })),
        );
        let capabilities = action_capabilities_from_acp("claude", &init_response);
        assert!(capabilities.fork);
        assert!(!capabilities.targeted_fork);
    }

    #[test]
    fn targeted_fork_stays_false_for_currently_pinned_codex_advertisement() {
        // Codex .1 shape: fork capability present, no meta at all anywhere.
        let init_response =
            init_response_with_fork(Some(acp::schema::SessionForkCapabilities::new()), None);
        let capabilities = action_capabilities_from_acp("codex", &init_response);
        assert!(capabilities.fork);
        assert!(!capabilities.targeted_fork);
    }

    #[test]
    fn targeted_fork_true_for_strict_shape_with_message_id_target() {
        let fork_capability = strict_targeted_fork_capability("message_id");
        let init_response = init_response_with_fork(Some(fork_capability), None);
        let capabilities = action_capabilities_from_acp("claude", &init_response);
        assert!(capabilities.targeted_fork);
    }

    #[test]
    fn targeted_fork_false_for_recognized_but_unimplemented_adapter_target_pairs() {
        for (agent_kind, target) in [
            ("claude", "turn_id"),
            ("claude", "user_message_index"),
            ("codex", "turn_id"),
            ("codex", "message_id"),
            ("opencode", "message_id"),
            ("unknown-agent", "message_id"),
        ] {
            let init_response =
                init_response_with_fork(Some(strict_targeted_fork_capability(target)), None);
            let capabilities = action_capabilities_from_acp(agent_kind, &init_response);
            assert!(
                capabilities.fork,
                "base fork missing for {agent_kind}+{target}"
            );
            assert!(
                !capabilities.targeted_fork,
                "unexpected readiness for {agent_kind}+{target}"
            );
        }
    }

    #[test]
    fn targeted_fork_false_for_malformed_and_legacy_extension_metadata() {
        for meta in [
            serde_json::json!({
                "anyharness": {"fork": {"version": 1, "anchor": "upToMessageId"}},
            }),
            serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "targetedFork": {"fileEffects": "none", "target": "unknown"},
                },
            }),
        ] {
            let fork_capability =
                acp::schema::SessionForkCapabilities::new().meta(Some(init_meta(meta)));
            let init_response = init_response_with_fork(Some(fork_capability), None);
            assert!(!action_capabilities_from_acp("claude", &init_response).targeted_fork);
        }
    }

    #[test]
    fn targeted_fork_observability_labels_are_bounded() {
        assert_eq!(bounded_agent_family("private-agent-value"), "unknown");
        assert_eq!(
            targeted_fork_dispatch_status("codex", true, Some(TargetedForkExtensionTarget::TurnId),),
            "adapter_target_mismatch"
        );
        assert_eq!(
            targeted_fork_dispatch_status("claude", true, None),
            "advertisement_invalid"
        );
    }

    #[test]
    fn targeted_fork_false_when_load_session_is_false() {
        let fork_capability =
            acp::schema::SessionForkCapabilities::new().meta(Some(init_meta(serde_json::json!({
                "anyharness": {
                    "schemaVersion": 1,
                    "targetedFork": {"fileEffects": "none", "target": "message_id"},
                },
            }))));
        let session_capabilities =
            acp::schema::SessionCapabilities::new().fork(Some(fork_capability));
        let agent_capabilities = acp::schema::AgentCapabilities::new()
            .load_session(false)
            .session_capabilities(session_capabilities);
        let init_response = acp::schema::InitializeResponse::new(acp::schema::ProtocolVersion::V1)
            .agent_capabilities(agent_capabilities);
        let capabilities = action_capabilities_from_acp("claude", &init_response);
        assert!(!capabilities.fork);
        assert!(!capabilities.targeted_fork);
    }
}
