//! The status document's shape (agent_auth spec §2, "Runtime persistent
//! state") and the probe block's two halves.
//!
//! Split out of `mod.rs` so the service file holds behavior only: the document
//! is PERSISTED in exactly this shape (`doc_json` is the served truth), so the
//! serde derives here are a contract for both the row and the wire twin
//! (`anyharness_contract::v1::StatusDoc`, mapped at the API boundary per
//! AH-CONTRACT-1).

/// The domain's status document.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StatusDoc {
    pub harness_kind: String,
    pub methods: Vec<MethodRow>,
    /// The applied method, from the applied document — never detection. The
    /// SERVING seat rides `applied.seat_id`. `None`/`null` when the document
    /// gives this harness no satisfiable sources.
    pub applied: Option<AppliedMethod>,
    pub next_seat_id: Option<String>,
    pub rotate: bool,
    pub probe: ProbeStatus,
    pub cooling_until: Option<String>,
}

/// One method row: launch methods carry `available`; the `native` row carries
/// `detected` (+ `offer`) and never `available`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct MethodRow {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub available: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
    pub applied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AppliedMethod {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat_id: Option<String>,
}

/// The closed probe-verdict set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeVerdict {
    Verified,
    Failed,
    Unverified,
}

/// The serve-stale probe block: `stale` dims, the observation stays visible.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProbeStatus {
    pub verdict: ProbeVerdict,
    pub at: Option<String>,
    pub stale: bool,
}

/// Method vocabulary on the document (the spec's three methods + the native
/// detection row).
pub const METHOD_KIND_SEAT: &str = "seat";
pub const METHOD_KIND_GATEWAY: &str = "gateway";
pub const METHOD_KIND_API_KEY: &str = "api_key";
pub const METHOD_KIND_NATIVE: &str = "native";
/// The native row's offer for seat-capable harnesses.
pub const OFFER_MINT_SEAT: &str = "mint_seat";

/// The observation vocabulary in the row's `probe_verdict` column. Only a
/// COMPLETED attempt writes here, so `unverified` has no spelling: the absence
/// of a value IS "never probed".
pub(super) const OBSERVED_VERIFIED: &str = "verified";
pub(super) const OBSERVED_FAILED: &str = "failed";

/// Everything a composition decides — the document minus its probe block.
///
/// The split is what makes the persist atomic (see
/// [`super::AgentStatusService::write_locked`]): the expensive, side-effect-free
/// half is composed OUTSIDE the transaction, while the probe block is decided
/// INSIDE it against the row the write is about to replace.
#[derive(Debug, Clone)]
pub(super) struct ComposedBody {
    pub(super) methods: Vec<MethodRow>,
    pub(super) applied: Option<AppliedMethod>,
    pub(super) next_seat_id: Option<String>,
    pub(super) rotate: bool,
    pub(super) cooling_until: Option<String>,
}

impl ComposedBody {
    pub(super) fn into_doc(&self, harness_kind: &str, probe: ProbeStatus) -> StatusDoc {
        StatusDoc {
            harness_kind: harness_kind.to_string(),
            methods: self.methods.clone(),
            applied: self.applied.clone(),
            next_seat_id: self.next_seat_id.clone(),
            rotate: self.rotate,
            probe,
            cooling_until: self.cooling_until.clone(),
        }
    }
}

pub(super) fn parse_doc(harness_kind: &str, doc_json: &str) -> Option<StatusDoc> {
    match serde_json::from_str(doc_json) {
        Ok(doc) => Some(doc),
        Err(error) => {
            tracing::warn!(harness_kind, %error, "persisted agent-auth status document is malformed; skipping");
            None
        }
    }
}
