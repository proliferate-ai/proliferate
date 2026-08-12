use axum::{routing::get, Router};

use crate::api::http::support_windows;
use crate::app::AppState;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/workspaces/{workspace_id}/sessions/support-window",
            get(support_windows::list_sessions_support_window),
        )
        .route(
            "/sessions/{session_id}/events/support-window",
            get(support_windows::list_session_events_support_window),
        )
        .route(
            "/sessions/{session_id}/raw-notifications/support-window",
            get(support_windows::list_session_raw_notifications_support_window),
        )
}
