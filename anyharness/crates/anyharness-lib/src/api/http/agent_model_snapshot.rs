//! The polled model-snapshot status surface, and the manual re-probe.
//!
//! - `GET  /v1/agents/{kind}/model-snapshot` — per-(harness, context) probe state,
//!   shaped after `GET /v1/agents/reconcile`: polled, never pushed. This is the
//!   pull-status pattern; a client that already polls install progress needs no new
//!   mechanism.
//! - `POST /v1/agents/{kind}/model-snapshot/refresh?authContextId=` — force a
//!   re-probe of ONE context. It is the one call that awaits its probe and surfaces
//!   errors; every other trigger is fire-and-forget and swallows them (the entry's
//!   `lastAttempt` carries them instead).
//!
//! **`authContextId` is required, and that is a decision.** An earlier shape let it
//! be absent and meant "every active context", awaiting each in turn — which on
//! opencode is six contexts × a 240s probe timeout, serialized by a semaphore of 1:
//! a single HTTP request could hold for ~24 minutes. The design only ever specified
//! a single-context forced refresh awaiting its probe, so the fan-out shape was
//! invented here and is withdrawn. A surface that wants "refresh everything" issues
//! one request per context and polls the GET route for progress, which is exactly
//! how it already drives the reconcile job this route is shaped after.
//!
//! The status body deliberately carries no `authFingerprint`: it is a
//! credential-derived digest, and the client contract is the boolean `stale` plus
//! its reason. The projection type has no field for it, so it cannot leak.

use anyharness_contract::v1::ProblemDetails;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::model_snapshot::status::ModelSnapshotStatus;
use crate::domains::agents::model_snapshot::RefreshError;
use crate::domains::agents::registry::descriptor;

/// `camelCase` because that is what the utoipa parameter, the generated SDK and
/// every other query type in this layer declare. Without the rename a client
/// sending the documented `?authContextId=` would deserialize to `None` — the
/// silent-wrong-default class of bug, which is why the field is now REQUIRED: a
/// missing value is a 400, not a fan-out.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshQuery {
    /// Which auth context to re-probe. Required.
    pub auth_context_id: String,
}

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/model-snapshot",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "Per-auth-context model snapshot status", body = ModelSnapshotStatus),
        (status = 404, description = "Unknown agent kind", body = ProblemDetails),
    ),
    tag = "catalogs"
)]
pub async fn get_model_snapshot_status(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<ModelSnapshotStatus>, ApiError> {
    ensure_path_safe_identifier(&kind, "kind")?;
    ensure_known_kind(&kind)?;
    Ok(Json(
        state
            .model_snapshot_service
            .status(&kind, chrono::Utc::now()),
    ))
}

#[utoipa::path(
    post,
    path = "/v1/agents/{kind}/model-snapshot/refresh",
    params(
        ("kind" = String, Path, description = "Agent kind identifier"),
        ("authContextId" = String, Query, description = "The auth context to re-probe (required)"),
    ),
    responses(
        (status = 202, description = "Re-probe completed; the status body reflects it", body = ModelSnapshotStatus),
        (status = 400, description = "Missing authContextId", body = ProblemDetails),
        (status = 404, description = "Unknown agent kind or inactive auth context", body = ProblemDetails),
        (status = 409, description = "This runtime does not own the probe engine, or its local auth config is unusable", body = ProblemDetails),
        (status = 502, description = "The forced probe ran and failed", body = ProblemDetails),
    ),
    tag = "catalogs"
)]
pub async fn refresh_model_snapshot(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Query(query): Query<RefreshQuery>,
) -> Result<(StatusCode, Json<ModelSnapshotStatus>), ApiError> {
    ensure_path_safe_identifier(&kind, "kind")?;
    ensure_path_safe_identifier(&query.auth_context_id, "authContextId")?;
    ensure_known_kind(&kind)?;
    let service = state.model_snapshot_service.clone();

    // Exactly one context, awaited. See the module docs for why the "refresh every
    // active context" shape was withdrawn rather than made concurrent.
    service
        .refresh_now(&kind, &query.auth_context_id)
        .await
        .map_err(refresh_error)?;

    Ok((
        StatusCode::ACCEPTED,
        Json(service.status(&kind, chrono::Utc::now())),
    ))
}

fn ensure_known_kind(kind: &str) -> Result<(), ApiError> {
    descriptor(kind).map(|_| ()).ok_or_else(|| {
        ApiError::not_found(
            format!("unknown agent kind '{kind}'"),
            "MODEL_SNAPSHOT_UNKNOWN_AGENT",
        )
    })
}

/// Syntactic gate for wire identifiers that become filesystem path components.
///
/// `kind` and `authContextId` both end up inside paths under the runtime home
/// (`agents/<kind>/model-snapshot.json`, the probe scratch directory name). The
/// semantic checks downstream — the registry lookup, the active-context
/// membership test — reject unknown values, but they are lookups, not shape
/// proofs. This is the boundary guarantee that no separator, dot, or control
/// character from the wire can ever become part of a path. Every legitimate
/// identifier is lowercase kebab/underscore ASCII, so the allowlist excludes
/// nothing real.
pub(super) fn ensure_path_safe_identifier(value: &str, field: &str) -> Result<(), ApiError> {
    let well_formed = !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
    if well_formed {
        Ok(())
    } else {
        Err(ApiError::bad_request(
            format!("{field} must be 1-64 characters of [a-z0-9_-]"),
            "MODEL_SNAPSHOT_INVALID_IDENTIFIER",
        ))
    }
}

#[cfg(test)]
mod identifier_tests {
    use super::ensure_path_safe_identifier;

    #[test]
    fn accepts_every_real_identifier_shape() {
        for value in [
            "claude",
            "opencode",
            "anthropic-api",
            "api_key",
            "gateway",
            "b2",
        ] {
            assert!(
                ensure_path_safe_identifier(value, "kind").is_ok(),
                "{value}"
            );
        }
    }

    #[test]
    fn rejects_path_metacharacters_and_junk() {
        for value in [
            "",
            "..",
            "../claude",
            "a/b",
            "a\\b",
            "claude.json",
            "CLAUDE",
            "a b",
            "a\0b",
            &"x".repeat(65),
        ] {
            assert!(
                ensure_path_safe_identifier(value, "kind").is_err(),
                "{value:?}"
            );
        }
    }
}

/// Status codes mirror the contract the manual gateway-refresh endpoint
/// established, with one correction: `502` means an UPSTREAM failure, so it is
/// reserved for a probe that actually ran and failed. A malformed `state.json` or
/// an unsatisfiable selection is a LOCAL configuration fault — the request was
/// well-formed and no upstream was reached — so it answers `409`, the same code the
/// route already uses for "this runtime cannot serve that right now".
///
/// The detail is a stable machine-readable reason, never the error's `Display`:
/// `RouteAuthError::MalformedStateFile` embeds the absolute `state.json` path, and
/// echoing a filesystem path from the user's home into an HTTP body is a gratuitous
/// disclosure. The path is already in the runtime's own logs, where it belongs.
pub(super) fn refresh_error(error: RefreshError) -> ApiError {
    let code = error.code();
    match error {
        RefreshError::NotOwner => ApiError::new(
            StatusCode::CONFLICT,
            "another runtime owns the probe engine for this runtime home",
            Some("this runtime does not hold the probe-engine lock".to_string()),
            Some(code),
        ),
        RefreshError::UnknownContext { .. } | RefreshError::NotInstalled(_) => {
            ApiError::new(StatusCode::NOT_FOUND, error.to_string(), None, Some(code))
        }
        RefreshError::Material(material_error) => {
            tracing::warn!(%material_error, "model snapshot refresh could not resolve its auth material");
            ApiError::new(
                StatusCode::CONFLICT,
                "this machine's agent-auth configuration cannot be probed for that context",
                // The typed route-auth code, not the message: the message carries
                // the state file's absolute path.
                Some(material_error.code().to_string()),
                Some(code),
            )
        }
        RefreshError::Probe(probe_error) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "model snapshot probe failed",
            Some(probe_error.detail()),
            Some(code),
        ),
    }
}
