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
    parse_dev_env_file, CollectorGenerationHandle, DEV_COLLECTOR_GENERATION,
};
use crate::producer::transport::CollectorClient;

/// A stat per tick is the steady-state cost; the file only changes when the
/// collector restarts, so seconds of re-attach latency are fine.
const DEV_ENV_POLL_INTERVAL: Duration = Duration::from_secs(5);

pub(super) async fn dev_generation_refresh(inner: Arc<ProducerInner>, path: PathBuf) {
    dev_generation_refresh_with_interval(inner, path, DEV_ENV_POLL_INTERVAL).await;
}

/// The interval seam exists for tests; production uses the constant above.
pub(super) async fn dev_generation_refresh_with_interval(
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
        seen_mtime = mtime;
        let Some(parsed) = parse_dev_env_file(&path) else {
            continue;
        };
        if inner.current_collector_boot_id().as_deref() == Some(parsed.collector_boot_id.as_str()) {
            // Same generation republished (e.g. covering our own boot) —
            // nothing to do.
            continue;
        }
        let Ok(client) = CollectorClient::new(&parsed.endpoint, parsed.capability) else {
            continue;
        };
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
