//! The polled model-snapshot status surface, and the manual re-probe.
//!
//! - `GET  /v1/agents/{kind}/model-snapshot` — the per-harness probe status,
//!   shaped after `GET /v1/agents/reconcile`: polled, never pushed. This is the
//!   pull-status pattern; a client that already polls install progress needs no new
//!   mechanism.
//! - `POST /v1/agents/{kind}/model-snapshot/refresh` — force a re-probe of the
//!   harness (the manual-refresh poke). It is the one call that awaits its probe
//!   and surfaces errors; every other trigger is fire-and-forget and swallows them
//!   (the document's `lastAttempt` carries them instead).
//!
//! **There is no `authContextId` parameter.** One composed observation per harness
//! (model-catalog.md, "Runtime routes"): the probe spawns the harness into its
//! full composed auth world, so "which context" has no meaning here. The rename is
//! a hard cutover with no alias window; all consumers are first-party.
//!
//! The status body carries the provenance fields (`attestation`,
//! `installIdentity`, `stateRevision`) for humans, and no staleness or fingerprint
//! fields — freshness is event-driven, and the projection types have no field for
//! either, so neither can leak.

use anyharness_contract::v1::ProblemDetails;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};

use super::error::ApiError;
use crate::app::AppState;
use crate::domains::agents::model_snapshot::status::ModelSnapshotStatus;
use crate::domains::agents::model_snapshot::RefreshError;
use crate::domains::agents::registry::descriptor;

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/model-snapshot",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "The harness's composed model-snapshot status", body = ModelSnapshotStatus),
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
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 202, description = "Re-probe completed; the status body reflects it", body = ModelSnapshotStatus),
        (status = 404, description = "Unknown agent kind, or the harness is not installed here", body = ProblemDetails),
        (status = 409, description = "This runtime does not own the probe engine, or its local auth config is unusable", body = ProblemDetails),
        (status = 502, description = "The forced probe ran and failed", body = ProblemDetails),
    ),
    tag = "catalogs"
)]
pub async fn refresh_model_snapshot(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<(StatusCode, Json<ModelSnapshotStatus>), ApiError> {
    ensure_path_safe_identifier(&kind, "kind")?;
    ensure_known_kind(&kind)?;
    let service = state.model_snapshot_service.clone();

    service.refresh_now(&kind).await.map_err(refresh_error)?;

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
/// `kind` ends up inside paths under the runtime home
/// (`agents/<kind>/model-snapshot.json`, the probe scratch directory name). The
/// semantic checks downstream — the registry lookup — reject unknown values, but
/// they are lookups, not shape proofs. This is the boundary guarantee that no
/// separator, dot, or control character from the wire can ever become part of a
/// path. Every legitimate identifier is lowercase kebab/underscore ASCII, so the
/// allowlist excludes nothing real.
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
/// reserved for a probe that actually ran and failed. A malformed `state.json` is a
/// LOCAL configuration fault — the request was well-formed and no upstream was
/// reached — so it answers `409`, the same code the route already uses for "this
/// runtime cannot serve that right now".
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
        RefreshError::NotInstalled(_) => {
            ApiError::new(StatusCode::NOT_FOUND, error.to_string(), None, Some(code))
        }
        RefreshError::Material(material_error) => {
            tracing::warn!(%material_error, "model snapshot refresh could not resolve its auth material");
            ApiError::new(
                StatusCode::CONFLICT,
                "this machine's agent-auth configuration cannot be probed",
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
