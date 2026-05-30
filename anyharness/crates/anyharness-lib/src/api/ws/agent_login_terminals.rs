use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use axum::Extension;
use base64::Engine;
use futures::stream::StreamExt;
use futures::SinkExt;
use serde::Deserialize;

use crate::api::auth::AuthContext;
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::domains::terminals::model::{ResizeTerminalOptions, TerminalOutputEvent};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AgentLoginTerminalControlMessage {
    Resize { cols: u16, rows: u16 },
}

#[derive(Debug, Deserialize)]
pub struct AgentLoginTerminalWsQuery {
    after_seq: Option<u64>,
}

pub async fn agent_login_terminal_ws(
    ws: WebSocketUpgrade,
    Path(terminal_id): Path<String>,
    Query(query): Query<AgentLoginTerminalWsQuery>,
    Extension(_auth): Extension<AuthContext>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    if state
        .agent_login_terminal_service
        .lookup_terminal(&terminal_id)
        .await
        .is_none()
    {
        return Err(ApiError::not_found(
            "Agent login terminal not found",
            "AGENT_LOGIN_TERMINAL_NOT_FOUND",
        ));
    }
    Ok(ws.on_upgrade(move |socket| {
        handle_agent_login_terminal_ws(socket, terminal_id, query.after_seq, state)
    }))
}

async fn handle_agent_login_terminal_ws(
    socket: WebSocket,
    terminal_id: String,
    after_seq: Option<u64>,
    state: AppState,
) {
    let Some(terminal) = state
        .agent_login_terminal_service
        .lookup_terminal(&terminal_id)
        .await
    else {
        return;
    };
    let (replay, output_rx) = match terminal.subscribe_output(after_seq).await {
        Some(value) => value,
        None => return,
    };

    let (mut ws_sink, mut ws_stream) = socket.split();
    for event in replay {
        let json = terminal_output_event_to_json(terminal.id(), event);
        if ws_sink
            .send(Message::Text(json.to_string().into()))
            .await
            .is_err()
        {
            return;
        }
    }

    let mut output_rx = output_rx;
    loop {
        tokio::select! {
            maybe_msg = ws_stream.next() => match maybe_msg {
                Some(Ok(Message::Binary(data))) => {
                    if terminal.write_input(&data).await.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Text(text))) => {
                    match serde_json::from_str::<AgentLoginTerminalControlMessage>(&text) {
                        Ok(AgentLoginTerminalControlMessage::Resize { cols, rows }) => {
                            let _ = terminal.resize(ResizeTerminalOptions { cols, rows }).await;
                        }
                        Err(_) => {
                            if terminal.write_input(text.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            },
            recv = output_rx.recv() => {
                let event = match recv {
                    Ok(event) => event,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                let json = terminal_output_event_to_json(terminal.id(), event);
                let msg = Message::Text(json.to_string().into());
                if ws_sink.send(msg).await.is_err() {
                    break;
                }
            }
        }
    }

    let _ = ws_sink.close().await;
}

fn terminal_output_event_to_json(
    terminal_id: &str,
    event: TerminalOutputEvent,
) -> serde_json::Value {
    match event {
        TerminalOutputEvent::Data {
            seq,
            data,
            stream,
            command_run_id,
        } => {
            let mut value = serde_json::json!({
                "type": "data",
                "seq": seq,
                "terminalId": terminal_id,
                "dataBase64": base64::engine::general_purpose::STANDARD.encode(data),
            });
            if let Some(stream) = stream {
                value["stream"] = serde_json::Value::String(stream.to_string());
            }
            if let Some(command_run_id) = command_run_id {
                value["commandRunId"] = serde_json::Value::String(command_run_id);
            }
            value
        }
        TerminalOutputEvent::Exit { seq, code } => serde_json::json!({
            "type": "exit",
            "seq": seq,
            "terminalId": terminal_id,
            "code": code,
        }),
        TerminalOutputEvent::ReplayGap {
            requested_after_seq,
            floor_seq,
        } => serde_json::json!({
            "type": "replay_gap",
            "terminalId": terminal_id,
            "requestedAfterSeq": requested_after_seq,
            "floorSeq": floor_seq,
        }),
    }
}
