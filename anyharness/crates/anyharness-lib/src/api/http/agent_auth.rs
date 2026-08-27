//! Agent-auth state transport handler: the desktop (which owns the cloud
//! session) fetches the local-surface state document from the control plane
//! (`GET /agent-auth/state?surface=local`) and pushes it here verbatim;
//! the body is the state.json contract (`route_auth/state.rs`). The runtime
//! persists it atomically (0600) at `<runtime_home>/agent-auth/state.json`,
//! where every session launch reads it fresh.

use anyharness_contract::v1::{ApplyAgentAuthStateResponse, NativeBridgeResponse};
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::launch_probe::{LaunchProbeService, PokeReason};
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::route_auth::{
    apply_state_file, clear_native_bridge_flag, clear_native_bridge_flags_for_document,
    clear_state_file, native_bridge, pending_native_bridge_harnesses, AgentAuthState,
    RouteAuthError,
};

#[utoipa::path(
    put,
    path = "/v1/agent-auth/state",
    request_body(
        content = String,
        description = "Agent-auth state document (the state.json contract)",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "State persisted", body = ApplyAgentAuthStateResponse),
        (status = 400, description = "Payload rejected; persisted state unchanged", body = anyharness_contract::v1::ProblemDetails),
        (status = 409, description = "Stale revision; persisted state unchanged", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn put_agent_auth_state(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<ApplyAgentAuthStateResponse>, ApiError> {
    let document: AgentAuthState = serde_json::from_slice(&body).map_err(|error| {
        ApiError::bad_request(
            format!("agent-auth state payload rejected: {error}"),
            "AGENT_AUTH_STATE_REJECTED",
        )
    })?;
    if document.revision < 0 {
        return Err(ApiError::bad_request(
            "agent-auth state revision must be >= 0",
            "AGENT_AUTH_STATE_REJECTED",
        ));
    }
    apply_state_file(&state.runtime_home, &document).map_err(map_route_auth_error)?;
    // Native-migration bridge: a harness the applied document names has been
    // configured (mint, key, or gateway) — that IS the act the one-time prompt
    // asked for, so its legacy flag is dropped here. Best-effort: the document
    // is already persisted and decides that harness's launches regardless.
    if let Err(error) = clear_native_bridge_flags_for_document(&state.runtime_home, &document) {
        tracing::warn!(%error, "native-bridge flags could not be cleared for the applied document");
    }
    // Auth-applied poke — the primary trigger (model-catalog.md, "Freshness is
    // event-driven"): an applied `state.json` re-probes every harness the applied
    // document names, unconditionally. There is no fingerprint gate deciding
    // which "actually" changed; the event IS the invalidation, and the engine's
    // single-flight coalescing bounds the cost.
    //
    // Fire-and-forget: the apply response never waits for a probe; the picker
    // shows a refreshing state rather than stale data presented as current.
    LaunchProbeService::poke_harnesses_optional(
        &state.automatic_poke_engine,
        &applied_harness_kinds(&document),
        PokeReason::AuthApplied,
    );
    Ok(Json(ApplyAgentAuthStateResponse {
        applied: true,
        revision: document.revision,
    }))
}

#[utoipa::path(
    delete,
    path = "/v1/agent-auth/state",
    responses(
        (status = 204, description = "Persisted route state cleared; native auth is active"),
        (status = 500, description = "State could not be cleared", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn delete_agent_auth_state(
    State(state): State<AppState>,
) -> Result<StatusCode, ApiError> {
    clear_state_file(&state.runtime_home).map_err(map_route_auth_error)?;
    // Clearing the state file removes EVERY harness's selection — the widest
    // possible auth application. Without a poke here every harness's observation
    // stays pinned to an auth world that no longer exists, and the picker keeps
    // serving models the machine can no longer reach.
    LaunchProbeService::poke_all_optional(&state.automatic_poke_engine, PokeReason::AuthApplied);
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/v1/agent-auth/native-bridge",
    responses(
        (status = 200, description = "Harnesses still carrying the native-migration legacy flag", body = NativeBridgeResponse),
        (status = 500, description = "Bridge file unreadable", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn get_native_bridge(
    State(state): State<AppState>,
) -> Result<Json<NativeBridgeResponse>, ApiError> {
    let seeded = native_bridge::load_native_bridge(&state.runtime_home)
        .map_err(map_route_auth_error)?
        .is_some();
    let harnesses = pending_native_bridge_harnesses(&state.runtime_home)
        .map_err(map_route_auth_error)?
        .into_iter()
        .collect();
    Ok(Json(NativeBridgeResponse { seeded, harnesses }))
}

/// The dismiss-to-configure act of the one-time prompt: drop one harness's
/// legacy flag so its next launch follows the real convention. Idempotent —
/// a harness without a flag answers 204 too.
#[utoipa::path(
    delete,
    path = "/v1/agent-auth/native-bridge/{kind}",
    params(("kind" = String, Path, description = "Harness kind")),
    responses(
        (status = 204, description = "Legacy flag cleared (or was not held)"),
        (status = 400, description = "Unknown harness kind", body = anyharness_contract::v1::ProblemDetails),
        (status = 500, description = "Bridge file could not be written", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn dismiss_native_bridge(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<StatusCode, ApiError> {
    let Some(kind) = AgentKind::parse(&kind) else {
        return Err(ApiError::bad_request(
            format!("unknown harness kind '{kind}'"),
            "AGENT_ROUTE_UNKNOWN_HARNESS",
        ));
    };
    clear_native_bridge_flag(&state.runtime_home, kind.as_str()).map_err(map_route_auth_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every harness the applied document mentions — NOT only those with a gateway
/// source.
///
/// This is the behavioral difference from the gateway-only scheduler it replaces,
/// and it is the point of the change: an apply that switches a harness from a
/// gateway route to a raw provider key, or that drops its sources entirely, changes
/// that harness's credential material just as much as landing a gateway key does. The
/// old code skipped every such harness, so its snapshot stayed pinned to credentials
/// the machine no longer uses. Naming them all is exactly the spec's trigger: "the
/// ack fires a probe for every harness whose entry the applied document changed".
fn applied_harness_kinds(document: &AgentAuthState) -> Vec<String> {
    document
        .harnesses
        .iter()
        .map(|harness| harness.harness_kind.clone())
        .collect()
}

fn map_route_auth_error(error: RouteAuthError) -> ApiError {
    match error {
        RouteAuthError::StaleStateRevision { .. } => {
            ApiError::conflict(error.to_string(), error.code())
        }
        _ => ApiError::internal(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(harnesses: &[(&str, &[&str])]) -> AgentAuthState {
        let json = serde_json::json!({
            "version": 2,
            "revision": 9,
            "harnesses": harnesses
                .iter()
                .map(|(kind, source_kinds)| serde_json::json!({
                    "harness_kind": kind,
                    "sources": source_kinds
                        .iter()
                        .map(|source_kind| serde_json::json!({
                            "kind": source_kind,
                            "base_url": "https://gw.example",
                            "key": "sk-value",
                            "env_var_name": "ANTHROPIC_API_KEY",
                        }))
                        .collect::<Vec<_>>(),
                }))
                .collect::<Vec<_>>(),
        });
        serde_json::from_value(json).expect("state document")
    }

    /// The poke names EVERY harness the document mentions, not only the
    /// gateway-routed ones.
    ///
    /// This is the behavioral delta from `schedule_gateway_probes`, and the reason the
    /// wider list is correct: an apply that moves a harness from a gateway route to a
    /// raw provider key, or that empties its sources entirely, changes that harness's
    /// credential material exactly as much as landing a gateway key does. The old code
    /// skipped all three of those cases, leaving the snapshot pinned to credentials the
    /// machine no longer uses. Naming them all is the spec's trigger — every harness
    /// the applied document mentions re-probes.
    #[test]
    fn every_harness_in_the_applied_document_is_named() {
        let applied = document(&[
            ("claude", &["gateway"]),
            // api_key only: the gateway-only scheduler skipped this harness.
            ("codex", &["api_key"]),
            // Sources emptied: the widest change of all, and also skipped before.
            ("opencode", &[]),
        ]);

        assert_eq!(
            applied_harness_kinds(&applied),
            vec!["claude", "codex", "opencode"]
        );
    }

    /// An empty document names nothing, so an apply that mentions no harness pokes no
    /// harness. (Clearing every harness's auth goes through `DELETE`, which pokes all
    /// of them — a different site with a different reason.)
    #[test]
    fn an_empty_document_names_no_harness() {
        assert!(applied_harness_kinds(&document(&[])).is_empty());
    }
}
