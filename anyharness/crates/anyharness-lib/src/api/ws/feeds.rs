//! `WS /v1/feeds/{feed_id}` — lazy live content for an activity roster feed.
//!
//! Bytes flow only while this socket is open: the [`FeedService`] materializes
//! the transport (file tail / child demux) on connect and tears it down when
//! the socket drops. The client never learns the transport — only the opaque
//! `feed_id` it received on the `FeedRef`.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::Extension;
use base64::Engine;
use futures::{SinkExt, StreamExt};

use crate::api::auth::AuthContext;
use crate::api::http::access::assert_session_auth_scope;
use crate::api::http::error::ApiError;
use crate::app::AppState;
use crate::domains::activity::feeds::{FeedFrame, FeedStream};

pub async fn feed_ws(
    ws: WebSocketUpgrade,
    Path(feed_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let Some(binding) = state
        .feed_service
        .resolve(&feed_id)
        .map_err(|error| ApiError::internal(error.to_string()))?
    else {
        return Err(ApiError::not_found("Feed not found", "NOT_FOUND"));
    };
    // A feed is scoped to its owning session; authorize against that.
    assert_session_auth_scope(&state, &auth, &binding.session_id)?;

    let stream = state
        .feed_service
        .open(&binding)
        .map_err(map_feed_error)?;

    Ok(ws.on_upgrade(move |socket| handle_feed_ws(socket, feed_id, stream)))
}

async fn handle_feed_ws(socket: WebSocket, feed_id: String, stream: FeedStream) {
    let (mut ws_sink, mut ws_stream) = socket.split();
    let FeedStream { replay, mut live } = stream;

    for frame in replay {
        if ws_sink
            .send(Message::Text(frame_to_json(&feed_id, frame).to_string().into()))
            .await
            .is_err()
        {
            return;
        }
    }

    loop {
        tokio::select! {
            maybe_msg = ws_stream.next() => match maybe_msg {
                // Feeds are read-only; ignore inbound data, break on close.
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            frame = live.recv() => match frame {
                Some(frame) => {
                    if ws_sink
                        .send(Message::Text(frame_to_json(&feed_id, frame).to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                None => break, // producer ended
            }
        }
    }

    let _ = ws_sink.close().await;
}

fn frame_to_json(feed_id: &str, frame: FeedFrame) -> serde_json::Value {
    match frame {
        FeedFrame::Bytes(bytes) => serde_json::json!({
            "type": "bytes",
            "feedId": feed_id,
            "dataBase64": base64::engine::general_purpose::STANDARD.encode(bytes),
        }),
        FeedFrame::Text(text) => serde_json::json!({
            "type": "text",
            "feedId": feed_id,
            "text": text,
        }),
    }
}

fn map_feed_error(error: crate::domains::activity::feeds::FeedError) -> ApiError {
    use crate::domains::activity::feeds::FeedError;
    match error {
        FeedError::NotFound => ApiError::not_found("Feed not found", "NOT_FOUND"),
        FeedError::UnsupportedTransport(kind) => ApiError::conflict(
            format!("Feed transport '{kind}' is not supported yet."),
            "FEED_TRANSPORT_UNSUPPORTED",
        ),
        FeedError::Store(error) => ApiError::internal(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_to_json_encodes_bytes_and_text() {
        assert_eq!(
            frame_to_json("feed-1", FeedFrame::Bytes(b"hello".to_vec())),
            serde_json::json!({
                "type": "bytes",
                "feedId": "feed-1",
                "dataBase64": "aGVsbG8=",
            })
        );
        assert_eq!(
            frame_to_json("feed-1", FeedFrame::Text("line".to_string())),
            serde_json::json!({
                "type": "text",
                "feedId": "feed-1",
                "text": "line",
            })
        );
    }
}
