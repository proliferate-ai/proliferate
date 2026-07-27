//! Agent-auth state transport handler: the desktop (which owns the cloud
//! session) fetches the local-surface state document from the control plane
//! (`GET /agent-auth/state?surface=local`) and pushes it here verbatim;
//! the body is the state.json contract (`route_auth/state.rs`). The runtime
//! persists it atomically (0600) at `<runtime_home>/agent-auth/state.json`,
//! where every session launch reads it fresh.

use anyharness_contract::v1::ApplyAgentAuthStateResponse;
use axum::{body::Bytes, extract::State, http::StatusCode, Json};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::model_snapshot::{ModelSnapshotService, PokeReason};
use crate::domains::agents::route_auth::{
    apply_state_file, clear_state_file, AgentAuthState, RouteAuthError,
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
    // Auth-applied poke (model-catalog.md, "The snapshot reconciler"). This
    // REPLACES the old gateway-only probe scheduler, and the difference is the
    // point: the poke names every harness the applied document mentions, and the
    // per-(harness, context) FINGERPRINT gate — not this handler — decides which
    // actually re-probe. That makes invalidation "exactly as wide as the change"
    // instead of as wide as the trigger, which the old global-revision keying
    // could not do.
    //
    // Fire-and-forget: the apply response never waits for a probe.
    ModelSnapshotService::poke_harnesses_optional(
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
    // Clearing the state file removes EVERY harness's selection, so it is the
    // widest possible fingerprint change — wider than any apply. Without a poke
    // here every harness's entries stay pinned to credentials that no longer
    // exist, and the picker keeps serving models the machine can no longer reach.
    ModelSnapshotService::poke_all_optional(
        &state.automatic_poke_engine,
        PokeReason::AuthCleared,
    );
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
/// the machine no longer uses. Naming them all is safe precisely because the
/// fingerprint gate, not this list, decides what re-probes.
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
    /// machine no longer uses. Widening is safe because the fingerprint gate — not this
    /// list — decides what re-probes.
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
