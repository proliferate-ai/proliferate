use axum::{
    routing::{get, patch, post, put},
    Router,
};

use crate::api::http::sessions_pending;
use crate::app::AppState;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/sessions/{session_id}/pending-prompts/order",
            put(sessions_pending::reorder_pending_prompts),
        )
        .route(
            "/sessions/{session_id}/pending-prompts/{seq}",
            patch(sessions_pending::edit_pending_prompt)
                .delete(sessions_pending::delete_pending_prompt),
        )
        .route(
            "/sessions/{session_id}/pending-prompts/{seq}/steer",
            post(sessions_pending::steer_pending_prompt),
        )
        .route(
            "/sessions/{session_id}/prompt-attachments/{attachment_id}",
            get(sessions_pending::get_prompt_attachment),
        )
}
