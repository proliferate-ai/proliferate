use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Outcome of pushing an agent-auth state document into the runtime.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApplyAgentAuthStateResponse {
    /// True when the document was persisted to the runtime's state file.
    pub applied: bool,
    /// The persisted document's sequence (monotonic per surface; the server
    /// bumps it on every content-changing render).
    pub sequence: i64,
}

/// One harness's status document (agent_auth spec §2, "Runtime persistent
/// state") — the machine's single source of auth truth, event-refreshed and
/// served verbatim by `GET /v1/agent-auth/status` (+ its SSE stream) and on
/// the agents projection as `authStatus`. Snake_case on the wire: the spec's
/// printed shape is the contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AgentAuthStatusDoc {
    pub harness_kind: String,
    /// One row per (method kind\[, seat\]): every launch method whose material
    /// the applied document carries, plus the native detection row.
    pub methods: Vec<AgentAuthMethodRow>,
    /// The applied method, from the applied document — never from detection.
    /// The SERVING seat rides `applied.seat_id`. `null` when the document
    /// gives this harness no satisfiable sources.
    pub applied: Option<AgentAuthAppliedMethod>,
    /// The seat rotation would serve NEXT (`null` when the pool has fewer
    /// than two seats, or no seat could serve).
    pub next_seat_id: Option<String>,
    /// The seat-rotation toggle from the document's settings rider (`true`
    /// when absent — rotation is the default).
    pub rotate: bool,
    pub probe: AgentAuthProbeStatus,
    /// RFC3339 UTC; non-null ONLY when no seat can serve right now.
    pub cooling_until: Option<String>,
}

/// One method row in a status document. Launch-method rows (`seat`,
/// `gateway`, `api_key`) carry `available`; the `native` row carries
/// `detected` (+ `offer`) and never `available` — native is a detection with
/// a mint offer, never a launch method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AgentAuthMethodRow {
    /// `seat` | `gateway` | `api_key` | `native`.
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available: Option<bool>,
    /// `seat` rows only: the vault seat id — never token material.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
    /// Is this row the applied method (for seat rows: the serving seat)?
    pub applied: bool,
    /// `native` row only: a working native login was detected on this machine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected: Option<bool>,
    /// `native` row only: `"mint_seat"` for seat-capable harnesses — the
    /// detected login can be captured as a portable seat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
}

/// The applied method tag on a status document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AgentAuthAppliedMethod {
    /// `seat` | `gateway` | `api_key`.
    pub kind: String,
    /// Seat method only: the SERVING seat's vault id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
}

/// The probe verdict vocabulary — a closed set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentAuthProbeVerdict {
    Verified,
    Failed,
    Unverified,
}

/// The probe block of a status document — the serve-stale observation
/// (spec §3 flow 4: a probe failure dims the light, it never turns it off).
/// `stale: true` means a re-probe is pending or running while the last
/// observation stays visible; a restart serves every document stale until the
/// startup pass re-verifies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct AgentAuthProbeStatus {
    pub verdict: AgentAuthProbeVerdict,
    /// RFC3339 timestamp of the evidence; `null` while unverified.
    pub at: Option<String>,
    pub stale: bool,
}
