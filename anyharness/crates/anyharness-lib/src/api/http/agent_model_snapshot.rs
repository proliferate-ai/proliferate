//! The polled model-snapshot status surface, and the manual re-probe.
//!
//! - `GET  /v1/agents/{kind}/model-snapshot` — per-(harness, context) probe state,
//!   shaped after `GET /v1/agents/reconcile`: polled, never pushed. This is the
//!   pull-status pattern; a client that already polls install progress needs no new
//!   mechanism.
//! - `POST /v1/agents/{kind}/model-snapshot/refresh` — force a re-probe. The one
//!   call that AWAITS its probe and surfaces errors; every other trigger is
//!   fire-and-forget and swallows them (the entry's `lastAttempt` carries them
//!   instead).
//!
//! The status body deliberately carries no `authFingerprint`: it is a
//! credential-derived digest, and the client contract is the boolean `stale` plus
//! its reason. The projection type has no field for it, so it cannot leak.

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

#[derive(Debug, Deserialize)]
pub struct RefreshQuery {
    /// Which auth context to re-probe. Absent means "every active context for this
    /// harness", which is what the settings Refresh button wants.
    #[serde(default)]
    pub auth_context_id: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v1/agents/{kind}/model-snapshot",
    params(("kind" = String, Path, description = "Agent kind identifier")),
    responses(
        (status = 200, description = "Per-auth-context model snapshot status"),
        (status = 404, description = "Unknown agent kind"),
    ),
    tag = "catalogs"
)]
pub async fn get_model_snapshot_status(
    State(state): State<AppState>,
    Path(kind): Path<String>,
) -> Result<Json<ModelSnapshotStatus>, ApiError> {
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
        ("authContextId" = Option<String>, Query, description = "Single auth context to re-probe"),
    ),
    responses(
        (status = 202, description = "Re-probe completed; the status body reflects it"),
        (status = 404, description = "Unknown agent kind or inactive auth context"),
        (status = 409, description = "This runtime does not own the probe engine"),
        (status = 502, description = "The forced probe failed"),
    ),
    tag = "catalogs"
)]
pub async fn refresh_model_snapshot(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    Query(query): Query<RefreshQuery>,
) -> Result<(StatusCode, Json<ModelSnapshotStatus>), ApiError> {
    ensure_known_kind(&kind)?;
    let service = state.model_snapshot_service.clone();

    let contexts: Vec<String> = match query.auth_context_id {
        Some(context) => vec![context],
        None => service.status(&kind, chrono::Utc::now())
            .contexts
            .into_iter()
            .filter(|context| context.active)
            .map(|context| context.auth_context_id)
            .collect(),
    };

    // Every requested context is refreshed, and the FIRST failure is surfaced —
    // partial success is still visible in the returned body, because each
    // successful context has already been persisted by the time we answer.
    let mut first_error = None;
    for context in &contexts {
        if let Err(error) = service.refresh_now(&kind, context).await {
            first_error.get_or_insert(error);
        }
    }
    if let Some(error) = first_error {
        return Err(refresh_error(error));
    }

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

/// Status codes mirror the contract the manual gateway-refresh endpoint
/// established: `502` for a probe that ran and failed, `409` for "not this
/// runtime's job", `404` for a context that is not active here.
fn refresh_error(error: RefreshError) -> ApiError {
    let code = error.code();
    match error {
        RefreshError::NotOwner => ApiError::new(
            StatusCode::CONFLICT,
            "another runtime owns the probe engine for this runtime home",
            Some(error.to_string()),
            Some(code),
        ),
        RefreshError::UnknownContext { .. } | RefreshError::NotInstalled(_) => {
            ApiError::new(StatusCode::NOT_FOUND, error.to_string(), None, Some(code))
        }
        RefreshError::Material(_) | RefreshError::Probe(_) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "model snapshot probe failed",
            Some(error.to_string()),
            Some(code),
        ),
    }
}
