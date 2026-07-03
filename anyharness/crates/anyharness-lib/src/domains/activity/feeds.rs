//! Lazy live content feeds for the activity rosters.
//!
//! Each roster element carries an opaque `FeedRef`; the UI opens
//! `WS /v1/feeds/{feed_id}` to watch its live content. The transport behind a
//! feed (`tail_file` / `acp_child_demux` / `http_sse`) never leaves the
//! runtime — the [`FeedService`] resolves the [`FeedBindingRecord`] from the
//! membrane's registry and materializes bytes only while a watcher is
//! connected. A feed with no watcher costs nothing: no file handle, no task,
//! no buffering churn (the demux ring is the one bounded exception, fed by the
//! sink demux and drained on open).
//!
//! Two transports are implemented here:
//! - **`tail_file`** — a rotation-tolerant tokio file tail (Claude background
//!   task output files; Cursor terminal files once its membrane lands).
//! - **`acp_child_demux`** — a per-feed ring buffer the sink appends child
//!   ACP chunks into, replayed on open then streamed live (Codex collab child
//!   threads).
//!
//! `http_sse` (OpenCode/Cursor Phase D) is registered in the model but not yet
//! materialized here — [`FeedService::open`] reports it unsupported rather than
//! silently dropping bytes.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;

use super::model::{FeedBindingRecord, FeedTransport};
use super::store::ActivityStore;

/// How often the file tail polls for appended bytes / rotation.
const TAIL_POLL_INTERVAL: Duration = Duration::from_millis(200);
/// Max bytes read per tail poll (bounds a single burst; the loop drains the
/// rest on the next tick).
const TAIL_READ_CHUNK: usize = 64 * 1024;
/// Ring capacity for a demux child feed (bounded so an unwatched feed can't
/// grow without limit).
const DEMUX_RING_CAP: usize = 2048;

/// One frame delivered to a feed watcher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeedFrame {
    /// Raw terminal bytes (`FeedKind::TerminalBytes`).
    Bytes(Vec<u8>),
    /// One transcript line / JSON chunk (`FeedKind::Transcript`).
    Text(String),
}

#[derive(Debug, thiserror::Error)]
pub enum FeedError {
    #[error("feed not found")]
    NotFound,
    #[error("feed transport '{0}' is not supported yet")]
    UnsupportedTransport(&'static str),
    #[error(transparent)]
    Store(#[from] anyhow::Error),
}

/// A live subscription to a feed. `replay` is delivered first (buffered
/// history), then `live` streams new frames until the watcher drops the
/// receiver — at which point the producer task/loop exits on its own.
#[derive(Debug)]
pub struct FeedStream {
    pub replay: Vec<FeedFrame>,
    pub live: mpsc::Receiver<FeedFrame>,
}

/// Bounded per-child-feed ring the sink appends demuxed ACP chunks into.
/// Public so the (fork-fed) sink demux can push once child streams are
/// captured; today it stays empty and `open` returns an empty replay + a live
/// subscription, which is the correct lazy behavior.
#[derive(Default)]
pub struct FeedDemux {
    inner: std::sync::Mutex<std::collections::HashMap<String, ChildFeedBuffer>>,
}

struct ChildFeedBuffer {
    ring: std::collections::VecDeque<FeedFrame>,
    tx: tokio::sync::broadcast::Sender<FeedFrame>,
}

impl FeedDemux {
    /// Append a demuxed child chunk for `feed_id`: buffers it (bounded) and
    /// fans it out to any live watcher.
    pub fn push(&self, feed_id: &str, frame: FeedFrame) {
        let mut inner = self.inner.lock().expect("feed demux lock poisoned");
        let buffer = inner
            .entry(feed_id.to_string())
            .or_insert_with(ChildFeedBuffer::new);
        if buffer.ring.len() == DEMUX_RING_CAP {
            buffer.ring.pop_front();
        }
        buffer.ring.push_back(frame.clone());
        let _ = buffer.tx.send(frame);
    }

    fn open(&self, feed_id: &str) -> (Vec<FeedFrame>, tokio::sync::broadcast::Receiver<FeedFrame>) {
        let mut inner = self.inner.lock().expect("feed demux lock poisoned");
        let buffer = inner
            .entry(feed_id.to_string())
            .or_insert_with(ChildFeedBuffer::new);
        (buffer.ring.iter().cloned().collect(), buffer.tx.subscribe())
    }
}

impl ChildFeedBuffer {
    fn new() -> Self {
        let (tx, _) = tokio::sync::broadcast::channel(DEMUX_RING_CAP);
        Self {
            ring: std::collections::VecDeque::new(),
            tx,
        }
    }
}

#[derive(Clone)]
pub struct FeedService {
    store: ActivityStore,
    demux: Arc<FeedDemux>,
    /// Live producer count (test observability of laziness).
    active_producers: Arc<AtomicUsize>,
}

impl FeedService {
    pub fn new(store: ActivityStore) -> Self {
        Self {
            store,
            demux: Arc::new(FeedDemux::default()),
            active_producers: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn demux(&self) -> &Arc<FeedDemux> {
        &self.demux
    }

    /// Registry lookup — the feed's binding (session scope + transport). Pure
    /// DB read; spawns nothing.
    pub fn resolve(&self, feed_id: &str) -> anyhow::Result<Option<FeedBindingRecord>> {
        self.store.find_feed_binding_by_id(feed_id)
    }

    /// The number of running producer tasks — 0 until a watcher opens a feed,
    /// proving the "zero cost while unwatched" property.
    pub fn active_producer_count(&self) -> usize {
        self.active_producers.load(Ordering::SeqCst)
    }

    /// Open a live subscription. Materializes the transport lazily: this is the
    /// first moment any file handle / task exists for the feed.
    pub fn open(&self, binding: &FeedBindingRecord) -> Result<FeedStream, FeedError> {
        match &binding.transport {
            FeedTransport::TailFile { path } => Ok(self.open_tail_file(path.clone())),
            FeedTransport::AcpChildDemux { .. } => Ok(self.open_child_demux(&binding.feed_id)),
            FeedTransport::HttpSse { .. } => Err(FeedError::UnsupportedTransport("http_sse")),
        }
    }

    fn open_child_demux(&self, feed_id: &str) -> FeedStream {
        let (replay, mut broadcast_rx) = self.demux.open(feed_id);
        let (tx, live) = mpsc::channel::<FeedFrame>(256);
        let active = self.active_producers.clone();
        active.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    // The demux broadcast Sender lives in the (never-evicted)
                    // FeedDemux map, so `recv()` never returns Closed — a
                    // watcher that disconnects while the child feed is idle
                    // would otherwise park this task forever (unlike
                    // tail_file_loop, which polls `tx.is_closed()`). Exit
                    // promptly on the mpsc close instead.
                    _ = tx.closed() => break,
                    received = broadcast_rx.recv() => match received {
                        Ok(frame) => {
                            if tx.send(frame).await.is_err() {
                                break; // watcher gone
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
            active.fetch_sub(1, Ordering::SeqCst);
        });
        FeedStream { replay, live }
    }

    fn open_tail_file(&self, path: String) -> FeedStream {
        let (tx, live) = mpsc::channel::<FeedFrame>(256);
        let active = self.active_producers.clone();
        active.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            tail_file_loop(path, tx).await;
            active.fetch_sub(1, Ordering::SeqCst);
        });
        FeedStream {
            replay: Vec::new(),
            live,
        }
    }
}

/// Rotation-tolerant file tail: reads from the start (so a late watcher sees
/// history), then polls for appended bytes. If the file shrinks (truncation)
/// or its inode changes (rotation), it re-reads from offset 0. Exits when the
/// watcher drops the receiver.
async fn tail_file_loop(path: String, tx: mpsc::Sender<FeedFrame>) {
    let mut offset: u64 = 0;
    let mut inode = file_identity(&path).await;
    let mut interval = tokio::time::interval(TAIL_POLL_INTERVAL);
    loop {
        interval.tick().await;
        if tx.is_closed() {
            break;
        }

        let current_inode = file_identity(&path).await;
        let rotated = current_inode.is_some() && current_inode != inode;
        if rotated {
            inode = current_inode;
            offset = 0;
        }

        let mut file = match tokio::fs::File::open(&path).await {
            Ok(file) => file,
            Err(_) => continue, // not created yet (or transiently gone)
        };
        let len = match file.metadata().await {
            Ok(meta) => meta.len(),
            Err(_) => continue,
        };
        if len < offset {
            // Truncated in place — restart from the top.
            offset = 0;
        }
        if len == offset {
            continue;
        }

        use tokio::io::AsyncSeekExt;
        if file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .is_err()
        {
            continue;
        }
        let mut buf = vec![0u8; TAIL_READ_CHUNK];
        loop {
            match file.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    offset += n as u64;
                    if tx.send(FeedFrame::Bytes(buf[..n].to_vec())).await.is_err() {
                        return; // watcher gone
                    }
                }
                Err(_) => break,
            }
        }
    }
}

/// A cheap file identity for rotation detection: (device, inode) on unix, len
/// fallback elsewhere.
async fn file_identity(path: &str) -> Option<u64> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        Some(meta.ino())
    }
    #[cfg(not(unix))]
    {
        Some(meta.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domains::activity::model::{FeedOwnerKind, FeedTransport};
    use crate::persistence::Db;

    fn feed_service_with_binding(transport: FeedTransport) -> (FeedService, FeedBindingRecord) {
        let db = Db::open_in_memory().expect("open db");
        crate::app::test_support::seed_workspace_with_repo_root(
            &db,
            "workspace-1",
            "local",
            "/tmp/workspace-1",
        );
        db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sessions (id, workspace_id, agent_kind, status, created_at, updated_at)
                 VALUES ('session-1', 'workspace-1', 'claude', 'idle', 'now', 'now')",
                [],
            )?;
            Ok(())
        })
        .expect("seed session");
        let store = ActivityStore::new(db);
        let binding = FeedBindingRecord {
            feed_id: "feed-1".to_string(),
            session_id: "session-1".to_string(),
            kind: anyharness_contract::v1::FeedKind::TerminalBytes,
            owner_kind: FeedOwnerKind::Process,
            owner_id: "proc-1".to_string(),
            transport,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        };
        store
            .with_tx_anyhow(|tx| {
                ActivityStore::upsert_feed_binding(tx, &binding)?;
                Ok(())
            })
            .expect("insert binding");
        (FeedService::new(store), binding)
    }

    #[tokio::test]
    async fn resolve_is_lazy_no_producer_until_open() {
        let (service, binding) = feed_service_with_binding(FeedTransport::TailFile {
            path: "/tmp/does-not-matter".to_string(),
        });
        // Resolving the registry spawns nothing.
        let resolved = service.resolve(&binding.feed_id).expect("resolve");
        assert_eq!(resolved.expect("binding").feed_id, "feed-1");
        assert_eq!(service.active_producer_count(), 0);
    }

    #[tokio::test]
    async fn tail_file_streams_existing_then_appended_bytes() {
        let path = std::env::temp_dir().join(format!(
            "anyharness-feed-tail-{}.txt",
            uuid::Uuid::new_v4()
        ));
        tokio::fs::write(&path, b"hello").await.expect("seed file");

        let (service, binding) = feed_service_with_binding(FeedTransport::TailFile {
            path: path.to_string_lossy().to_string(),
        });

        let mut stream = service.open(&binding).expect("open tail");
        // Producer now exists.
        assert_eq!(service.active_producer_count(), 1);

        let first = stream.live.recv().await.expect("first frame");
        assert_eq!(first, FeedFrame::Bytes(b"hello".to_vec()));

        // Append -> tailed.
        {
            use tokio::io::AsyncWriteExt;
            let mut file = tokio::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .await
                .expect("reopen append");
            file.write_all(b" world").await.expect("append");
            file.flush().await.expect("flush");
        }
        let second = stream.live.recv().await.expect("second frame");
        assert_eq!(second, FeedFrame::Bytes(b" world".to_vec()));

        let _ = tokio::fs::remove_file(&path).await;
    }

    #[tokio::test]
    async fn demux_replays_buffered_then_streams_live() {
        let (service, _) = feed_service_with_binding(FeedTransport::AcpChildDemux {
            thread_id: "child-1".to_string(),
        });
        // Buffer a chunk BEFORE anyone opens — zero producers so far.
        service
            .demux()
            .push("feed-1", FeedFrame::Text("line-1".to_string()));
        assert_eq!(service.active_producer_count(), 0);

        let binding = service.resolve("feed-1").unwrap().unwrap();
        let mut stream = service.open(&binding).expect("open demux");
        assert_eq!(stream.replay, vec![FeedFrame::Text("line-1".to_string())]);
        assert_eq!(service.active_producer_count(), 1);

        // Live push after open arrives on the stream.
        service
            .demux()
            .push("feed-1", FeedFrame::Text("line-2".to_string()));
        let live = stream.live.recv().await.expect("live frame");
        assert_eq!(live, FeedFrame::Text("line-2".to_string()));
    }

    #[tokio::test]
    async fn demux_producer_exits_when_idle_watcher_disconnects() {
        let (service, _) = feed_service_with_binding(FeedTransport::AcpChildDemux {
            thread_id: "child-1".to_string(),
        });
        let binding = service.resolve("feed-1").unwrap().unwrap();
        let stream = service.open(&binding).expect("open demux");
        assert_eq!(service.active_producer_count(), 1);

        // Drop the watcher's receiver with NO frame ever arriving — the idle
        // case that previously parked the producer task forever.
        drop(stream);

        for _ in 0..200 {
            if service.active_producer_count() == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert_eq!(service.active_producer_count(), 0);
    }

    #[tokio::test]
    async fn http_sse_transport_is_unsupported_for_now() {
        let (service, binding) = feed_service_with_binding(FeedTransport::HttpSse {
            url: "http://127.0.0.1:9000/x".to_string(),
        });
        let error = service.open(&binding).expect_err("http_sse unsupported");
        assert!(matches!(error, FeedError::UnsupportedTransport("http_sse")));
        assert_eq!(service.active_producer_count(), 0);
    }
}
