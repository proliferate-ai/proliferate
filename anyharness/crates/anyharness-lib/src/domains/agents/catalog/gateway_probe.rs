//! Gateway model probe: a stateless `GET {base_url}/v1/models` call.
//!
//! The runtime discovers what models the LiteLLM gateway can actually serve for
//! a harness by asking the gateway itself, with the harness's virtual key. NO
//! harness process is spawned. This module owns only the HTTP call and its
//! tolerant parse; the caller decides what to do with the result — the
//! machine-snapshot poke engine (`launch_probe`) for observation, and
//! `catalog::gateway_plan::GatewayModelPlanner` for the render-plane's memoized
//! plan. There is no store here any more: the old `gateway_model_probe` sqlite
//! table (revision-keyed, so any harness's auth change invalidated every
//! harness's probe) was deleted with the resolver chain it backed (A9); the
//! snapshot document and the planner's in-memory memo replaced it.

use std::time::Duration;

use serde::Deserialize;

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
}
