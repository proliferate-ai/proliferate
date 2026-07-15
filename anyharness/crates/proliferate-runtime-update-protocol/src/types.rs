//! The frozen wire shapes exchanged through the update mailbox: the request the
//! Worker writes, the result the Supervisor writes, and their enums. Neither
//! carries behavior — activation policy lives entirely in the Supervisor.

use serde::{Deserialize, Serialize};

/// The components a mailbox request may target. Deliberately excludes
/// `supervisor`: the Supervisor is image-bound and never self-updates, so a
/// request naming it is unrepresentable rather than merely rejected. Being an
/// enum also makes the component inherently path-safe (no traversal possible).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateComponent {
    Anyharness,
    Worker,
}

impl UpdateComponent {
    pub fn as_str(self) -> &'static str {
        match self {
            UpdateComponent::Anyharness => "anyharness",
            UpdateComponent::Worker => "worker",
        }
    }
}

/// One durable update request written by the Worker when a heartbeat ack
/// diverges from what the sandbox runs. Serialized camelCase to match the rest
/// of the cloud wire. `version` is the *artifact* version to converge onto (not
/// the schema version — that is fixed by the `V1` type name).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRequestV1 {
    /// Idempotency + result-correlation key. Path-safe (it is embedded in the
    /// result filename). A replayed heartbeat that produces the same
    /// (component, version) reuses the same `request_id` so the file overwrites
    /// itself and the Supervisor activates exactly once.
    pub request_id: String,
    pub component: UpdateComponent,
    /// The artifact version to converge the component onto, e.g. `"0.2.16"`.
    pub version: String,
    /// Platform target triple/token, e.g. `"linux-x86_64"`.
    pub target_triple: String,
    /// The exact URL the Supervisor may fetch (only this URL, nothing derived).
    pub artifact_url: String,
    /// Lowercase hex SHA-256 the downloaded bytes must match.
    pub sha256: String,
    /// Expected artifact size in bytes; re-checked after download.
    pub size_bytes: u64,
    /// RFC3339 timestamp the Worker stamped the request. Informational; not
    /// path-embedded, so it is not identifier-validated.
    pub requested_at: String,
}

/// The terminal outcome the Supervisor reports for a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateOutcome {
    /// New version staged, activated, and health-gated healthy.
    Activated,
    /// Activation was attempted but unhealthy; last-good was restored. The
    /// component keeps serving the prior version.
    RolledBack,
    /// Request failed admission (malformed, unsafe, wrong checksum/size/
    /// component, missing artifact); nothing was activated.
    Invalid,
}

/// The result the Supervisor writes once a request reaches a terminal outcome.
/// The Worker reads it only to reconcile logs/telemetry; convergence itself is
/// reported back to Cloud through the existing heartbeat version fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResultV1 {
    pub request_id: String,
    pub outcome: UpdateOutcome,
    /// The version actually running after the outcome (new on `Activated`,
    /// prior on `RolledBack`, unchanged/absent on `Invalid`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_version: Option<String>,
    /// Human-readable failure detail for `RolledBack` / `Invalid`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_request() -> UpdateRequestV1 {
        UpdateRequestV1 {
            request_id: "anyharness-0.2.16-abc123".to_string(),
            component: UpdateComponent::Anyharness,
            version: "0.2.16".to_string(),
            target_triple: "linux-x86_64".to_string(),
            artifact_url:
                "https://downloads.example.test/runtime/stable/0.2.16/linux-x86_64/anyharness"
                    .to_string(),
            sha256: "a".repeat(64),
            size_bytes: 4096,
            requested_at: "2026-07-15T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn request_round_trips_camel_case() {
        let request = sample_request();
        let value = serde_json::to_value(&request).expect("serialize");
        assert_eq!(value["requestId"], "anyharness-0.2.16-abc123");
        assert_eq!(value["component"], "anyharness");
        assert_eq!(value["targetTriple"], "linux-x86_64");
        assert_eq!(value["sizeBytes"], 4096);
        let parsed: UpdateRequestV1 = serde_json::from_value(value).expect("parse");
        assert_eq!(parsed, request);
    }

    #[test]
    fn result_outcome_serializes_snake_case() {
        let result = UpdateResultV1 {
            request_id: "abc123".to_string(),
            outcome: UpdateOutcome::RolledBack,
            observed_version: Some("0.2.15".to_string()),
            error: Some("unhealthy after activation".to_string()),
        };
        let value = serde_json::to_value(&result).expect("serialize");
        assert_eq!(value["outcome"], "rolled_back");
        assert_eq!(value["observedVersion"], "0.2.15");
        let parsed: UpdateResultV1 = serde_json::from_value(value).expect("parse");
        assert_eq!(parsed, result);
    }

    #[test]
    fn supervisor_is_not_a_representable_component() {
        // Image-bound: a request can never name the supervisor.
        assert!(serde_json::from_str::<UpdateComponent>("\"supervisor\"").is_err());
    }
}
