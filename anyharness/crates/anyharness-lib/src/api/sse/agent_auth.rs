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
use tokio::sync::broadcast;
use tokio_stream::wrappers::{errors::BroadcastStreamRecvError, BroadcastStream};

use crate::api::http::agent_auth_contract::status_doc_to_contract;
use crate::app::AppState;
use crate::domains::agents::status::StatusDoc;

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
    // Blocking-pool work (sqlite): one row read per persisted document, behind
    // the shared connection mutex — never on the axum task.
    let service = state.agent_status_service.clone();
    let snapshot = tokio::task::spawn_blocking(move || service.read_all())
        .await
        .unwrap_or_default();
    let snapshot_stream = stream::iter(snapshot.into_iter().filter_map(doc_to_event));
    Sse::new(snapshot_stream.chain(live_status_stream(live_rx)).boxed())
}

/// The live half of the stream: one event per status-document change, ENDING at
/// the first lag.
///
/// A lagging client cannot be allowed to silently miss a change. The channel
/// holds 64 documents, these frames carry no sequence, and there is no replay
/// path, so a dropped frame would leave the pane rendering an auth world that no
/// longer exists with nothing to ever correct it. The client's documented
/// fallback is to re-read `GET /v1/agent-auth/status` on close/error — so a lag
/// ENDS the stream, which is the one thing that can actually make that fallback
/// fire. (`sse/sessions.rs` may continue past a lag because its frames carry
/// `seq` and it has a replay path. This stream has neither, so it must not copy
/// that pattern.)
fn live_status_stream(
    live_rx: broadcast::Receiver<StatusDoc>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    BroadcastStream::new(live_rx)
        .take_while(|result| {
            let keep = match result {
                Ok(_) => true,
                Err(BroadcastStreamRecvError::Lagged(dropped)) => {
                    tracing::warn!(
                        dropped,
                        "agent-auth status stream lagged; ending the stream so the client resyncs"
                    );
                    false
                }
            };
            futures::future::ready(keep)
        })
        .filter_map(|result| futures::future::ready(result.ok().and_then(doc_to_event)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::agents::status::{ProbeStatus, ProbeVerdict};

    fn doc(harness_kind: &str) -> StatusDoc {
        StatusDoc {
            harness_kind: harness_kind.to_string(),
            methods: Vec::new(),
            applied: None,
            next_seat_id: None,
            rotate: true,
            probe: ProbeStatus {
                verdict: ProbeVerdict::Unverified,
                at: None,
                stale: false,
            },
            cooling_until: None,
        }
    }

    /// A lag ENDS the stream. Without this the client's only resync trigger —
    /// close/error — never fires, and it keeps rendering the last frame it
    /// happened to receive as if nothing were missing.
    #[tokio::test]
    async fn a_lagging_client_ends_the_stream_instead_of_missing_changes() {
        let (tx, rx) = broadcast::channel(2);
        // Overflow the channel: the receiver's next poll is `Lagged`.
        for index in 0..5 {
            tx.send(doc(&format!("harness-{index}")))
                .expect("a live receiver exists");
        }
        let events: Vec<_> = live_status_stream(rx).collect().await;
        assert!(
            events.is_empty(),
            "a lagged receiver must yield no further frames, got {} of them",
            events.len()
        );
    }

    /// The ordinary path is untouched: every delivered change is one event.
    #[tokio::test]
    async fn every_delivered_change_is_one_event() {
        let (tx, rx) = broadcast::channel(8);
        tx.send(doc("codex")).expect("send");
        tx.send(doc("grok")).expect("send");
        drop(tx);
        let events: Vec<_> = live_status_stream(rx).collect().await;
        assert_eq!(events.len(), 2);
    }
}

fn doc_to_event(doc: StatusDoc) -> Option<Result<Event, Infallible>> {
    let doc = status_doc_to_contract(doc);
    let json = serde_json::to_string(&doc).ok()?;
    Some(Ok(Event::default()
        .id(doc.harness_kind)
        .event("agent_auth_status")
        .data(json)))
}
