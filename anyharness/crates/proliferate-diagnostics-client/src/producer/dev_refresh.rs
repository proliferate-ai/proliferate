//! Dev-only file-backed twin of the fd bridge's `GenerationReady` path.
//!
//! The Desktop host re-publishes the dev diagnostics env snippet whenever a
//! collector restart brings up a new generation. This task keeps re-reading
//! that snippet and swaps the producer onto the new collector via
//! [`ProducerInner::replace_generation`], so an externally launched dev
//! runtime no longer stays pinned to a dead collector until its own restart.

use std::{path::PathBuf, sync::Arc, time::Duration};

use super::ProducerInner;
use crate::bridge::activation::{
    parse_dev_env_snippet, CollectorGenerationHandle, DEV_COLLECTOR_GENERATION,
};
use crate::producer::transport::CollectorClient;

#[cfg(test)]
#[path = "tests_dev_refresh.rs"]
mod tests;

/// A stat per tick is the steady-state cost; the file only changes when the
/// collector restarts, so seconds of re-attach latency are fine.
const DEV_ENV_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Starts the refresh task when the host published the snippet's own path;
/// an old app build's 3-line snippet keeps the frozen single-generation
/// behavior.
pub(super) fn spawn_if_configured(
    runtime: &tokio::runtime::Handle,
    inner: &Arc<ProducerInner>,
    path: Option<PathBuf>,
) {
    if let Some(path) = path {
        runtime.spawn(dev_generation_refresh(Arc::clone(inner), path));
    }
}

async fn dev_generation_refresh(inner: Arc<ProducerInner>, path: PathBuf) {
    dev_generation_refresh_with_interval(inner, path, DEV_ENV_POLL_INTERVAL).await;
}

/// The interval seam exists for tests; production uses the constant above.
async fn dev_generation_refresh_with_interval(
    inner: Arc<ProducerInner>,
    path: PathBuf,
    interval: Duration,
) {
    let mut seen_mtime = None;
    // Locally owned counter: with no bridge nothing else advances the
    // generation, so a monotonic bump always supersedes the current one —
    // including an unavailable latch from boot-id-mismatched receipts.
    let mut dev_generation = DEV_COLLECTOR_GENERATION;
    loop {
        tokio::time::sleep(interval).await;
        if inner.is_terminal() {
            return;
        }
        let Ok(meta) = tokio::fs::metadata(&path).await else {
            continue;
        };
        let mtime = meta.modified().ok();
        if mtime == seen_mtime {
            continue;
        }
        // seen_mtime latches only after a coherent read: the host's rewrite is
        // not atomic, so a torn/garbage read at this mtime must be retried on
        // the next tick rather than locking the rewrite out until a later
        // distinguishable timestamp — that would reproduce the very outage
        // this loop exists to fix.
        let Ok(content) = tokio::fs::read_to_string(&path).await else {
            continue;
        };
        let Some(parsed) = parse_dev_env_snippet(&content) else {
            continue;
        };
        if inner.current_collector_boot_id().as_deref() == Some(parsed.collector_boot_id.as_str()) {
            // Same generation republished (e.g. covering our own boot) —
            // nothing to do.
            seen_mtime = mtime;
            continue;
        }
        let Ok(client) = CollectorClient::new(&parsed.endpoint, parsed.capability) else {
            continue;
        };
        seen_mtime = mtime;
        dev_generation = dev_generation.saturating_add(1);
        inner.replace_generation(CollectorGenerationHandle {
            generation: dev_generation,
            collector_boot_id: parsed.collector_boot_id,
            client: Arc::new(client),
        });
        // The capability is a secret: only the endpoint is logged.
        tracing::info!(
            target: "anyharness.diagnostics.delivery",
            endpoint = %parsed.endpoint,
            "dev diagnostics re-attached to new collector generation"
        );
    }
}

impl ProducerInner {
    /// Boot id of the current generation, ready or cooling down. `None` while
    /// unavailable so a re-published snippet for the same (dead) collector can
    /// still be retried by the dev refresh loop.
    fn current_collector_boot_id(&self) -> Option<String> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        match &state.collector {
            super::CollectorAvailability::Ready(generation)
            | super::CollectorAvailability::Cooldown { generation, .. } => {
                Some(generation.collector_boot_id.clone())
            }
            super::CollectorAvailability::Unavailable { .. } => None,
        }
    }

    fn is_terminal(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .terminal
    }
}
