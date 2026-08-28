//! Agent-auth state transport handler: the desktop (which owns the cloud
//! session) fetches the local-surface state document from the control plane
//! (`GET /agent-auth/state?surface=local`) and pushes it here verbatim;
//! the body is the state.json contract (`route_auth/state.rs`). The runtime
//! persists it atomically (0600) at `<runtime_home>/agent-auth/state.json`,
//! where every session launch reads it fresh.

use anyharness_contract::v1::{
    AgentAuthMethodRow, AgentAuthStatusDoc, ApplyAgentAuthStateResponse, NativeBridgeResponse,
};
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};

use super::agent_auth_contract::{method_row_to_contract, status_doc_to_contract};
use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::launch_probe::{LaunchProbeService, PokeReason};
use crate::domains::agents::model::AgentKind;
use crate::domains::agents::route_auth::{
    apply_state_file, clear_native_bridge_flag, clear_native_bridge_flags_for_document,
    clear_state_file, native_bridge, AgentAuthState, RouteAuthError,
};
use crate::domains::agents::status::RefreshCause;

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
        (status = 409, description = "Stale sequence or foreign counter lineage; persisted state unchanged", body = anyharness_contract::v1::ProblemDetails),
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
    if document.sequence < 0 {
        return Err(ApiError::bad_request(
            "agent-auth state sequence must be >= 0",
            "AGENT_AUTH_STATE_REJECTED",
        ));
    }
    // Blocking-pool work (fs): the read-diff-write over state.json, under the
    // state file's exclusive lock. The startup path already treats identical
    // work this way (`app/agent_launch.rs`), and the door must match — an axum
    // worker blocked on a file lock stalls every other request on that thread.
    //
    // The dispatch lives INSIDE the same uncancellable task as the apply, on
    // purpose. `spawn_blocking` always runs to completion, but the handler
    // future can be dropped (client disconnect) between its `.await` and any
    // code after it — so a dispatch placed after the await could be severed
    // from a write that already committed. That loss is unrecoverable by
    // design: the courier's retry re-pushes the SAME document, whose diff
    // against the half-applied write is EMPTY (pinned by
    // `a_retry_of_an_identical_push_reports_an_empty_changed_set`), so the
    // changed set the pokes needed exists exactly once, here. Keeping
    // apply + poke + status refresh in one closure makes "the write happened
    // but nothing was told" structurally impossible — and a refused push
    // (stale sequence, foreign lineage) returns before the dispatch point, so
    // a rejection pokes nothing and refreshes nothing.
    //
    // The pokes are fire-and-forget `tokio::spawn`s (the runtime context
    // propagates into blocking threads); the status refresh is synchronous
    // sqlite work that already belonged on this pool. The response still
    // awaits the whole task, exactly as it awaited the refresh before.
    let runtime_home = state.runtime_home.clone();
    let applied = document.clone();
    let poke_engine = state.automatic_poke_engine.clone();
    let status_service = state.agent_status_service.clone();
    super::blocking::run_blocking("agent-auth state apply", move || {
        let outcome = apply_state_file(&runtime_home, &applied)?;
        // Native-migration bridge: a harness the applied document names has been
        // configured (mint, key, or gateway) — that IS the act the one-time prompt
        // asked for, so its legacy flag is dropped here. Best-effort: the document
        // is already persisted and decides that harness's launches regardless.
        // It rides INSIDE this closure with the apply for the same reason the
        // pokes do — it is fs work that must commit with the write it follows.
        if let Err(error) = clear_native_bridge_flags_for_document(&runtime_home, &applied) {
            tracing::warn!(%error, "native-bridge flags could not be cleared for the applied document");
        }
        // Auth-applied poke, per-harness targeted (spec §4, "Probe targeting":
        // `AuthApplied{changed}`): an apply re-probes ONLY the harnesses whose
        // entry actually changed — appeared, disappeared, or differs — so a
        // push that touched only grok cannot spawn a probe against codex, and
        // an identical re-push pokes nothing at all.
        LaunchProbeService::poke_harnesses_optional(
            &poke_engine,
            &outcome.changed_harnesses,
            PokeReason::AuthApplied,
        );
        // The same changed set refreshes the status documents — and ONLY
        // those: an untouched harness's document stays byte-stable across the
        // apply.
        status_service.refresh_harnesses(&outcome.changed_harnesses, RefreshCause::AuthApplied);
        Ok(outcome)
    })
    .await?
    .map_err(map_route_auth_error)?;
    Ok(Json(ApplyAgentAuthStateResponse {
        applied: true,
        sequence: document.sequence,
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
    // Same one-closure shape as the PUT above, and for the same reason: the
    // remove commits on the blocking pool regardless of the handler future's
    // fate, so the pokes and refreshes it owes must commit with it. A clear is
    // even less recoverable than a push — there is no courier retry carrying
    // the previous document's names.
    let runtime_home = state.runtime_home.clone();
    let poke_engine = state.automatic_poke_engine.clone();
    let status_service = state.agent_status_service.clone();
    super::blocking::run_blocking("agent-auth state clear", move || {
        let cleared = clear_state_file(&runtime_home)?;
        // Clearing removes the selections of every harness the previous
        // document named — that list IS the changed set, so exactly those
        // harnesses are poked. A previous file that was present but malformed
        // carries no readable names; the widest targeting (every eligible
        // harness) is the honest fallback there. An absent file cleared
        // nothing and pokes nothing.
        match &cleared.previous_harnesses {
            Some(previous) => {
                LaunchProbeService::poke_harnesses_optional(
                    &poke_engine,
                    previous,
                    PokeReason::AuthApplied,
                );
                status_service.refresh_harnesses(previous, RefreshCause::AuthApplied);
            }
            None => {
                LaunchProbeService::poke_all_optional(&poke_engine, PokeReason::AuthApplied);
                status_service.refresh_all(RefreshCause::AuthApplied);
            }
        }
        Ok(cleared)
    })
    .await?
    .map_err(map_route_auth_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, serde::Deserialize)]
pub struct AgentAuthStatusQuery {
    /// Filter to one harness (404 for a harness the runtime doesn't know).
    pub harness: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/agent-auth/status",
    params(("harness" = Option<String>, Query, description = "Filter to one harness kind")),
    responses(
        (status = 200, description = "The persisted per-harness status documents", body = Vec<AgentAuthStatusDoc>),
        (status = 404, description = "Unknown harness", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn get_agent_auth_status(
    State(state): State<AppState>,
    Query(query): Query<AgentAuthStatusQuery>,
) -> Result<Json<Vec<AgentAuthStatusDoc>>, ApiError> {
    // The 404 gate is an in-memory scan of the known universe, so it stays on
    // this task — nothing below it may reach sqlite without leaving.
    if let Some(harness) = query.harness.as_deref() {
        require_known_harness(&state, harness)?;
    }
    let service = state.agent_status_service.clone();
    // Blocking-pool work (sqlite behind the shared connection mutex).
    let docs = super::blocking::run_blocking("agent-auth status read", move || {
        Ok::<Vec<AgentAuthStatusDoc>, std::convert::Infallible>(match query.harness {
            Some(harness) => service
                .read(&harness)
                .into_iter()
                .map(status_doc_to_contract)
                .collect(),
            None => service
                .read_all()
                .into_iter()
                .map(status_doc_to_contract)
                .collect(),
        })
    });
    Ok(Json(docs.await?.unwrap_or_default()))
}

#[derive(Debug, serde::Deserialize)]
pub struct AgentAuthMethodsQuery {
    pub harness: String,
}

#[utoipa::path(
    get,
    path = "/v1/agent-auth/methods",
    params(("harness" = String, Query, description = "Harness kind (required)")),
    responses(
        (status = 200, description = "The harness's method rows, straight from its status document", body = Vec<AgentAuthMethodRow>),
        (status = 404, description = "Unknown harness", body = anyharness_contract::v1::ProblemDetails),
    ),
    tag = "agent-auth"
)]
pub async fn get_agent_auth_methods(
    State(state): State<AppState>,
    Query(query): Query<AgentAuthMethodsQuery>,
) -> Result<Json<Vec<AgentAuthMethodRow>>, ApiError> {
    require_known_harness(&state, &query.harness)?;
    // Served FROM the status document (never recomposed on read): the method
    // picker needs no document parsing, and cannot disagree with the pane.
    // The row read itself is blocking-pool work.
    let service = state.agent_status_service.clone();
    let rows = super::blocking::run_blocking("agent-auth methods read", move || {
        Ok::<Vec<AgentAuthMethodRow>, std::convert::Infallible>(
            service
                .read(&query.harness)
                .map(|doc| {
                    doc.methods
                        .into_iter()
                        .map(method_row_to_contract)
                        .collect()
                })
                .unwrap_or_default(),
        )
    });
    Ok(Json(rows.await?.unwrap_or_default()))
}

fn require_known_harness(state: &AppState, harness: &str) -> Result<(), ApiError> {
    if state.agent_status_service.is_known_harness(harness) {
        Ok(())
    } else {
        Err(ApiError::not_found(
            format!("Unknown harness kind: {harness}"),
            "AGENT_AUTH_UNKNOWN_HARNESS",
        ))
    }
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
    // One read serves both fields — two reads could interleave with a
    // concurrent dismiss and answer an incoherent (seeded, harnesses) pair.
    let bridge =
        native_bridge::load_native_bridge(&state.runtime_home).map_err(map_route_auth_error)?;
    let seeded = bridge.is_some();
    let harnesses = bridge
        .map(|bridge| bridge.harnesses.into_iter().collect())
        .unwrap_or_default();
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

/// State-route mapping: ONE mapper with the sessions API
/// (`sessions_errors::map_route_auth_error`, exhaustive, refusal family
/// rendered through the `LaunchRefusal` vocabulary). Only
/// `StaleStateSequence` can actually arise from
/// `apply_state_file`/`clear_state_file`; delegating rather than mirroring
/// is what makes "the two mappers can never disagree" structural.
fn map_route_auth_error(error: RouteAuthError) -> ApiError {
    super::sessions_errors::map_route_auth_error(&error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    struct TempHome(PathBuf);

    impl TempHome {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "anyharness-agent-auth-handler-{label}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).expect("create temp home");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn document(sequence: i64, harnesses: &[(&str, &[&str])]) -> AgentAuthState {
        let json = serde_json::json!({
            "version": 2,
            "lineage": "test-lineage",
            "sequence": sequence,
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

    /// The changed-set semantics the AuthApplied poke targets (spec §4, "Probe
    /// targeting"): an apply that changed only grok pokes only grok, and an
    /// identical re-push pokes nothing.
    #[test]
    fn auth_applied_targets_changed_harnesses_only() {
        let home = TempHome::new("changed-set");
        let first = document(1, &[("claude", &["gateway"]), ("grok", &["api_key"])]);
        let outcome = apply_state_file(home.path(), &first).expect("first apply");
        // The first apply against an absent file: everything appeared.
        assert_eq!(outcome.changed_harnesses, vec!["claude", "grok"]);

        // Only grok's entry changed (sources emptied) → only grok is named.
        let second = document(2, &[("claude", &["gateway"]), ("grok", &[])]);
        let outcome = apply_state_file(home.path(), &second).expect("second apply");
        assert_eq!(outcome.changed_harnesses, vec!["grok"]);

        // An identical re-push (same sequence, same content) changes nothing.
        let outcome = apply_state_file(home.path(), &second).expect("re-push");
        assert!(
            outcome.changed_harnesses.is_empty(),
            "an identical re-push must poke nothing"
        );

        // A disappeared entry is a change too — dropping claude names claude.
        let third = document(3, &[("grok", &[])]);
        let outcome = apply_state_file(home.path(), &third).expect("third apply");
        assert_eq!(outcome.changed_harnesses, vec!["claude"]);
    }

    /// A previously malformed file carries no trustworthy baseline: every
    /// harness the incoming document names counts as changed.
    #[test]
    fn a_heal_of_a_malformed_file_counts_every_named_harness_as_changed() {
        let home = TempHome::new("heal-changed-set");
        let path = crate::domains::agents::route_auth::state_file_path(home.path());
        std::fs::create_dir_all(path.parent().expect("parent")).expect("create agent-auth");
        std::fs::write(&path, b"{ not json").expect("write malformed state");

        let healed = document(1, &[("codex", &["gateway"])]);
        let outcome = apply_state_file(home.path(), &healed).expect("heal");
        assert_eq!(outcome.changed_harnesses, vec!["codex"]);
    }

    /// DELETE's changed set is every harness the previous document named; a
    /// malformed previous file has unknowable names (`None` → the handler
    /// falls back to the widest poke), and an absent file names nothing.
    #[test]
    fn clearing_names_every_harness_the_previous_document_carried() {
        let home = TempHome::new("clear-changed-set");
        assert_eq!(
            clear_state_file(home.path())
                .expect("clear absent")
                .previous_harnesses,
            Some(vec![]),
            "an absent file clears nothing"
        );

        apply_state_file(
            home.path(),
            &document(1, &[("claude", &["gateway"]), ("opencode", &["api_key"])]),
        )
        .expect("apply");
        assert_eq!(
            clear_state_file(home.path())
                .expect("clear")
                .previous_harnesses,
            Some(vec!["claude".to_string(), "opencode".to_string()])
        );

        let path = crate::domains::agents::route_auth::state_file_path(home.path());
        std::fs::create_dir_all(path.parent().expect("parent")).expect("create agent-auth");
        std::fs::write(&path, b"{ not json").expect("write malformed state");
        assert_eq!(
            clear_state_file(home.path())
                .expect("clear malformed")
                .previous_harnesses,
            None,
            "a malformed previous file has unknowable names"
        );
    }
}
