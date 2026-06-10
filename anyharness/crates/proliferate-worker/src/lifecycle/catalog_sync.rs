//! Heartbeat-driven agent-catalog convergence (spec §5.1, decision 2).
//!
//! Each heartbeat response advertises the `catalogVersion` the cloud
//! currently serves. The worker compares it to the version it last
//! successfully pushed into the runtime (`store/catalog_push_state.rs`) and
//! acts on a DIFFERENCE — not "newer" — so reverting the catalog PR rolls
//! the fleet back on the next heartbeat (converge-to-server, decision 1).
//!
//! On mismatch: `GET /v1/catalogs/agents` from the cloud (ETag-aware,
//! `cloud_client/catalogs.rs`) and `PUT` the raw bytes into the runtime
//! (`anyharness_client/catalogs.rs`); the runtime validates and atomically
//! swaps. Only a runtime 200 records the pushed version. Debounce is
//! structural: this runs at most once per heartbeat cycle, and a failure is
//! logged and retried on the next heartbeat — no tight loop.

use tracing::{debug, info, warn};

use crate::{
    anyharness_client::AnyHarnessClient,
    cloud_client::{catalogs::AgentCatalogFetch, CloudClient},
    config::WorkerConfig,
    error::WorkerError,
    store::WorkerStore,
};

/// Pure converge decision: act exactly when the advertised version is known
/// and DIFFERS from the recorded last-pushed one (downgrades included; an
/// unpushed runtime always converges).
pub fn should_converge(advertised: Option<&str>, last_pushed: Option<&str>) -> bool {
    match advertised {
        None => false,
        Some(advertised) => Some(advertised) != last_pushed,
    }
}

/// Version recorded as runtime-active, reported back in the heartbeat
/// request for fleet observability.
pub fn reported_version(store: &WorkerStore) -> Option<String> {
    match store.load_agent_catalog_push_state() {
        Ok(state) => state.map(|state| state.pushed_version),
        Err(error) => {
            warn!(?error, "failed to load agent catalog push state");
            None
        }
    }
}

/// One convergence attempt, invoked once per heartbeat cycle with the
/// heartbeat-advertised version. Errors are returned for the caller to log;
/// the next heartbeat retries naturally.
pub async fn converge_once(
    config: &WorkerConfig,
    cloud: &CloudClient,
    store: &WorkerStore,
    advertised: Option<&str>,
) -> Result<(), WorkerError> {
    let recorded = store.load_agent_catalog_push_state()?;
    if !should_converge(
        advertised,
        recorded.as_ref().map(|s| s.pushed_version.as_str()),
    ) {
        return Ok(());
    }
    let Some(base_url) = config.anyharness_base_url.clone() else {
        debug!("agent catalog version differs but no anyharness runtime is configured");
        return Ok(());
    };
    let advertised = advertised.expect("should_converge requires an advertised version");
    let etag = recorded.as_ref().and_then(|state| state.etag.as_deref());
    let (body, etag) = match cloud.fetch_agent_catalog(etag).await? {
        AgentCatalogFetch::NotModified => {
            // The served document is the one already pushed (e.g. a rollback
            // landed on exactly the recorded version between heartbeats).
            debug!(advertised, "agent catalog unchanged for recorded ETag");
            return Ok(());
        }
        AgentCatalogFetch::Fetched { body, etag } => (body, etag),
    };
    let fetched_version = extract_catalog_version(&body).unwrap_or_else(|| advertised.to_string());
    let runtime = AnyHarnessClient::new(base_url, config.anyharness_bearer_token.clone())?;
    let outcome = runtime.apply_agent_catalog(body, etag.as_deref()).await?;
    store.record_agent_catalog_push(&fetched_version, etag.as_deref())?;
    if outcome.applied {
        info!(
            from_version = outcome.from_version.as_deref(),
            to_version = outcome.to_version.as_deref(),
            "agent catalog pushed to runtime"
        );
    } else {
        debug!(
            version = %fetched_version,
            "runtime already on fetched agent catalog version"
        );
    }
    Ok(())
}

/// Minimal, generation-agnostic read of the document's `catalogVersion`
/// field (the worker never parses the full schema; the runtime validates).
fn extract_catalog_version(body: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    value
        .get("catalogVersion")
        .and_then(|version| version.as_str())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{extract_catalog_version, should_converge};

    #[test]
    fn no_advertised_version_is_a_no_op() {
        assert!(!should_converge(None, None));
        assert!(!should_converge(None, Some("2026-06-10.6")));
    }

    #[test]
    fn matching_versions_are_a_no_op() {
        assert!(!should_converge(Some("2026-06-10.6"), Some("2026-06-10.6")));
    }

    #[test]
    fn different_version_converges_including_downgrade() {
        // Upgrade.
        assert!(should_converge(Some("2026-06-10.7"), Some("2026-06-10.6")));
        // Rollback: DIFFERENT, not newer, still converges (decision 1).
        assert!(should_converge(Some("2026-06-09.1"), Some("2026-06-10.6")));
    }

    #[test]
    fn nothing_pushed_yet_converges() {
        assert!(should_converge(Some("2026-06-10.6"), None));
    }

    #[test]
    fn extracts_catalog_version_across_generations() {
        assert_eq!(
            extract_catalog_version(br#"{"schemaVersion":1,"catalogVersion":"2026-06-10.6"}"#),
            Some("2026-06-10.6".to_string())
        );
        assert_eq!(
            extract_catalog_version(br#"{"schemaVersion":2,"catalogVersion":"2026-07-01.1"}"#),
            Some("2026-07-01.1".to_string())
        );
        assert_eq!(extract_catalog_version(br#"{"schemaVersion":1}"#), None);
        assert_eq!(extract_catalog_version(b"not json"), None);
    }
}
