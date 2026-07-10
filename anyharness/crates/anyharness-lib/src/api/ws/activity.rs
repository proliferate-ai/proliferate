//! `WS /v1/sessions/{session_id}/activity/watch` — a live SessionActivity feed.
//!
//! On connect it sends one `snapshot` frame (the current aggregate assembled
//! from the goal/loop/activity mirrors), then streams every activity-relevant
//! session event (`goal_*`, `loop_*`, `process_upserted`, `subagent_upserted`)
//! as `event` frames off the live session's broadcast channel. When the
//! session is not live it sends the snapshot and closes — there is nothing to
//! stream until it attaches (clients re-open on attach).

use anyharness_contract::v1::{SessionActivity, SessionEventEnvelope, TurnState};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Extension;
use futures::{SinkExt, StreamExt};

use crate::api::auth::AuthContext;
use crate::api::http::access::assert_session_auth_scope;
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::domains::goals::model::GoalRecord;
use crate::domains::loops::model::LoopRecord;

/// The session-event types this watch forwards.
const ACTIVITY_EVENT_TYPES: &[&str] = &[
    "goal_updated",
    "goal_met",
    "goal_cleared",
    "loop_upserted",
    "loop_removed",
    "loop_fired",
    "process_upserted",
    "subagent_upserted",
];

pub async fn activity_watch_ws(
    ws: WebSocketUpgrade,
    Path(session_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    assert_session_auth_scope(&state, &auth, &session_id)?;
    let snapshot = build_snapshot(&state, &session_id)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(ws.on_upgrade(move |socket| handle_activity_ws(socket, session_id, snapshot, state)))
}

fn build_snapshot(state: &AppState, session_id: &str) -> anyhow::Result<SessionActivity> {
    let goal = state
        .goal_service
        .current_goal(session_id)?
        .as_ref()
        .map(GoalRecord::to_contract);
    let loops = state
        .loop_service
        .current_loops(session_id)?
        .iter()
        .map(LoopRecord::to_contract)
        .collect();
    let (processes, agents) = state.activity_service.current_roster(session_id)?;
    Ok(SessionActivity {
        // Idle until the sink's current_turn_id is threaded through (view.rs TODO).
        turn: TurnState::Idle,
        goal,
        loops,
        processes,
        agents,
    })
}

async fn handle_activity_ws(
    socket: WebSocket,
    session_id: String,
    snapshot: SessionActivity,
    state: AppState,
) {
    let (mut ws_sink, mut ws_stream) = socket.split();

    let snapshot_frame = serde_json::json!({ "type": "snapshot", "activity": snapshot });
    if ws_sink
        .send(Message::Text(snapshot_frame.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    let Some(handle) = state.acp_manager.get_handle(&session_id).await else {
        let _ = ws_sink.close().await;
        return;
    };
    let mut events = handle.subscribe();

    loop {
        tokio::select! {
            maybe_msg = ws_stream.next() => match maybe_msg {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            recv = events.recv() => match recv {
                Ok(envelope) => {
                    if !ACTIVITY_EVENT_TYPES.contains(&envelope.event.event_type()) {
                        continue;
                    }
                    if ws_sink
                        .send(Message::Text(event_frame(&envelope).to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    }

    let _ = ws_sink.close().await;
}

fn event_frame(envelope: &SessionEventEnvelope) -> serde_json::Value {
    serde_json::json!({ "type": "event", "envelope": envelope })
}
