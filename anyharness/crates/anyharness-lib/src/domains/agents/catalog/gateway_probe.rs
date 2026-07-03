//! Gateway model probe + its sqlite store (spec §2).
//!
//! The runtime discovers what models the LiteLLM gateway can actually serve for
//! a harness by asking the gateway itself — `GET {base_url}/v1/models` with the
//! harness's virtual key. NO harness process is spawned. Results are stored in
//! `gateway_model_probe`, keyed by the state.json revision that supplied the
//! credentials, and consumed by [`super::gateway_resolver`].
//!
//! Future work (out of P3 scope): a harness binary update does not change
//! gateway reachability, so binary-version bumps do NOT trigger a re-probe —
//! only a new credential revision (or a manual refresh) does.

use std::time::Duration;

use serde::Deserialize;

use crate::persistence::Db;

/// How long a probe may take before we give up and fall back to seed data. Kept
/// short so a slow/unreachable gateway never stalls the trigger that scheduled
/// it (launch, apply, or manual refresh all run it fire-and-forget).
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum GatewayProbeError {
    #[error("gateway probe request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("gateway probe returned HTTP {status}")]
    Status { status: u16 },
}

/// Probe the gateway's OpenAI-compatible model list. Tolerant parse: any
/// `{ "data": [ { "id": "..." }, ... ] }` shape yields the ids; anything else
/// yields an empty list rather than an error (a gateway that answers 200 with a
/// surprising body still counts as reachable).
pub async fn probe_gateway_models(
    base_url: &str,
    key: &str,
) -> Result<Vec<String>, GatewayProbeError> {
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder().timeout(PROBE_TIMEOUT).build()?;
    let response = client.get(&url).bearer_auth(key).send().await?;
    let status = response.status();
    if !status.is_success() {
        return Err(GatewayProbeError::Status {
            status: status.as_u16(),
        });
    }
    let body: serde_json::Value = response.json().await?;
    Ok(parse_model_ids(&body))
}

#[derive(Debug, Deserialize)]
struct ModelsEnvelope {
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    #[serde(default)]
    id: Option<String>,
}

/// Pull `data[].id` out of an OpenAI-compatible `/v1/models` body, skipping
/// entries without a usable id. Pure, so the tolerant parse is unit-testable.
fn parse_model_ids(body: &serde_json::Value) -> Vec<String> {
    let Ok(envelope) = serde_json::from_value::<ModelsEnvelope>(body.clone()) else {
        return Vec::new();
    };
    envelope
        .data
        .into_iter()
        .filter_map(|entry| entry.id)
        .filter(|id| !id.trim().is_empty())
        .collect()
}

/// One stored probe result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayProbeRow {
    pub models: Vec<String>,
    pub probed_at: String,
}

/// Persistence over `gateway_model_probe`. Rows accumulate (append-only); the
/// resolver reads the most recent row per (harness, revision).
#[derive(Clone)]
pub struct GatewayProbeStore {
    db: Db,
}

impl GatewayProbeStore {
    pub fn new(db: Db) -> Self {
        Self { db }
    }

    /// Record a probe result for (harness, revision). `probed_at` is an RFC3339
    /// timestamp captured by the caller.
    pub fn record(
        &self,
        harness_kind: &str,
        revision: i64,
        models: &[String],
        probed_at: &str,
    ) -> anyhow::Result<()> {
        let models_json = serde_json::to_string(models)?;
        self.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO gateway_model_probe (harness_kind, revision, models_json, probed_at)
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![harness_kind, revision, models_json, probed_at],
            )?;
            Ok(())
        })?;
        Ok(())
    }

    /// The most recent probe row for (harness, revision), if any.
    pub fn latest(
        &self,
        harness_kind: &str,
        revision: i64,
    ) -> anyhow::Result<Option<GatewayProbeRow>> {
        let row = self.db.with_conn(|conn| {
            conn.query_row(
                "SELECT models_json, probed_at FROM gateway_model_probe
                 WHERE harness_kind = ?1 AND revision = ?2
                 ORDER BY probed_at DESC, id DESC
                 LIMIT 1",
                rusqlite::params![harness_kind, revision],
                |row| {
                    Ok((
                        row.get::<_, String>("models_json")?,
                        row.get::<_, String>("probed_at")?,
                    ))
                },
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })
        })?;
        let Some((models_json, probed_at)) = row else {
            return Ok(None);
        };
        let models: Vec<String> = serde_json::from_str(&models_json).unwrap_or_default();
        Ok(Some(GatewayProbeRow { models, probed_at }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_model_ids_is_tolerant() {
        let body = serde_json::json!({
            "data": [
                { "id": "claude-sonnet-4-5" },
                { "id": "" },
                { "notanid": true },
                { "id": "gpt-5.5" }
            ]
        });
        assert_eq!(parse_model_ids(&body), vec!["claude-sonnet-4-5", "gpt-5.5"]);

        // Non-envelope bodies yield an empty list, not an error.
        assert!(parse_model_ids(&serde_json::json!({ "unexpected": 1 })).is_empty());
        assert!(parse_model_ids(&serde_json::json!([1, 2, 3])).is_empty());
    }

    #[test]
    fn store_records_and_reads_latest() {
        let db = Db::open_in_memory().expect("db");
        let store = GatewayProbeStore::new(db);

        assert_eq!(store.latest("claude", 7).expect("latest"), None);

        store
            .record("claude", 7, &["m-old".to_string()], "2026-07-02T00:00:00Z")
            .expect("record old");
        store
            .record(
                "claude",
                7,
                &["m-new-a".to_string(), "m-new-b".to_string()],
                "2026-07-02T01:00:00Z",
            )
            .expect("record new");
        // A different revision must not leak into the (claude, 7) lookup.
        store
            .record("claude", 8, &["other".to_string()], "2026-07-02T02:00:00Z")
            .expect("record other rev");

        let latest = store.latest("claude", 7).expect("latest").expect("row");
        assert_eq!(latest.models, vec!["m-new-a", "m-new-b"]);
        assert_eq!(latest.probed_at, "2026-07-02T01:00:00Z");
    }
}
