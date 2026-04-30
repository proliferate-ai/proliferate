use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use futures::stream::StreamExt;
use futures::SinkExt;
use serde::Deserialize;

use crate::app::AppState;
use crate::terminals::model::ResizeTerminalOptions;
use crate::terminals::service::terminal_frame_to_json;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TerminalControlMessage {
    Resize { cols: u16, rows: u16 },
}

pub async fn terminal_ws(
    ws: WebSocketUpgrade,
    Path(terminal_id): Path<String>,
    Query(query): Query<TerminalWsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_terminal_ws(socket, terminal_id, query.after_seq, state))
}

#[derive(Debug, Deserialize)]
pub struct TerminalWsQuery {
    after_seq: Option<u64>,
}

async fn handle_terminal_ws(
    socket: WebSocket,
    terminal_id: String,
    after_seq: Option<u64>,
    state: AppState,
) {
    let (replay, output_rx) = match state
        .terminal_service
        .subscribe_output(&terminal_id, after_seq)
        .await
    {
        Some(value) => value,
        None => return,
    };

    let (mut ws_sink, mut ws_stream) = socket.split();
    for event in replay {
        let json = terminal_frame_to_json(&terminal_id, event);
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
                    if state
                        .workspace_access_gate
                        .assert_can_mutate_for_terminal(&terminal_id)
                        .await
                        .is_err()
                    {
                        break;
                    }
                    if state.terminal_service.write_input(&terminal_id, &data).await.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Text(text))) => {
                    match serde_json::from_str::<TerminalControlMessage>(&text) {
                        Ok(TerminalControlMessage::Resize { cols, rows }) => {
                            if state
                                .workspace_access_gate
                                .assert_can_mutate_for_terminal(&terminal_id)
                                .await
                                .is_err()
                            {
                                break;
                            }
                            let req = ResizeTerminalOptions { cols, rows };
                            let _ = state.terminal_service.resize_terminal(&terminal_id, req).await;
                        }
                        Err(_) => {
                            if state
                                .workspace_access_gate
                                .assert_can_mutate_for_terminal(&terminal_id)
                                .await
                                .is_err()
                            {
                                break;
                            }
                            if state
                                .terminal_service
                                .write_input(&terminal_id, text.as_bytes())
                                .await
                                .is_err()
                            {
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
                let json = terminal_frame_to_json(&terminal_id, event);
                let msg = Message::Text(json.to_string().into());
                if ws_sink.send(msg).await.is_err() {
                    break;
                }
            }
        }
    }

    let _ = ws_sink.close().await;
}
