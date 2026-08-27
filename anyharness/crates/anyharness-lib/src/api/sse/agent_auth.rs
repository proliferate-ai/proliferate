//! The status-document stream (agent_auth spec §4 cell 2's local API):
//! `GET /v1/agent-auth/status/stream` — on connect, one event per CURRENT
//! document (the snapshot), then one event per status-document change.
//! Subscription happens BEFORE the snapshot read so a change landing between
//! the two is delivered rather than lost; the client may therefore see a
//! document twice, and deduplication is its concern. Polling the plain GET is
//! the fallback where SSE is unavailable.

use std::convert::Infallible;

use axum::extract::State;
use axum::response::sse::{Event, Sse};
use futures::stream::{self, Stream, StreamExt as FuturesStreamExt};
use tokio_stream::wrappers::BroadcastStream;

use crate::api::http::agent_auth_contract::status_doc_to_contract;
use crate::app::AppState;
use crate::domains::agent_auth::status::StatusDoc;

#[utoipa::path(
    get,
    path = "/v1/agent-auth/status/stream",
    responses(
        (status = 200, description = "SSE: a snapshot event per current status document, then one event per change"),
    ),
    tag = "agent-auth"
)]
pub async fn stream_agent_auth_status(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Subscribe FIRST: a refresh racing this connect must land in the live
    // stream if it missed the snapshot.
    let live_rx = state.agent_status_service.subscribe();
    let snapshot = state.agent_status_service.read_all();
    let snapshot_stream = stream::iter(snapshot.into_iter().filter_map(doc_to_event));
    let live_stream = BroadcastStream::new(live_rx)
        .filter_map(|result| futures::future::ready(result.ok().and_then(doc_to_event)));
    Sse::new(snapshot_stream.chain(live_stream).boxed())
}

fn doc_to_event(doc: StatusDoc) -> Option<Result<Event, Infallible>> {
    let doc = status_doc_to_contract(doc);
    let json = serde_json::to_string(&doc).ok()?;
    Some(Ok(Event::default()
        .id(doc.harness_kind)
        .event("agent_auth_status")
        .data(json)))
}
